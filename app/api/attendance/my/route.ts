import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMonthYearInTimezone } from "@/lib/attendance/timezone";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.employeeId || !session?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Permission gate (replaces legacy `session.role !== "TEACHER"` string check):
  // any caller with a linked Employee row AND `attendance.view` may read their
  // OWN attendance. Reading-self is implied by employeeId presence + the
  // attendance read permission. F-09 expansion — see cycle doc.
  if (!hasPermission(session, "attendance.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  // The school's current month, not the server's: Vercel runs in UTC, which is
  // still last month for the first seven hours of the 1st in WIB.
  const current = getMonthYearInTimezone(new Date(), "Asia/Jakarta");
  const month = parseInt(searchParams.get("month") ?? String(current.month));
  const year = parseInt(searchParams.get("year") ?? String(current.year));

  // Build date range for the month
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const records = await prisma.attendanceRecord.findMany({
    where: {
      employeeId: session.employeeId,
      // Tenant isolation: Ensure records belong to the caller's tenant via employee
      employee: {
        tenantId: session.tenantId,
      },
      date: { gte: startDate, lt: endDate },
    },
    orderBy: { date: "asc" },
  });

  return NextResponse.json(records);
}
