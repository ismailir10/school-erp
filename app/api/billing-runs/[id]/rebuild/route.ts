import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { rebuildBillingRunSchema } from "@/lib/validations/billing-run";
import { LEAVE_RECORDED_AFTER_DRAFT_REASON } from "@/lib/finance/leave-exclusion";
import {
  materializeBillingRun,
  type MaterializeBillingRunScope,
} from "@/lib/finance/materialize-billing-run";

// Billing Run wizard editable step 2 (Cycle B2 —
// docs/cycles/2026-08-14-billing-run-wizard-b2.md, Task T4). "Hitung ulang"
// — rematerializes a DRAFT run's rows + lines from current fee structures
// and keringanan, using the run's persisted scope. Deliberately destroys
// every manual edit on the draft (Assumption 6); EXCLUDED row statuses are
// preserved by studentId (Assumption 5).

/**
 * ~200-student runs materialize ~600 rows/lines in one transaction — not
 * instant. Same ceiling as app/api/billing-runs/route.ts and
 * app/api/invoices/generate/batch/route.ts.
 */
export const maxDuration = 60;

/**
 * `BillingRun.scope` is a Prisma `Json` column, so it comes back as
 * `unknown` — never cast blindly. A missing field defaults to `[]` (an old
 * draft may predate a field), but a field that IS present with the wrong
 * shape means the persisted JSON is corrupt, and silently treating that as
 * "empty scope" would rematerialize the run down to nothing without any
 * signal. Throwing here 500s loudly instead, which is the stated worst case.
 */
function parseScopeField(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`Scope draf rusak pada field "${field}" — harus berupa array string`);
  }
  return value;
}

