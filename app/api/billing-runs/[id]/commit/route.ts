import { hasPermission } from "@/lib/permissions";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { reserveInvoiceNumbers } from "@/lib/finance/invoice-numbers";
import { limit } from "@/lib/finance/concurrency-limit";
import { createPaymentSessionForInvoice } from "@/lib/payments/session";
import { formatPaymentLinkError } from "@/lib/payments/error-prefix";
import { commitBillingRunSchema } from "@/lib/validations/billing-run";
import { findAlreadyInvoicedStudentIds } from "@/lib/finance/materialize-billing-run";
import { isZeroTotal, ZERO_TOTAL_REASON } from "@/lib/finance/billing-run-zero-total";

// Billing Run wizard (Cycle B1 — docs/cycles/2026-08-14-billing-run-wizard.md,
// Task T6). Step 3's commit — writes the draft's rows/lines verbatim as real
// invoices. Reuses the transaction shape, invoice-number reservation, and
// post-commit payment-session fan-out from
// app/api/invoices/generate/batch/route.ts almost unchanged; the difference
// is that this route trusts the draft's amounts instead of re-deriving them
// (Cycle B1 spec Assumption 1) and re-checks duplicates against live Invoice
// rows instead of the draft (Assumption 1 does NOT extend to duplicates —
// that check is non-negotiable, see step 4 below).
//
// Same ceiling as the batch route and the create-draft route — a chunk of up
// to 25 invoices + lines in one transaction is not instant.
export const maxDuration = 60;

type CreatedRow = {
  rowId: string;
  invoiceId: string;
  invoiceNumber: string;
  studentId: string;
  studentName: string;
};

type ResultRow =
  | {
      rowId: string;
      studentId: string;
      studentName: string;
      status: "SKIPPED_ALREADY_INVOICED" | "SKIPPED_ZERO_TOTAL";
    }
  | {
      rowId: string;
      studentId: string;
      studentName: string;
      invoiceId: string;
      invoiceNumber: string;
      status: "SENT";
      paymentUrl: string;
    }
  | {
      rowId: string;
      studentId: string;
      studentName: string;
      invoiceId: string;
      invoiceNumber: string;
      status: "PENDING_PAYMENT_LINK";
      error: string;
    };

