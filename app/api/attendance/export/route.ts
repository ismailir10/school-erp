import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMonthYearInTimezone } from "@/lib/attendance/timezone";
import { requirePermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { CSV_BOM, escapeCsvCell } from "@/lib/students/export";

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
  // F-11: validate month (1-12) and year (2000-2100). Previously `parseInt`
  // on `"foo"` returned `NaN` which silently produced an empty CSV — the
  // employee JOIN still emitted header + zero-count rows. Bad input must
  // surface as a 400 instead of a misleading-but-200 export.
  // Defaults to the school's current month (Jakarta), not the server's: Vercel
  // runs in UTC, which is still last month for the first seven hours of the 1st.
  const current = getMonthYearInTimezone(new Date(), "Asia/Jakarta");
  const monthRaw = searchParams.get("month") ?? String(current.month);
  const yearRaw = searchParams.get("year") ?? String(current.year);
  const month = parseInt(monthRaw, 10);
  const year = parseInt(yearRaw, 10);
  // String round-trip rejects decimals ("1.5" → 1) and trailing junk ("1abc" → 1)
  // that parseInt would silently accept. Number.isInteger alone is not enough.
  if (
    String(month) !== monthRaw.trim() ||
    String(year) !== yearRaw.trim() ||
    month < 1 ||
    month > 12 ||
    year < 2000 ||
    year > 2100
  ) {
    return NextResponse.json(
      { error: "Bulan dan tahun tidak valid" },
      { status: 400 },
    );
  }

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const employees = await prisma.employee.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    include: {
      campus: { select: { name: true } },
      attendanceRecords: {
        where: { date: { gte: startDate, lt: endDate } },
        orderBy: { date: "asc" },
      },
    },
    orderBy: { nama: "asc" },
  });

  // Build CSV
  const monthLabel = new Date(year, month - 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  // Every cell goes through escapeCsvCell (always-quoted, quotes doubled,
  // formula-leading cells neutralised) — names/jabatan are admin-typed free text.
  const header = ["Kode", "Nama", "Kampus", "Jabatan", "Hadir", "Terlambat", "Alpa", "Izin", "Total Hari"]
    .map(escapeCsvCell)
    .join(",");

  const rows = employees.map((emp) => {
    let present = 0, late = 0, absent = 0, leave = 0;
    for (const r of emp.attendanceRecords) {
      if (r.status === "PRESENT" || r.status === "PRESENT_NO_CHECKOUT") present++;
      else if (r.status === "LATE") late++;
      else if (r.status === "ABSENT") absent++;
      else if (r.status === "LEAVE") leave++;
    }
    return [emp.kode, emp.nama, emp.campus.name, emp.jabatan, present, late, absent, leave, present + late + leave]
      .map((v) => escapeCsvCell(String(v ?? "")))
      .join(",");
  });

  const csv = [header, ...rows].join("\r\n") + "\r\n";
  const filename = `kehadiran_${monthLabel.replace(/\s/g, "_")}.csv`;

  return new NextResponse(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
