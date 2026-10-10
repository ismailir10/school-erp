import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { validateBody } from "@/lib/api/validate";
import { enrollStudentSchema } from "@/lib/validations/student";
import { ensureYearWritableById } from "@/lib/classes/year-guard";
import { evaluateAgeFit } from "@/lib/enrollment/age-fit";
import { findStreamConflict, findWithdrawnEnrollment } from "@/lib/enrollment/active";
import { recordAudit } from "@/lib/audit";
import { isUniqueViolation } from "@/app/api/admin/classes/_helpers";
import { studentNotActiveResponse } from "@/lib/students/guards";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "students.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "students.edit" }, { status: 403 });
  }
  // Keyed per admin, not per IP: every admin behind the school NAT shares one
  // IP, so the old 5/min-per-IP budget was exhausted by a single enrolment
  // session (X-9).
  const { success } = rateLimit(`enroll-student:${session.id}`, 30, 60_000);
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak pendaftaran dalam satu menit. Tunggu sebentar, lalu coba lagi." },
      { status: 429 },
    );
  }
  // Narrowed to non-null locals — `session.tenantId` doesn't stay narrowed
  // inside the $transaction closure below, since TS can't prove the
  // callback runs before any (hypothetical) reassignment of `session`.
  const { tenantId, id: actorId } = session;

  const { id: studentId } = await params;
  const result = await validateBody(enrollStudentSchema, await req.json().catch(() => ({})));
  if (result.error) return result.error;
  const { classSectionId, ageOverrideReason } = result.data;

  // Verify student belongs to tenant
  const student = await prisma.student.findFirst({ where: { id: studentId, tenantId: session.tenantId } });
  if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
  // ADM-1: withdrawn / graduated / inactive students must be reactivated first.
  const notActive = studentNotActiveResponse(student.status);
  if (notActive) return notActive;

  // Tenant-guard the section lookup — a caller from tenant A must not be able to enroll into
  // a tenant B section by passing its id. Also loads the program (age bounds + stream type)
  // and the academic year's startDate, which is the age-fit reference point.
  const sectionInfo = await prisma.classSection.findFirst({
    where: { id: classSectionId, tenantId: session.tenantId },
    include: { program: true, academicYear: { select: { startDate: true } } },
  });
  if (!sectionInfo) return NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 404 });

  // Refuse enrolment into a class whose academic year is ARCHIVED — past
  // years are immutable for audit integrity.
  const yearGuard = await ensureYearWritableById(
    sectionInfo.academicYearId,
    session.tenantId,
    "Pilih kelas pada tahun ajaran yang aktif.",
  );
  if (yearGuard instanceof NextResponse) return yearGuard;

  // ADM-10: answer "already enrolled" before the age-fit override. Otherwise
  // the dialog first demands an override reason and only then reports that
  // the student is already in a class. The in-transaction check below stays
  // for race safety.
  const existingConflict = await findStreamConflict(prisma, {
    studentId,
    academicYearId: sectionInfo.academicYearId,
    programType: sectionInfo.program.type,
  });
  if (existingConflict) {
    return NextResponse.json(
      {
        error: `Siswa sudah terdaftar di kelas ${existingConflict.classSection.name} pada tahun ajaran ini.`,
        code: "ALREADY_ENROLLED",
        existingClassSectionId: existingConflict.classSectionId,
      },
      { status: 409 },
    );
  }

  // Age band is advisory, never a hard block. Both bounds are checked
  // independently against the child's age at the target year's start
  // (calendar-correct, not "today" — the same request must verdict the same
  // in July and in March). An out-of-range verdict can be overridden with a
  // non-empty reason, audited below.
  const ageFit = evaluateAgeFit({
    dob: student.dateOfBirth,
    referenceDate: sectionInfo.academicYear.startDate,
    ageMin: sectionInfo.program.ageMin,
    ageMax: sectionInfo.program.ageMax,
    programName: sectionInfo.program.name,
  });
  const ageOutOfRange = ageFit.status === "BELOW_MIN" || ageFit.status === "ABOVE_MAX";
  if (ageOutOfRange && !ageOverrideReason) {
    return NextResponse.json(
      {
        error: ageFit.message,
        code: "AGE_OUT_OF_RANGE",
        ageMonths: ageFit.ageMonths,
        ageMin: sectionInfo.program.ageMin,
        ageMax: sectionInfo.program.ageMax,
      },
      { status: 409 },
    );
  }

  // Atomic stream-conflict guard + capacity check
  const today = getTodayInTimezone("Asia/Jakarta");
  try {
    const enrollment = await prisma.$transaction(async (tx) => {
      // Student-stream advisory lock — MUST be the first statement in this
      // transaction, before findStreamConflict below. Without it, two
      // concurrent POSTs enrolling the SAME student into TWO DIFFERENT
      // sections of the SAME program type in the SAME year each take only
      // the per-class lock (below), so under Read Committed neither sees the
      // other's uncommitted row: both findStreamConflict calls return null,
      // both creates succeed, and the student ends up with two ACTIVE rows
      // of the same stream. Locking order is fixed to (1) student-stream,
      // then (2) class — identically in this door and in
      // app/api/admin/classes/[id]/enrollments/route.ts — so two concurrent
      // requests can never deadlock by acquiring the two locks in opposite
      // orders.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${studentId}:${sectionInfo.academicYearId}:${sectionInfo.program.type}`}))`;

      // One ACTIVE enrollment per Program.type per academic year — scoped to
      // the target class's year, so a stale ACTIVE row in an ARCHIVED year
      // never blocks a fresh enrolment (16 of 21 current-year students carry
      // one; see cycle doc). A SEMESTER (sekolah) row and a YEAR_ROUND
      // (daycare) row may coexist in the same year.
      const conflict = await findStreamConflict(tx, {
        studentId,
        academicYearId: sectionInfo.academicYearId,
        programType: sectionInfo.program.type,
      });
      if (conflict) {
        throw new EnrollError(
          `Siswa sudah terdaftar di kelas ${conflict.classSection.name} pada tahun ajaran ini.`,
          409,
          "ALREADY_ENROLLED",
          { existingClassSectionId: conflict.classSectionId },
        );
      }

      // Lock the class section row to prevent concurrent enrollment, then count ACTIVE
      // enrollments separately. Postgres forbids combining `FOR UPDATE` with `GROUP BY` in
      // a single SELECT, so the previous single-query form raised 0A000 and surfaced as 500.
      // Splitting into two statements inside the same transaction preserves the row lock:
      // row-level locks are held until commit/rollback, so concurrent enrollers block on
      // the SELECT FOR UPDATE. This is the "class lock" that the student-stream lock above
      // is always acquired before — never after.
      const section = await tx.$queryRaw<Array<{ id: string; capacity: number }>>`
        SELECT id, capacity FROM "ClassSection" WHERE id = ${classSectionId} FOR UPDATE
      `;
      if (section.length === 0) {
        throw new EnrollError("Kelas tidak ditemukan", 404);
      }
      const activeCount = await tx.studentEnrollment.count({
        where: { classSectionId, status: "ACTIVE" },
      });
      if (activeCount >= section[0].capacity) {
        throw new EnrollError(`Kelas penuh (${activeCount}/${section[0].capacity})`);
      }

      // CORE-2: a WITHDRAWN row left by an earlier deactivation occupies the
      // (studentId, classSectionId) unique key — reactivate it rather than
      // insert (which 409'd with a misleading "sudah terdaftar").
      const withdrawn = await findWithdrawnEnrollment(tx, { studentId, classSectionId });
      const created = withdrawn
        ? await tx.studentEnrollment.update({
            where: { id: withdrawn.id },
            data: { status: "ACTIVE", enrollDate: today },
          })
        : await tx.studentEnrollment.create({
            data: { studentId, classSectionId, enrollDate: today },
          });

      // The age band was out of range and the admin supplied an override
      // reason — persist it. The `tx` form of recordAudit re-throws on
      // failure, so the reason can never be silently lost if the audit
      // write itself fails.
      if (ageOutOfRange && ageOverrideReason) {
        await recordAudit(
          {
            tenantId,
            actorId,
            entity: "StudentEnrollment",
            entityId: created.id,
            action: "student.enroll.age-override",
            after: {
              reason: ageOverrideReason,
              ageMonths: ageFit.ageMonths,
              ageMin: sectionInfo.program.ageMin,
              ageMax: sectionInfo.program.ageMax,
              programId: sectionInfo.program.id,
            },
          },
          tx,
        );
      }

      return created;
    });

    return NextResponse.json(enrollment, { status: 201 });
  } catch (err) {
    if (err instanceof EnrollError) {
      return NextResponse.json(
        { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.extra ?? {}) },
        { status: err.status },
      );
    }
    // A race lost against `@@unique([studentId, classSectionId])` — the
    // student-stream advisory lock above prevents the double-stream race,
    // but not two concurrent requests for the identical (studentId,
    // classSectionId) pair. Same body shape as the classes door
    // (app/api/admin/classes/[id]/enrollments/route.ts) so both doors are
    // parity-identical for this condition.
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          error: "Siswa sudah terdaftar di kelas ini.",
          code: "ALREADY_ENROLLED",
        },
        { status: 409 },
      );
    }
    console.error("enroll:", err);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}

class EnrollError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, unknown>;
  constructor(message: string, status = 400, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