/**
 * POST /api/billing-runs/[id]/commit
 *
 * Body: `{ rowIds }` — one chunk of at most 25 `BillingRunRow` ids (per
 * `commitBillingRunSchema`). The wizard's client orchestrator
 * (`lib/finance/run-bulk-generate.ts`, repointed by T10) calls this
 * repeatedly, chunking a whole run.
 *
 * Order of operations (mirrors the numbered spec in the Cycle B1 doc):
 *   1. Load the run, tenant-scoped; 409 unless DRAFT or COMMITTING.
 *   2. Load the named rows scoped to this run, with lines. Ids that don't
 *      belong to this run are silently dropped by the `billingRunId` filter.
 *   3. Skip non-committable rows — anything not `PENDING` with a null
 *      `invoiceId` (already COMMITTED, EXCLUDED, any SKIPPED_* status, or a
 *      row that already carries an invoiceId). This is the idempotency
 *      guard: a row is committable at most once, full stop.
 *   3b. Rp 0 rows (total <= 0) are never turned into invoices — a payment link
 *      cannot be made for them and nothing can be recorded against them, so
 *      they would sit at PENDING_PAYMENT_LINK forever. They are parked as
 *      EXCLUDED with a reason and counted as skipped (FINX-4).
 *   4. Re-check duplicates against LIVE `Invoice` rows (not the draft) for
 *      the survivors — `(tenantId, periodLabel, studentId IN …)`. A hit
 *      flips that row to SKIPPED_ALREADY_INVOICED and writes nothing further
 *      for it. This runs strictly BEFORE the invoice-creation transaction,
 *      on the post-idempotency-filter row set, so a row can never both pass
 *      this check and be a duplicate committed elsewhere between draft and
 *      commit.
 *   5. For the remaining survivors, in ONE transaction: reserve invoice
 *      numbers, createMany invoices (status PENDING_PAYMENT_LINK), re-query
 *      to recover ids, createMany lines copied verbatim from the draft
 *      lines, then flip each row's invoiceId + status COMMITTED.
 *   6. If this chunk has survivors and the run is still DRAFT, flip it to
 *      COMMITTING — done right before starting the transaction in step 5,
 *      i.e. when the first chunk of actual work starts.
 *   7. After the transaction: best-effort payment-session fan-out at
 *      concurrency 2, exactly as the batch route. A fan-out failure never
 *      rolls back the committed invoices — it only leaves the invoice at
 *      PENDING_PAYMENT_LINK with a persisted paymentLinkError for retry.
 *   8. If no PENDING rows remain on the run afterward, flip it to COMMITTED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { success } = rateLimit(`commit-billing-run:${getClientIp(req)}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;
  const { id } = await params;

  // Step 1 — load the run, tenant-scoped.
  const run = await prisma.billingRun.findFirst({
    where: { id, tenantId },
  });
  if (!run) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  if (run.status !== "DRAFT" && run.status !== "COMMITTING") {
    return NextResponse.json(
      { error: "Run tagihan tidak lagi bisa dikomit" },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = commitBillingRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { rowIds } = parsed.data;

  // Step 2 — load the named rows scoped to THIS run. A rowId belonging to
  // another run (or that doesn't exist) simply fails the `billingRunId`
  // match and is silently dropped, per spec.
  const rows = await prisma.billingRunRow.findMany({
    where: { id: { in: rowIds }, billingRunId: id },
    include: { lines: true },
  });

  // Step 3 — idempotency guard. Only a PENDING row with no invoiceId yet is
  // committable. Everything else (COMMITTED, EXCLUDED, SKIPPED_*, or a row
  // that somehow carries an invoiceId despite a stale status) is skipped
  // without touching anything.
  const committable = rows.filter((r) => r.status === "PENDING" && r.invoiceId == null);
  const alreadyNonCommittable = rows.length - committable.length;

  let skipped = alreadyNonCommittable;
  const results: ResultRow[] = [];

  // Step 4 — re-check duplicates against LIVE Invoice data, ignoring the
  // draft entirely. This is the one guarantee that does NOT get the
  // "trust the draft" pass — a slow admin plus a fast parent (or a second
  // admin) can invoice the same student for the same period between draft
  // build and commit, and this is the only thing standing between that and
  // a double-billed family.
  //
  // Step 3b first — Rp 0 rows leave the pipeline before anything else. The
  // conditional where mirrors the claim below, so a concurrent commit that
  // already took the row is left alone.
  const zeroTotal = committable.filter((r) => isZeroTotal(r.totalDue));
  const billable = committable.filter((r) => !isZeroTotal(r.totalDue));
  if (zeroTotal.length > 0) {
    await prisma.billingRunRow.updateMany({
      where: { id: { in: zeroTotal.map((r) => r.id) }, status: "PENDING", invoiceId: null },
      data: { status: "EXCLUDED", error: ZERO_TOTAL_REASON },
    });
    skipped += zeroTotal.length;
    for (const r of zeroTotal) {
      results.push({
        rowId: r.id,
        studentId: r.studentId,
        studentName: r.studentNameSnapshot,
        status: "SKIPPED_ZERO_TOTAL",
      });
    }
  }

  let toCommit = billable;
  if (billable.length > 0) {
    const studentIds = billable.map((r) => r.studentId);
    // Compared on the NORMALISED period label, so "Okt 2026" after
    // "Oktober 2026" is recognised as the same period (FINX-6).
    const duplicateStudentIds = await findAlreadyInvoicedStudentIds(
      prisma,
      tenantId,
      run.periodLabel,
      studentIds,
    );

    const duplicateSkipped = billable.filter((r) => duplicateStudentIds.has(r.studentId));
    toCommit = billable.filter((r) => !duplicateStudentIds.has(r.studentId));

    if (duplicateSkipped.length > 0) {
      await prisma.billingRunRow.updateMany({
        where: { id: { in: duplicateSkipped.map((r) => r.id) } },
        data: { status: "SKIPPED_ALREADY_INVOICED" },
      });
      skipped += duplicateSkipped.length;
      for (const r of duplicateSkipped) {
        results.push({
          rowId: r.id,
          studentId: r.studentId,
          studentName: r.studentNameSnapshot,
          status: "SKIPPED_ALREADY_INVOICED",
        });
      }
    }
  }

  let txResult: CreatedRow[] = [];

  if (toCommit.length > 0) {
    // Step 6 — flip DRAFT → COMMITTING as this chunk's real work starts.
    if (run.status === "DRAFT") {
      await prisma.billingRun.update({ where: { id }, data: { status: "COMMITTING" } });
    }

    // Step 5 — one transaction: reserve numbers, create invoices + lines
    // verbatim from the draft, flip each row's invoiceId + status.
    txResult = await prisma.$transaction(async (tx) => {
      // CLAIM FIRST. The PENDING/invoiceId check above happened outside this
      // transaction, so on its own it is check-then-act: two overlapping
      // commits naming the same rowIds would both see PENDING, both find no
      // live duplicate, and both create an invoice — two payable invoices for
      // one family. That is not hypothetical: run-bulk-generate retries a
      // chunk with an identical body on any 5xx or network error, so a
      // client-perceived timeout while the server is still committing is
      // exactly this race.
      //
      // So the row claim is the FIRST write in the transaction, conditioned on
      // the row still being unclaimed. Invoice ids are pre-generated so the
      // claim can carry the real invoiceId (the same trick the create-draft
      // route uses for rows and lines). A concurrent transaction blocks on the
      // row lock, then re-evaluates the where clause after we commit, matches
      // nothing, and drops the row. Only claim winners get an invoice.
      const candidates = toCommit.map((row) => ({ row, invoiceId: randomUUID() }));
      const won: { row: (typeof toCommit)[number]; invoiceId: string }[] = [];
      for (const candidate of candidates) {
        const claim = await tx.billingRunRow.updateMany({
          where: { id: candidate.row.id, status: "PENDING", invoiceId: null },
          data: { status: "COMMITTED", invoiceId: candidate.invoiceId },
        });
        if (claim.count === 1) won.push(candidate);
      }
      if (won.length === 0) return [];

      const numbers = await reserveInvoiceNumbers(tx, tenantId, won.length);
      const plan = won.map(({ row, invoiceId }, idx) => ({
        row,
        invoiceId,
        invoiceNumber: numbers[idx],
      }));

      await tx.invoice.createMany({
        data: plan.map(({ row, invoiceId, invoiceNumber }) => ({
          id: invoiceId,
          tenantId,
          studentId: row.studentId,
          parentId: row.parentId,
          invoiceNumber,
          periodLabel: run.periodLabel,
          dueDate: run.dueDate,
          // Trust the draft — Cycle B1 Assumption 1. `totalDue` is the
          // row's stored value, never re-derived here.
          totalDue: row.totalDue,
          status: "PENDING_PAYMENT_LINK",
          createdBy: session.id,
        })),
      });

      // No re-query to recover ids — unlike the batch route, we generated
      // them above so the claim could carry them.
      await tx.invoiceLine.createMany({
        data: plan.flatMap(({ row, invoiceId }) =>
          row.lines.map((l) => ({
            invoiceId,
            feeComponentId: l.feeComponentId,
            labelSnapshot: l.labelSnapshot,
            amount: l.amount,
            adjustmentAmount: l.adjustmentAmount,
            adjustmentNote: l.adjustmentNote,
            finalAmount: l.finalAmount,
          })),
        ),
      });

      // No row update here — the claim above already set invoiceId + status,
      // which is the whole point of claiming first.

      return plan.map<CreatedRow>(({ row, invoiceId, invoiceNumber }) => ({
        rowId: row.id,
        invoiceId,
        invoiceNumber,
        studentId: row.studentId,
        studentName: row.studentNameSnapshot,
      }));
    });
  }

  // Step 7 — post-commit payment-session fan-out, best-effort, concurrency
  // capped at 2 exactly as the batch route. A failure here never rolls back
  // the invoices created above; it only leaves them PENDING_PAYMENT_LINK
  // with a persisted paymentLinkError for the retry surface.
  const runLimit = limit(2);
  const settled = await Promise.allSettled(
    txResult.map((row) =>
      runLimit(() =>
        createPaymentSessionForInvoice(row.invoiceId, tenantId, new URL(req.url).origin).then((res) => ({
          row,
          result: res,
        })),
      ),
    ),
  );

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const row = txResult[i];

    if (outcome.status === "fulfilled" && outcome.value.result) {
      try {
        await prisma.invoice.update({
          where: { id: row.invoiceId },
          data: { status: "SENT", sentAt: new Date(), paymentLinkError: null },
        });
      } catch {
        // Best-effort write-back; result row still surfaces success below.
      }
      results.push({
        rowId: row.rowId,
        studentId: row.studentId,
        studentName: row.studentName,
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        status: "SENT",
        paymentUrl: outcome.value.result.paymentUrl,
      });
    } else {
      const msg =
        outcome.status === "rejected"
          ? formatPaymentLinkError(outcome.reason)
          : formatPaymentLinkError(new Error("Gagal membuat sesi pembayaran"));
      try {
        await prisma.invoice.update({
          where: { id: row.invoiceId },
          data: { paymentLinkError: msg },
        });
      } catch {
        // Best-effort write-back; result row still surfaces failure below.
      }
      results.push({
        rowId: row.rowId,
        studentId: row.studentId,
        studentName: row.studentName,
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        status: "PENDING_PAYMENT_LINK",
        error: msg,
      });
    }
  }

  const created = txResult.length;

  // Bust parent-portal + student-invoice caches so newly-created invoices
  // show up on next fetch, same tags as app/api/invoices/[id]/route.ts and
  // the batch route.
  if (created > 0) {
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });
  }

  // Step 8 — flip the run to COMMITTED once no PENDING rows remain,
  // regardless of whether this particular chunk created anything (a chunk
  // that only resolved duplicates can still be the one that finishes a run).
  const remainingPending = await prisma.billingRunRow.count({
    where: { billingRunId: id, status: "PENDING" },
  });
  if (remainingPending === 0) {
    await prisma.billingRun.update({
      where: { id },
      data: { status: "COMMITTED", committedAt: new Date() },
    });
  }

  return NextResponse.json({ created, skipped, results });
}
