import { lockEnrollmentTopology } from "@/lib/enrollment/topology-lock";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { enrollmentAddSchema } from "@/lib/validations/class";
import { ensureYearWritableForClass } from "@/lib/classes/year-guard";
import { evaluateAgeFit } from "@/lib/enrollment/age-fit";
import { findStreamConflict, findWithdrawnEnrollment } from "@/lib/enrollment/active";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { JAKARTA_TZ } from "@/lib/sessions/dates";
import { studentNotActiveResponse } from "@/lib/students/guards";
import {
  CLASS_WRITE_BUDGET,
  CLASS_WRITE_WINDOW_MS,
  isUniqueViolation,
} from "../../_helpers";

// Add a student to a class's roster. The class is identified by the [id] path
// segment (ClassSection.id). Age-fit check + capacity check + stream-conflict
// guard + the ARCHIVED-year guard all run before the create.

// `ageOverrideReason` isn't part of the shared `enrollmentAddSchema` (other
// callers of that schema have no use for it) — extended locally so this door
// validates the field identically to the students-detail door's
// `enrollStudentSchema` (`lib/validations/student.ts`) without changing the
// shared schema's shape.
const enrollmentAddWithOverrideSchema = enrollmentAddSchema.extend({
  ageOverrideReason: z.string().trim().min(1).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id: classId } = await ctx.params;

  const { success } = rateLimit(
    `class-enrollment-add:${getClientIp(req)}`,
    CLASS_WRITE_BUDGET,
    CLASS_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const yearGuard = await ensureYearWritableForClass(classId, session.tenantId);
  if (yearGuard instanceof NextResponse) return yearGuard;

  const parsed = await validateBody(enrollmentAddWithOverrideSchema, await req.json());
  if (parsed.error) return parsed.error;
  const { studentId, ageOverrideReason } = parsed.data;

  const classSection = await prisma.classSection.findFirst({
    where: { id: classId, tenantId: session.tenantId },
    select: {
      id: true,
      capacity: true,
      academicYearId: true,
      name: true,
      program: {
        select: { id: true, type: true, name: true, ageMin: true, ageMax: true },
      },
      academicYear: { select: { startDate: true } },
    },
  });
  if (!classSection) {
    return NextResponse.json(
      { error: "Kelas tidak ditemukan" },
      { status: 404 },
    );
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId: session.tenantId },
    select: { id: true, name: true, dateOfBirth: true, status: true },
  });
  if (!student) {
    return NextResponse.json(
      { error: "Siswa tidak ditemukan." },
      { status: 400 },
    );
  }
  // ADM-1: withdrawn / graduated / inactive students must be reactivated
  // first. The roster picker adds one student per request, so the whole
  // request is rejected (there is no partial result to report).
  const notActive = studentNotActiveResponse(student.status);
  if (notActive) return notActive;

  // ADM-10: "already enrolled" is answered before the age-fit override (same
  // order as the students-detail door). The in-transaction check stays for
  // race safety.
  const existingConflict = await findStreamConflict(prisma, {
    studentId,
    academicYearId: classSection.academicYearId,
    programType: classSection.program.type,
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

  // Age band is advisory, never a hard block. Same evaluateAgeFit call and
  // same 409 AGE_OUT_OF_RANGE shape as the students-detail door
  // (`app/api/students/[id]/enroll/route.ts`), so both doors return an
  // identical body for the identical condition.
  const ageFit = evaluateAgeFit({
    dob: student.dateOfBirth,
    referenceDate: classSection.academicYear.startDate,
    ageMin: classSection.program.ageMin,
    ageMax: classSection.program.ageMax,
    programName: classSection.program.name,
  });
  const ageOutOfRange = ageFit.status === "BELOW_MIN" || ageFit.status === "ABOVE_MAX";
  if (ageOutOfRange && !ageOverrideReason) {
    return NextResponse.json(
      {
        error: ageFit.message,
        code: "AGE_OUT_OF_RANGE",
        ageMonths: ageFit.ageMonths,
        ageMin: classSection.program.ageMin,
        ageMax: classSection.program.ageMax,
      },
      { status: 409 },
    );
  }

  try {
    // Shared topology guard → fresh class snapshot → student-stream lock →
    // class lock, in the same order as the students-detail enrollment door.
    // The topology guard prevents program changes during the stream check;
    // shared guards still allow unrelated enrollments to proceed together.
    // The student-stream lock serialises one student's same-type/year writes,
    // while the class lock protects the capacity check from parallel additions.
    const today = getTodayInTimezone(JAKARTA_TZ);
    const created = await prisma.$transaction(async (tx) => {
      await lockEnrollmentTopology(tx, session.tenantId, "shared");
      const freshSection = await tx.classSection.findFirst({
        where: { id: classId, tenantId: session.tenantId },
        select: { academicYearId: true, program: { select: { id: true, type: true } } },
      });
      if (!freshSection || freshSection.academicYearId !== classSection.academicYearId ||
          freshSection.program.id !== classSection.program.id || freshSection.program.type !== classSection.program.type) {
        throw new EnrollmentBlocked("CLASS_CHANGED_MEANWHILE", { message: "Program kelas baru saja berubah. Muat ulang lalu coba lagi.", status: 409 });
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${studentId}:${classSection.academicYearId}:${classSection.program.type}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${classId}))`;

      const activeCount = await tx.studentEnrollment.count({
        where: { classSectionId: classId, status: "ACTIVE" },
      });
      if (activeCount >= classSection.capacity) {
        throw new EnrollmentBlocked("CAPACITY_EXCEEDED", {
          message: `Kelas penuh (${activeCount}/${classSection.capacity}). Naikkan kapasitas terlebih dahulu.`,
          status: 422,
        });
      }

      // One ACTIVE enrollment per Program.type per academic year — scoped
      // to this class's year, so a stale ACTIVE row in an ARCHIVED year
      // never blocks a fresh enrolment, and cross-type (school + daycare)
      // enrolment in the same year is allowed.
      const conflict = await findStreamConflict(tx, {
        studentId,
        academicYearId: classSection.academicYearId,
        programType: classSection.program.type,
      });
      if (conflict) {
        throw new EnrollmentBlocked("ALREADY_ENROLLED", {
          message: `Siswa sudah terdaftar di kelas ${conflict.classSection.name} pada tahun ajaran ini.`,
          status: 409,
          extra: { existingClassSectionId: conflict.classSectionId },
        });
      }

      const enrollmentSelect = {
        id: true,
        enrollDate: true,
        status: true,
        student: { select: { id: true, name: true, nis: true } },
      } as const;
      // CORE-2: reactivate a WITHDRAWN row for this exact (student, class)
      // pair instead of tripping the unique key — see findWithdrawnEnrollment.
      const withdrawn = await findWithdrawnEnrollment(tx, { studentId, classSectionId: classId });
      const newEnrollment = withdrawn
        ? await tx.studentEnrollment.update({
            where: { id: withdrawn.id },
            data: { status: "ACTIVE", enrollDate: today },
            select: enrollmentSelect,
          })
        : await tx.studentEnrollment.create({
            data: {
              studentId,
              classSectionId: classId,
              enrollDate: today,
              status: "ACTIVE",
            },
            select: enrollmentSelect,
          });

      // The age band was out of range and the admin supplied an override
      // reason — persist it. The `tx` form of recordAudit re-throws on
      // failure, so the reason can never be silently lost if the audit
      // write itself fails.
      if (ageOutOfRange && ageOverrideReason) {
        await recordAudit(
          {
            tenantId: session.tenantId,
            actorId: session.id,
            entity: "StudentEnrollment",
            entityId: newEnrollment.id,
            action: "student.enroll.age-override",
            after: {
              reason: ageOverrideReason,
              ageMonths: ageFit.ageMonths,
              ageMin: classSection.program.ageMin,
              ageMax: classSection.program.ageMax,
              programId: classSection.program.id,
            },
          },
          tx,
        );
      }

      return newEnrollment;
    });

    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "StudentEnrollment",
      entityId: created.id,
      action: "class.enrollment.add",
      after: {
        studentId,
        classSectionId: classId,
        className: classSection.name,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof EnrollmentBlocked) {
      return NextResponse.json(
        { error: err.detail.message, code: err.code, ...(err.detail.extra ?? {}) },
        { status: err.detail.status },
      );
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          error: "Siswa sudah terdaftar di kelas ini.",
          code: "ALREADY_ENROLLED",
        },
        { status: 409 },
      );
    }
    throw err;
  }
}

class EnrollmentBlocked extends Error {
  constructor(
    public readonly code: "CAPACITY_EXCEEDED" | "ALREADY_ENROLLED" | "CLASS_CHANGED_MEANWHILE",
    public readonly detail: {
      message: string;
      status: number;
      extra?: Record<string, unknown>;
    },
  ) {
    super(detail.message);
    this.name = "EnrollmentBlocked";
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id: classId } = await ctx.params;

  const { success } = rateLimit(
    `class-enrollment-remove:${getClientIp(req)}`,
    CLASS_WRITE_BUDGET,
    CLASS_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const yearGuard = await ensureYearWritableForClass(classId, session.tenantId);
  if (yearGuard instanceof NextResponse) return yearGuard;

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("studentId");
  if (!studentId) {
    return NextResponse.json(
      { error: "studentId wajib disediakan." },
      { status: 400 },
    );
  }

  // Tenant scope is intrinsic — both the class and the student are filtered.
  const enrollment = await prisma.studentEnrollment.findFirst({
    where: {
      studentId,
      classSectionId: classId,
      status: "ACTIVE",
      classSection: { tenantId: session.tenantId },
    },
    select: { id: true, studentId: true },
  });
  if (!enrollment) {
    return NextResponse.json(
      { error: "Pendaftaran tidak ditemukan." },
      { status: 404 },
    );
  }

  await prisma.studentEnrollment.update({
    where: { id: enrollment.id },
    data: { status: "WITHDRAWN" },
  });

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "StudentEnrollment",
    entityId: enrollment.id,
    action: "class.enrollment.remove",
    before: { studentId, classSectionId: classId, status: "ACTIVE" },
    after: { status: "WITHDRAWN" },
  });

  return NextResponse.json({ ok: true });
}
