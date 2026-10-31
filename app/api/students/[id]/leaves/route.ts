import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { recordAudit } from "@/lib/audit";
import { formatMonthLabel } from "@/lib/format";
import { ensureYearWritableById } from "@/lib/classes/year-guard";
import { LEAVE_RECORDED_AFTER_DRAFT_REASON } from "@/lib/finance/leave-exclusion";
import { createEnrollmentLeaveSchema } from "@/lib/validations/enrollment-leave";
import { parseYearMonth } from "@/lib/enrollment-leave/months";
import { academicYearBillingWindow, rangeInsideWindow } from "@/lib/enrollment-leave/window";
import { leaveEligibility } from "@/lib/enrollment-leave/eligibility";
import { findOpenRunsCoveredByLeave, type AffectedRun } from "@/lib/enrollment-leave/billing-runs";
import { findOpenInvoicesForLeave, hasOtherActiveEnrollments } from "@/lib/enrollment-leave/open-invoices";

// Cuti siswa (enrollment leave) — docs/cycles/2026-10-29-student-enrollment-leave.md.
//
// `[id]` is the studentId. A leave belongs to ONE enrollment; studentId and
// tenantId are always derived (enrollment / session), never read from the body.
//
// Deliberately NO `export const revalidate`: leaves are mutable and the billing
// wizard reads them at build time, so a cached list would be wrong for an hour.

/** A business-rule failure inside the transaction, mapped to its HTTP status. */
class LeaveError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "students.view")) {
    return NextResponse.json({ error: "forbidden", missing: "students.view" }, { status: 403 });
  }

  const { id: studentId } = await params;
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId: session.tenantId },
    select: { id: true, status: true },
  });
  if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });

  const [leaves, enrollments] = await Promise.all([
    prisma.enrollmentLeave.findMany({
      where: { tenantId: session.tenantId, studentId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { enrollment: { select: ENROLLMENT_SELECT } },
    }),
    prisma.studentEnrollment.findMany({
      where: { studentId, classSection: { tenantId: session.tenantId } },
      orderBy: [{ enrollDate: "desc" }, { id: "desc" }],
      select: ENROLLMENT_SELECT,
    }),
  ]);

  return NextResponse.json({
    data: leaves.map((leave) => ({
      id: leave.id,
      enrollmentId: leave.enrollmentId,
      startMonth: leave.startMonth,
      endMonth: leave.endMonth,
      reason: leave.reason,
      status: leave.status,
      createdBy: leave.createdBy,
      createdAt: leave.createdAt,
      cancelledBy: leave.cancelledBy,
      cancelledAt: leave.cancelledAt,
      enrollment: summarizeEnrollment(leave.enrollment),
    })),
    enrollments: enrollments.map((enrollment) => {
      const eligibility = leaveEligibility({
        enrollmentStatus: enrollment.status,
        studentStatus: student.status,
        yearStatus: enrollment.classSection.academicYear.status,
        year: enrollment.classSection.academicYear,
      });
      return {
        ...summarizeEnrollment(enrollment),
        eligible: eligibility.eligible,
        ineligibleReason: eligibility.ineligibleReason,
        window: eligibility.window,
      };
    }),
  });
}

const ENROLLMENT_SELECT = {
  id: true,
  status: true,
  classSection: {
    select: {
      name: true,
      program: { select: { name: true } },
      academicYear: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
    },
  },
} as const;

