import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { validateBody } from "@/lib/api/validate";
import { recordAudit } from "@/lib/audit";
import { graduateStudentSchema } from "@/lib/validations/student";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`graduate-student:${getClientIp(req)}`, 5, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "students.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "students.edit" }, { status: 403 });
  }

  const { id: studentId } = await params;
  const result = await validateBody(graduateStudentSchema, await req.json().catch(() => ({})));
  if (result.error) return result.error;
  const { graduationDate } = result.data;

  // Verify student belongs to tenant
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId: session.tenantId },
  });
  if (!student) {
    return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
  }

  if (student.status === "GRADUATED") {
    return NextResponse.json({ error: "Siswa sudah lulus" }, { status: 400 });
  }

  // Verify student has at least one ACTIVE enrollment
  const activeEnrollments = await prisma.studentEnrollment.findMany({
    where: { studentId, status: "ACTIVE" },
  });
  if (activeEnrollments.length === 0) {
    return NextResponse.json({ error: "Siswa belum terdaftar di kelas aktif." }, { status: 400 });
  }

  const effectiveDate = graduationDate || getTodayInTimezone("Asia/Jakarta");

  // Transaction: update student status + graduate all active enrollments
  const updatedStudent = await prisma.$transaction(async (tx) => {
    const updated = await tx.student.update({
      where: { id: studentId },
      data: {
        status: "GRADUATED",
        graduationDate: effectiveDate,
      },
    });

    await tx.studentEnrollment.updateMany({
      where: { studentId, status: "ACTIVE" },
      data: { status: "GRADUATED" },
    });

    await recordAudit(
      {
        tenantId: session.tenantId!,
        actorId: session.id,
        entity: "Student",
        entityId: studentId,
        action: "graduate",
        after: { graduationDate: effectiveDate },
      },
      tx,
    );

    return updated;
  });

  return NextResponse.json(updatedStudent);
}
