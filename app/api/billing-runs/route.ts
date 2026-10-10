import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { parsePagination, parseSort } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { createBillingRunSchema } from "@/lib/validations/billing-run";
import { materializeBillingRun } from "@/lib/finance/materialize-billing-run";

// Billing Run wizard (bulk invoice wizard arc, Cycle B1 —
// docs/cycles/2026-08-14-billing-run-wizard.md, Task T4).
//
// Deliberately NO `export const revalidate` here — a DRAFT run and its
// status are mutable and scoped to one in-flight admin session; caching the
// list would risk the resume UI (or a second admin) reading a stale draft
// state. Same reasoning as app/api/student-fee-adjustments/route.ts.

/**
 * ~200-student runs materialize ~600 rows/lines in one transaction — not
 * instant. Same ceiling as app/api/invoices/generate/batch/route.ts.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["createdAt", "periodLabel", "status"],
    default: "createdAt",
    defaultOrder: "desc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;

  const status = searchParams.get("status");
  const validStatuses = new Set(["DRAFT", "COMMITTING", "COMMITTED", "CANCELLED"]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (searchParams.get("unfinished") === "true") {
    where.status = { in: ["DRAFT", "COMMITTING"] };
  } else if (status && status !== "all") {
    if (!validStatuses.has(status)) {
      return NextResponse.json({ error: "Status tidak dikenal" }, { status: 400 });
    }
    where.status = status;
  }

  const [runs, total] = await Promise.all([
    prisma.billingRun.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        periodLabel: true,
        dueDate: true,
        academicYearId: true,
        status: true,
        createdAt: true,
        committedAt: true,
        createdBy: true,
      },
    }),
    prisma.billingRun.count({ where }),
  ]);

  return NextResponse.json(paginatedResponse(runs, total, page, pageSize));
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-billing-run:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const body = await req.json().catch(() => null);
  const parsed = createBillingRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { periodLabel, dueDate, academicYearId, classSectionIds, includeStudentIds, excludeStudentIds } =
    parsed.data;
  const trimmedLabel = periodLabel.trim();

  // Verify every referenced id belongs to this tenant before doing anything
  // — same pattern as app/api/student-fee-adjustments/route.ts and
  // app/api/fee-structure/route.ts. Each id set is checked separately since
  // they hit different tables.
  //
  // academicYearId is checked too, not just the scope arrays: it selects the
  // fee structures and keringanan the whole run is priced from, and it is
  // persisted onto the run. An unchecked value would price this tenant's
  // invoices off another tenant's fee table.
  const validYear = await prisma.academicYear.findFirst({
    where: { id: academicYearId, tenantId },
    select: { id: true },
  });
  if (!validYear) {
    return NextResponse.json({ error: "Tahun ajaran tidak ditemukan" }, { status: 404 });
  }

  if (classSectionIds.length > 0) {
    const validClassSections = await prisma.classSection.findMany({
      where: { id: { in: classSectionIds }, tenantId },
      select: { id: true, academicYearId: true },
    });
    if (validClassSections.length !== new Set(classSectionIds).size) {
      return NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 404 });
    }
    if (validClassSections.some(section => section.academicYearId !== academicYearId)) {
      return NextResponse.json({ error: "Kelas tidak sesuai tahun ajaran yang dipilih. Pilih ulang kelas atau ubah tahun ajaran." }, { status: 400 });
    }
  }

  const studentIdsToVerify = [...new Set([...includeStudentIds, ...excludeStudentIds])];
  if (studentIdsToVerify.length > 0) {
    const validStudents = await prisma.student.findMany({
      where: { id: { in: studentIdsToVerify }, tenantId },
      select: { id: true },
    });
    if (validStudents.length !== studentIdsToVerify.length) {
      return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
    }
  }

  // Draft-materialization path is shared with the rebuild route (Task T4) —
  // see lib/finance/materialize-billing-run.ts.
  const { rows, summary } = await materializeBillingRun(prisma, {
    tenantId,
    academicYearId,
    periodLabel: trimmedLabel,
    dueDate,
    scope: { classSectionIds, includeStudentIds, excludeStudentIds },
  });

  const rowsWithIds = rows.map((r) => ({ ...r, id: crypto.randomUUID() }));

  try {
    const run = await prisma.$transaction(
      async (tx) => {
        // Reject a second open draft — checked and created inside the same
        // Serializable transaction (mirrors app/api/payroll/generate/route.ts)
        // so two concurrent POSTs can't both pass the guard.
        const existingDraft = await tx.billingRun.findFirst({
          where: { tenantId, status: "DRAFT" },
          select: { id: true, periodLabel: true },
        });
        if (existingDraft) {
          throw Object.assign(new Error("DUPLICATE_DRAFT"), {
            existingId: existingDraft.id,
            existingPeriodLabel: existingDraft.periodLabel,
          });
        }

        const created = await tx.billingRun.create({
          data: {
            tenantId,
            academicYearId,
            periodLabel: trimmedLabel,
            dueDate,
            status: "DRAFT",
            scope: { classSectionIds, includeStudentIds, excludeStudentIds },
            createdBy: session.id,
          },
          select: { id: true },
        });

        if (rowsWithIds.length > 0) {
          await tx.billingRunRow.createMany({
            data: rowsWithIds.map((r) => ({
              id: r.id,
              billingRunId: created.id,
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

        return created;
      },
      { isolationLevel: "Serializable" },
    );

    return NextResponse.json({ id: run.id, summary }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === "DUPLICATE_DRAFT") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
      return NextResponse.json(
        {
          error: "Sudah ada draft tagihan yang belum diselesaikan",
          id: err.existingId,
          periodLabel: err.existingPeriodLabel,
        },
        { status: 409 },
      );
    }
    // Concurrent creates: Serializable write conflict (P2034) or a unique
    // collision (P2002) means another request is building the draft right now.
    const code = typeof e === "object" && e !== null && "code" in e ? (e as { code?: unknown }).code : undefined;
    if (code === "P2034" || code === "P2002") {
      return NextResponse.json(
        { error: "Tagihan sedang dibuat oleh proses lain. Coba lagi sebentar." },
        { status: 409 },
      );
    }
    throw e;
  }
}