function parseScope(scope: unknown): MaterializeBillingRunScope {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) {
    throw new Error(`Scope draf rusak — bentuk tidak valid: ${JSON.stringify(scope)}`);
  }
  const obj = scope as Record<string, unknown>;
  return {
    classSectionIds: parseScopeField(obj.classSectionIds, "classSectionIds"),
    includeStudentIds: parseScopeField(obj.includeStudentIds, "includeStudentIds"),
    excludeStudentIds: parseScopeField(obj.excludeStudentIds, "excludeStudentIds"),
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { success } = rateLimit(`rebuild-billing-run:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;
  const { id } = await params;

  const run = await prisma.billingRun.findFirst({
    where: { id, tenantId },
  });
  if (!run) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = rebuildBillingRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Allowlist DRAFT rather than denylisting COMMITTED/COMMITTING/CANCELLED —
  // same reasoning as the cancel route (app/api/billing-runs/[id]/route.ts):
  // a status added later defaults to "not rebuildable" instead of silently
  // becoming rebuildable.
  if (run.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Hanya draf yang bisa dihitung ulang" },
      { status: 409 },
    );
  }

  // A COMMITTED row already has an invoiceId — deleting it would orphan that
  // invoice's provenance. A run with even one COMMITTED row is a
  // partially-committed run and cannot be rebuilt wholesale; the admin must
  // finish committing or cancel instead.
  const committedRowCount = await prisma.billingRunRow.count({
    where: { billingRunId: id, status: "COMMITTED" },
  });
  if (committedRowCount > 0) {
    return NextResponse.json(
      {
        error:
          "Draf ini sudah sebagian dikomit dan tidak bisa dihitung ulang. Selesaikan komit atau batalkan draf.",
      },
      { status: 409 },
    );
  }

  const scope = parseScope(run.scope);

  // Snapshot the currently-EXCLUDED rows' studentIds BEFORE deleting
  // anything (Assumption 5) — losing a carefully assembled set of exclusions
  // to a rebuild would be a nasty surprise; losing manual edits is the point
  // of the rebuild and is separately confirmed for in the UI.
  const excludedRows = await prisma.billingRunRow.findMany({
    where: { billingRunId: id, status: "EXCLUDED" },
    select: { studentId: true, error: true },
  });
  // An exclusion made only because a leave was recorded after the draft was
  // built is not carried over: the rebuilt row applies the leave rules itself
  // (it reads "Sedang cuti", or keeps the remaining enrollments' fees).
  const excludedStudentIds = new Set(
    excludedRows
      .filter((r) => r.error !== LEAVE_RECORDED_AFTER_DRAFT_REASON)
      .map((r) => r.studentId),
  );

  // Reads happen outside the transaction — same reasoning as
  // app/api/billing-runs/route.ts: materializeBillingRun issues five queries
  // over the whole scope, and run.periodLabel is already trimmed (the create
  // route trims before persisting), which matters because the
  // already-invoiced check keys off that exact string.
  const { rows, summary } = await materializeBillingRun(prisma, {
    tenantId,
    academicYearId: run.academicYearId,
    periodLabel: run.periodLabel,
    dueDate: run.dueDate,
    scope,
  });

  let reappliedExclusions = 0;
  const rowsWithIds = rows.map((r) => {
    // Re-apply EXCLUDED by studentId: only a freshly-built PENDING row can
    // become EXCLUDED again. A row that is now SKIPPED_* stays SKIPPED_* —
    // the skip reason (already invoiced / on leave / no fee structure) is the stronger
    // fact and is not overridden by a stale exclusion.
    if (r.status === "PENDING" && excludedStudentIds.has(r.studentId)) {
      reappliedExclusions++;
      return { ...r, id: crypto.randomUUID(), status: "EXCLUDED" as const };
    }
    return { ...r, id: crypto.randomUUID() };
  });

  try {
    await prisma.$transaction(async (tx) => {
      // RE-CHECK UNDER LOCK. The DRAFT and COMMITTED-row checks above ran
      // outside this transaction, which on its own is check-then-act. The
      // commit route (app/api/billing-runs/[id]/commit/route.ts) flips the run
      // DRAFT -> COMMITTING and then claims rows inside its own transaction,
      // so a commit starting between our check and this delete would have its
      // rows deleted out from under it — invoices written against rows that no
      // longer exist. A conditional updateMany on the run is the first
      // statement here: it takes the run's row lock and re-evaluates the
      // predicate, so a concurrent commit either loses the race (its own
      // status flip blocks until we finish, then it sees the rebuilt rows) or
      // wins it (our updateMany matches nothing and we abort). Same claim-first
      // shape the commit route uses for its rows.
      const claim = await tx.billingRun.updateMany({
        where: { id, status: "DRAFT" },
        data: { status: "DRAFT" },
      });
      if (claim.count !== 1) throw new Error("RUN_NOT_DRAFT");

      // Re-count COMMITTED rows under the same lock, for the same reason.
      const committedNow = await tx.billingRunRow.count({
        where: { billingRunId: id, status: "COMMITTED" },
      });
      if (committedNow > 0) throw new Error("RUN_PARTIALLY_COMMITTED");

      // Rebuild replaces rows wholesale rather than diffing (Assumption 6).
      // BillingRunLine cascades from BillingRunRow (prisma/schema.prisma) so
      // deleting rows deletes their lines too. Guarded to DRAFT runs with zero
      // COMMITTED rows above, so nothing carrying an invoiceId is ever deleted.
      await tx.billingRunRow.deleteMany({ where: { billingRunId: id } });

      if (rowsWithIds.length > 0) {
        await tx.billingRunRow.createMany({
          data: rowsWithIds.map((r) => ({
            id: r.id,
            billingRunId: id,
            studentId: r.studentId,
            studentNameSnapshot: r.studentNameSnapshot,
            classLabelSnapshot: r.classLabelSnapshot,
            parentId: r.parentId,
            totalDue: r.totalDue,
            status: r.status,
          })),
        });

        const lineData = rowsWithIds.flatMap((r) =>
          r.lines.map((l) => ({
            id: crypto.randomUUID(),
            billingRunRowId: r.id,
            feeComponentId: l.feeComponentId,
            labelSnapshot: l.labelSnapshot,
            amount: l.amount,
            adjustmentAmount: l.adjustmentAmount,
            adjustmentNote: l.adjustmentNote,
            finalAmount: l.finalAmount,
            source: l.source,
          })),
        );
        if (lineData.length > 0) {
          await tx.billingRunLine.createMany({ data: lineData });
        }
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === "RUN_NOT_DRAFT") {
      return NextResponse.json({ error: "Hanya draf yang bisa dihitung ulang" }, { status: 409 });
    }
    if (e instanceof Error && e.message === "RUN_PARTIALLY_COMMITTED") {
      return NextResponse.json(
        {
          error:
            "Draf ini sudah sebagian dikomit dan tidak bisa dihitung ulang. Selesaikan komit atau batalkan draf.",
        },
        { status: 409 },
      );
    }
    throw e;
  }

  // The builder's summary.excluded is always 0 (draft-time exclusion is a
  // post-creation PATCH, never set at build time — see the comment in
  // lib/finance/build-billing-run.ts). Correct it to the re-applied count
  // here, and move those rows out of `pending` to keep the summary's counts
  // consistent with the row set actually persisted above.
  const correctedSummary = {
    ...summary,
    pending: summary.pending - reappliedExclusions,
    excluded: reappliedExclusions,
  };

  return NextResponse.json({
    id,
    summary: correctedSummary,
    reappliedExclusions,
  });
}
