import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "students.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  // Verify student belongs to tenant
  const student = await prisma.student.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!student) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // YYYY-MM

  const records = await prisma.studentAttendance.findMany({
    where: {
      studentId: id,
      ...(month ? { date: { startsWith: month } } : {}),
    },
    include: {
      classSection: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  });

  // Summary counts
  const summary = {
    present: records.filter((r) => r.status === "PRESENT").length,
    absent: records.filter((r) => r.status === "ABSENT").length,
    sick: records.filter((r) => r.status === "SICK").length,
    permission: records.filter((r) => r.status === "PERMISSION").length,
    total: records.length,
  };

  return NextResponse.json({ records, summary });
}
