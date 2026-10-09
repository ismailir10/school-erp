import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMonthYearInTimezone } from "@/lib/attendance/timezone";
import { requirePermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";

// F-12: removed `export const revalidate = 3600`. Route reads per-tenant
// session data; ISR caching by URL would mix tenants. Next.js currently
// auto-detects the dynamic context and skips ISR, but the declaration is a
// latent footgun if a future refactor makes the route appear cacheable.

export async function GET(req: NextRequest) {
  const auth = await requirePermission("attendance.view");
  if ("error" in auth) return auth.error;
  // Staff attendance (incl. GPS) is HR data. TEACHER holds attendance.view for
  // their OWN record only (served by /api/attendance/my), so require hr.view
  // here exactly like /api/attendance/trend.
  if (!hasPermission(auth.session, "hr.view")) {
    return NextResponse.json({ error: "forbidden", missing: "hr.view" }, { status: 403 });
  }
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  // The school's current month, not the server's: Vercel runs in UTC, which is
  // still last month for the first seven hours of the 1st in WIB.
  const current = getMonthYearInTimezone(new Date(), "Asia/Jakarta");
  const month = parseInt(searchParams.get("month") ?? String(current.month));
  const year = parseInt(searchParams.get("year") ?? String(current.year));
  const campusId = searchParams.get("campusId");

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const empWhere: Record<string, unknown> = { tenantId: session.tenantId, status: "ACTIVE" };
  if (campusId && campusId !== "all") empWhere.campusId = campusId;

  const employees = await prisma.employee.findMany({
    where: empWhere,
    select: {
      id: true,
      kode: true,
      nama: true,
      campus: { select: { name: true } },
    },
    orderBy: { nama: "asc" },
  });

  const records = await prisma.attendanceRecord.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      date: { gte: startDate, lt: endDate },
    },
    select: { id: true, employeeId: true, date: true, status: true, checkInTime: true, checkOutTime: true, isLocked: true },
  });

  // Group records by employee
  const recordsByEmployee = new Map<string, typeof records>();
  for (const r of records) {
    const existing = recordsByEmployee.get(r.employeeId) ?? [];
    existing.push(r);
    recordsByEmployee.set(r.employeeId, existing);
  }

  const result = employees.map((emp) => {
    const empRecords = recordsByEmployee.get(emp.id) ?? [];
    const summary = { present: 0, late: 0, absent: 0, leave: 0 };
    for (const r of empRecords) {
      if (r.status === "PRESENT" || r.status === "PRESENT_NO_CHECKOUT") summary.present++;
      else if (r.status === "LATE") summary.late++;
      else if (r.status === "ABSENT") summary.absent++;
      else if (r.status === "LEAVE") summary.leave++;
    }

    return {
      employee: { id: emp.id, kode: emp.kode, nama: emp.nama, campusName: emp.campus.name },
      records: empRecords.map((r) => ({
        id: r.id,
        date: r.date,
        status: r.status,
        checkInTime: r.checkInTime?.toISOString() ?? null,
        checkOutTime: r.checkOutTime?.toISOString() ?? null,
        isLocked: r.isLocked,
      })),
      summary,
    };
  });

  return NextResponse.json(result);
}
