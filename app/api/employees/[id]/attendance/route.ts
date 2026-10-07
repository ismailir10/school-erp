import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";

// Admin: get attendance history for a specific employee
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("attendance.view");
  if ("error" in auth) return auth.error;
  // Staff attendance (incl. GPS) is HR data. TEACHER holds attendance.view for
  // their OWN record only (served by /api/attendance/my), so require hr.view
  // here exactly like /api/attendance/trend.
  if (!hasPermission(auth.session, "hr.view")) {
    return NextResponse.json({ error: "forbidden", missing: "hr.view" }, { status: 403 });
  }
  const { session } = auth;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const month = parseInt(searchParams.get("month") ?? String(new Date().getMonth() + 1));
  const year = parseInt(searchParams.get("year") ?? String(new Date().getFullYear()));

  // Verify employee belongs to tenant
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee || employee.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const records = await prisma.attendanceRecord.findMany({
    where: {
      employeeId: id,
      date: { gte: startDate, lt: endDate },
    },
    orderBy: { date: "asc" },
  });

  // Monthly summary
  const summary = { present: 0, late: 0, absent: 0, leave: 0 };
  for (const r of records) {
    if (r.status === "PRESENT" || r.status === "PRESENT_NO_CHECKOUT") summary.present++;
    else if (r.status === "LATE") summary.late++;
    else if (r.status === "ABSENT") summary.absent++;
    else if (r.status === "LEAVE") summary.leave++;
  }

  return NextResponse.json({ records, summary, employeeName: employee.nama });
}
