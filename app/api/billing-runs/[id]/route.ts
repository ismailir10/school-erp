import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { parsePagination } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { cancelBillingRunSchema } from "@/lib/validations/billing-run";

// Billing Run wizard (Cycle B1 — docs/cycles/2026-08-14-billing-run-wizard.md,
// Task T5).
//
// Deliberately NO `export const revalidate` here — draft state is mutable
// and per-request; caching would risk step 2/3 of the wizard rendering a
// stale row list after an exclude/re-include or after commit progresses.

const ROW_STATUSES = new Set([
  "PENDING",
  "EXCLUDED",
  "SKIPPED_ALREADY_INVOICED",
  "SKIPPED_NO_FEE_STRUCTURE",
  "SKIPPED_ON_LEAVE",
  "COMMITTED",
  "FAILED",
]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const run = await prisma.billingRun.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!run) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);

  const status = searchParams.get("status");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { billingRunId: id };
  if (status && status !== "all") {
    if (!ROW_STATUSES.has(status)) {
      return NextResponse.json({ error: "Status tidak dikenal" }, { status: 400 });
    }
    where.status = status;
  }

  const [rows, total] = await Promise.all([
    prisma.billingRunRow.findMany({
      where,
      skip,
      take,
      orderBy: { studentNameSnapshot: "asc" },
      include: { lines: true },
    }),
    prisma.billingRunRow.count({ where }),
  ]);

  // Which program each row is billed from. A row stores only its class label,
  // and the fee structure follows the class's program, so a class linked to
  // the wrong program is invisible without this. The run is scoped per student
  // (docs/cycles/2026-10-29-school-daycare-bundle-price.md): a student in the run
  // is priced for ALL their active placements that year, so every one is listed.
  // Read from the current enrolments, like the builder (active student, active
  // enrolment): a class moved to another program after the draft was built
  // shows its new program here while the lines still carry the old price, which
  // is exactly the cue to rebuild the draft.
  const enrollments =
    rows.length === 0
      ? []
      : await prisma.studentEnrollment.findMany({
          where: {
            studentId: { in: rows.map((r) => r.studentId) },
            status: "ACTIVE",
            student: { status: "ACTIVE" },
            classSection: { tenantId: session.tenantId, academicYearId: run.academicYearId },
          },
          select: {
            studentId: true,
            classSectionId: true,
            classSection: { select: { program: { select: { name: true } } } },
          },
        });
  const programsByStudent = new Map<string, Set<string>>();
  for (const e of enrollments) {
    const names = programsByStudent.get(e.studentId) ?? new Set<string>();
    names.add(e.classSection.program.name);
    programsByStudent.set(e.studentId, names);
  }
  const rowsWithProgram = rows.map((r) => {
    const names = programsByStudent.get(r.studentId);
    return { ...r, programLabel: names && names.size > 0 ? [...names].sort().join(", ") : null };
  });

  return NextResponse.json({
    id: run.id,
    periodLabel: run.periodLabel,
    dueDate: run.dueDate,
    academicYearId: run.academicYearId,
    status: run.status,
    scope: run.scope,
    createdAt: run.createdAt,
    committedAt: run.committedAt,
    rows: paginatedResponse(rowsWithProgram, total, page, pageSize),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { success } = rateLimit(`cancel-billing-run:${getClientIp(req)}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.billingRun.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!existing) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = cancelBillingRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Allowlist DRAFT rather than denylisting COMMITTED. A COMMITTED run is a
  // financial record whose rows already carry invoiceIds, and a COMMITTING
  // run has a commit in flight — cancelling either mid-way would leave
  // invoices written against a run marked CANCELLED. Only a DRAFT is safe to
  // throw away, and a new status added later defaults to "not cancellable"
  // instead of silently becoming cancellable.
  if (existing.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Hanya draf yang bisa dibatalkan" },
      { status: 409 },
    );
  }

  const run = await prisma.billingRun.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json(run);
}
