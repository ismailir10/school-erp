import { lockEnrollmentTopology, lockEnrollmentStreams } from "@/lib/enrollment/topology-lock";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { validateBody } from "@/lib/api/validate";
import { promoteStudentSchema } from "@/lib/validations/student";
import { ensureYearWritableById } from "@/lib/classes/year-guard";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`promote-student:${getClientIp(req)}`, 5, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;
  if (!hasPermission(session, "students.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "students.edit" }, { status: 403 });
  }

  const { id: studentId } = await params;
  const result = await validateBody(promoteStudentSchema, await req.json().catch(() => ({})));
  if (result.error) return result.error;
  const { targetClassSectionId, notes } = result.data;

  // Verify student belongs to tenant
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId: tenantId },
  });
  if (!student) {
    return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
  }

  // Tenant check on target (the capacity check itself is locked inside the
  // transaction below — mirror of the enroll route pattern). Also loads the
  // target's program type, which scopes the source-enrollment lookup below.
  const targetExists = await prisma.classSection.findFirst({
    where: { id: targetClassSectionId, tenantId: tenantId },
    select: { id: true, academicYearId: true, program: { select: { id: true, type: true } } },
  });
  if (!targetExists) {
    return NextResponse.json({ error: "Kelas tujuan tidak ditemukan" }, { status: 404 });
  }

  // Refuse promotion into a class whose academic year is ARCHIVED — past
  // years are immutable for audit integrity.
  const yearGuard = await ensureYearWritableById(
    targetExists.academicYearId,
    tenantId,
    "Pilih kelas pada tahun ajaran yang aktif.",
  );
  if (yearGuard instanceof NextResponse) return yearGuard;

  const today = getTodayInTimezone("Asia/Jakarta");

  // Transaction: lock target section row, re-check capacity, graduate old
  // enrollment, create/upsert new one. SELECT … FOR UPDATE prevents two
  // concurrent promotes from both seeing "one seat free" and overflowing.
  try {
    const newEnrollment = await prisma.$transaction(async (tx) => {
      await lockEnrollmentTopology(tx, tenantId, "shared");
      const target = await tx.classSection.findFirst({
        where: { id: targetClassSectionId, tenantId: tenantId },
        select: { id: true, academicYearId: true, program: { select: { id: true, type: true } } },
      });
      if (!target || target.academicYearId !== targetExists.academicYearId ||
          target.program.id !== targetExists.program.id || target.program.type !== targetExists.program.type) {
        throw new PromoteError("Program kelas baru saja berubah. Muat ulang lalu coba lagi.", 409);
      }
      await lockEnrollmentStreams(tx, [studentId], target.academicYearId, target.program.type);
      // Choose the earliest live source of this stream, preserving a separate daycare enrollment.
      const currentEnrollment = await tx.studentEnrollment.findFirst({
        where: { studentId, status: "ACTIVE", classSection: {
          academicYear: { NOT: { status: "ARCHIVED" } }, program: { type: target.program.type },
        } },
        orderBy: { classSection: { academicYear: { startDate: "asc" } } },
      });
      if (!currentEnrollment) throw new PromoteError("Siswa belum terdaftar di kelas aktif", 400);
      const conflict = await tx.studentEnrollment.findFirst({
        where: {
          studentId, status: "ACTIVE", id: { not: currentEnrollment.id },
          classSectionId: { not: targetClassSectionId },
          classSection: { academicYearId: target.academicYearId, program: { type: target.program.type } },
        },
        select: { classSection: { select: { name: true } } },
      });
      if (conflict) throw new PromoteError(`Siswa sudah terdaftar di kelas ${conflict.classSection.name} pada tahun ajaran ini.`, 409);

      const rows = await tx.$queryRaw<Array<{ id: string; capacity: number }>>`
        SELECT cs.id, cs.capacity FROM "ClassSection" cs
        WHERE cs.id = ${targetClassSectionId}
        FOR UPDATE OF cs
      `;
      if (rows.length === 0) {
        throw new PromoteError("Kelas tujuan tidak ditemukan", 404);
      }
      const activeCount = await tx.studentEnrollment.count({ where: { classSectionId: targetClassSectionId, status: "ACTIVE" } });
      const existingTarget = await tx.studentEnrollment.findUnique({
        where: { studentId_classSectionId: { studentId, classSectionId: targetClassSectionId } },
        select: { status: true },
      });
      if (existingTarget?.status !== "ACTIVE" && activeCount >= rows[0].capacity) {
        throw new PromoteError(
          `Kelas tujuan penuh (${activeCount}/${rows[0].capacity})`,
        );
      }

      await tx.studentEnrollment.update({
        where: { id: currentEnrollment.id },
        data: { status: "GRADUATED", notes: notes || undefined },
      });

      return tx.studentEnrollment.upsert({
        where: { studentId_classSectionId: { studentId, classSectionId: targetClassSectionId } },
        create: {
          studentId,
          classSectionId: targetClassSectionId,
          enrollDate: today,
          status: "ACTIVE",
          notes: notes || null,
        },
        update: {
          status: "ACTIVE",
          enrollDate: today,
          notes: notes || null,
        },
        include: {
          classSection: { select: { id: true, name: true } },
        },
      });
    });

    return NextResponse.json(newEnrollment, { status: 201 });
  } catch (err) {
    if (err instanceof PromoteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("promote:", err);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}

class PromoteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
