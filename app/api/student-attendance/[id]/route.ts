import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { updateStudentAttendanceSchema } from "@/lib/validations/student-attendance";
import { requireTeacherForClass } from "@/lib/student-journal/guards";

type Params = { params: Promise<{ id: string }> };

async function getOwnedRecord(id: string, tenantId: string) {
  const record = await prisma.studentAttendance.findUnique({
    where: { id },
    include: { classSection: { select: { tenantId: true } } },
  });
  if (!record || record.classSection.tenantId !== tenantId) return null;
  return record;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const record = await getOwnedRecord(id, session.tenantId);
  if (!record) return NextResponse.json({ error: "Record tidak ditemukan" }, { status: 404 });

  // Admins read any record in the tenant; a teacher only their own class's.
  // Guardians and every other role are refused — this is a staff endpoint.
  if (!isAdminRole(session.role)) {
    if (session.role !== "TEACHER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const access = await requireTeacherForClass(record.classSectionId);
    if (access.error) return access.error;
  }

  return NextResponse.json(record);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success } = rateLimit(`update-attendance:${session.id}`, 30, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;
  const existing = await getOwnedRecord(id, session.tenantId);
  if (!existing) return NextResponse.json({ error: "Record tidak ditemukan" }, { status: 404 });
  if (existing.isVoided) return NextResponse.json({ error: "Record sudah dibatalkan" }, { status: 400 });

  const result = await validateBody(updateStudentAttendanceSchema, await req.json());
  if (result.error) return result.error;

  const updated = await prisma.studentAttendance.update({
    where: { id },
    data: {
      status: result.data.status,
      notes: result.data.notes ?? null,
    },
  });

  return NextResponse.json(updated);
}

// Soft delete — sets isVoided = true
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success } = rateLimit(`void-attendance:${session.id}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;
  const existing = await getOwnedRecord(id, session.tenantId);
  if (!existing) return NextResponse.json({ error: "Record tidak ditemukan" }, { status: 404 });
  if (existing.isVoided) return NextResponse.json({ error: "Record sudah dibatalkan" }, { status: 400 });

  await prisma.studentAttendance.update({
    where: { id },
    data: { isVoided: true },
  });

  return NextResponse.json({ success: true });
}