function summarizeEnrollment(enrollment: {
  id: string;
  status: string;
  classSection: {
    name: string;
    program: { name: string };
    academicYear: { id: string; name: string };
  };
}) {
  return {
    id: enrollment.id,
    status: enrollment.status,
    className: enrollment.classSection.name,
    programName: enrollment.classSection.program.name,
    academicYearId: enrollment.classSection.academicYear.id,
    academicYearName: enrollment.classSection.academicYear.name,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // A leave stops billing, so a student-data-only role must not record one.
  if (!hasPermission(session, "students.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "students.edit" }, { status: 403 });
  }
  if (!hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "forbidden", missing: "invoices.create" }, { status: 403 });
  }
  const { success } = rateLimit(`create-enrollment-leave:${session.id}`, 30, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi." }, { status: 429 });
  }
  const { tenantId, id: actorId } = session;

  const { id: studentId } = await params;
  const result = await validateBody(createEnrollmentLeaveSchema, await req.json().catch(() => ({})));
  if (result.error) return result.error;
  const { enrollmentId, startMonth, endMonth, reason } = result.data;

  const student = await prisma.student.findFirst({ where: { id: studentId, tenantId } });
  if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });

  // The enrollment decides the student and the tenant: it must belong to the
  // student in the URL and to a class of this tenant, or it does not exist here.
  const enrollment = await prisma.studentEnrollment.findFirst({
    where: { id: enrollmentId },
    select: {
      id: true,
      studentId: true,
      status: true,
      classSectionId: true,
      classSection: {
        select: {
          tenantId: true,
          academicYearId: true,
          academicYear: { select: { name: true, startDate: true, endDate: true } },
        },
      },
    },
  });
  if (!enrollment || enrollment.studentId !== studentId || enrollment.classSection.tenantId !== tenantId) {
    return NextResponse.json({ error: "Pendaftaran kelas tidak ditemukan" }, { status: 404 });
  }
  if (student.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Cuti hanya bisa dicatat untuk siswa yang aktif.", code: "STUDENT_NOT_ACTIVE" },
      { status: 409 },
    );
  }
  if (enrollment.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Cuti hanya bisa dicatat untuk pendaftaran kelas yang aktif.", code: "ENROLLMENT_NOT_ACTIVE" },
      { status: 409 },
    );
  }

  const yearGuard = await ensureYearWritableById(
    enrollment.classSection.academicYearId,
    tenantId,
    "Cuti tidak bisa dicatat di tahun ajaran yang sudah diarsipkan.",
  );
  if (yearGuard instanceof NextResponse) return yearGuard;

  // A leave billing could never see is refused rather than silently ignored.
  const window = academicYearBillingWindow(enrollment.classSection.academicYear);
  const start = parseYearMonth(startMonth);
  const end = parseYearMonth(endMonth);
  if (!window || !start || !end) {
    return NextResponse.json(
      { error: "Tahun ajaran kelas ini belum punya rentang bulan yang valid.", code: "NO_ACADEMIC_YEAR_WINDOW" },
      { status: 409 },
    );
  }
  if (!rangeInsideWindow({ start, end }, window)) {
    return NextResponse.json(
      {
        error: `Bulan cuti harus berada di dalam tahun ajaran ${enrollment.classSection.academicYear.name} (${formatMonthLabel(window.from.year, window.from.month)} sampai ${formatMonthLabel(window.to.year, window.to.month)}).`,
        code: "OUTSIDE_ACADEMIC_YEAR",
      },
      { status: 400 },
    );
  }

  try {
    const { leave, affectedRuns } = await prisma.$transaction(async (tx) => {
      // Two requests for one enrollment queue here, so the overlap check below
      // sees the first one's row.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`enrollment-leave:${enrollmentId}`}))`;

      // YYYY-MM compares correctly as text: [a,b] and [c,d] overlap iff a<=d and c<=b.
      const overlapping = await tx.enrollmentLeave.findFirst({
        where: {
          tenantId,
          enrollmentId,
          status: "ACTIVE",
          startMonth: { lte: endMonth },
          endMonth: { gte: startMonth },
        },
        select: { id: true },
      });
      if (overlapping) {
        throw new LeaveError("Cuti ini tumpang tindih dengan cuti lain.", 409, "LEAVE_OVERLAP");
      }

      const created = await tx.enrollmentLeave.create({
        data: {
          tenantId,
          studentId: enrollment.studentId,
          enrollmentId,
          startMonth,
          endMonth,
          reason,
          createdBy: actorId,
        },
      });

      // A draft built before this leave would still bill the child on commit.
      // Park the student's PENDING rows as EXCLUDED; a row the commit has already
      // claimed (invoiceId set, or status past PENDING) is left alone. An EXCLUDED
      // row stays as it is: it is already not billable and keeps the admin's own
      // choice (or its Rp 0 reason), so a rebuild never turns it back on.
      const openRuns = await findOpenRunsCoveredByLeave(tx, {
        tenantId,
        startMonth,
        endMonth,
        placement: {
          studentId: enrollment.studentId,
          classSectionId: enrollment.classSectionId,
          academicYearId: enrollment.classSection.academicYearId,
        },
      });
      const touched: AffectedRun[] = [];
      for (const run of openRuns) {
        const updated = await tx.billingRunRow.updateMany({
          where: {
            billingRunId: run.id,
            studentId: enrollment.studentId,
            status: "PENDING",
            invoiceId: null,
          },
          data: { status: "EXCLUDED", error: LEAVE_RECORDED_AFTER_DRAFT_REASON },
        });
        if ((updated?.count ?? 0) > 0) touched.push(run);
      }

      await recordAudit(
        {
          tenantId,
          actorId,
          entity: "EnrollmentLeave",
          entityId: created.id,
          action: "create",
          after: {
            studentId: created.studentId,
            enrollmentId,
            startMonth,
            endMonth,
            reason,
            excludedFromRunIds: touched.map((r) => r.id),
          },
        },
        tx,
      );
      return { leave: created, affectedRuns: touched };
    });

    // After the commit: a read failure here must not turn a saved leave into a 500.
    let openInvoices: Awaited<ReturnType<typeof findOpenInvoicesForLeave>> | null = null;
    let otherActiveEnrollments = false;
    try {
      if (hasPermission(session, "invoices.view")) {
        openInvoices = await findOpenInvoicesForLeave(prisma, {
          tenantId,
          studentId: enrollment.studentId,
          startMonth,
          endMonth,
        });
      }
      otherActiveEnrollments = await hasOtherActiveEnrollments(prisma, {
        tenantId,
        studentId: enrollment.studentId,
        enrollmentId,
        academicYearId: enrollment.classSection.academicYearId,
      });
    } catch (err) {
      console.error("enrollment-leave follow-up:", err);
    }

    return NextResponse.json(
      {
        leave,
        affectedRuns,
        openInvoices,
        canVoid: hasPermission(session, "invoices.void"),
        otherActiveEnrollments,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof LeaveError) {
      return NextResponse.json(
        { error: err.message, ...(err.code ? { code: err.code } : {}) },
        { status: err.status },
      );
    }
    console.error("create enrollment leave:", err);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}
