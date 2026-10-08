import { NextRequest, NextResponse } from "next/server";
import { getSession, isAdminRole } from "@/lib/auth";
import {
  resolveRecapRequest,
  buildRecapCsv,
} from "@/lib/attendance/student-recap";
import { CSV_BOM } from "@/lib/students/export";

/**
 * GET /api/student-attendance/export?month=&year=&classSectionId=
 *
 * CSV download of the monthly student attendance recap. Same aggregation as
 * /api/student-attendance/recap; same response contract as the employee
 * attendance export (text/csv, attachment, Bahasa filename).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await resolveRecapRequest(
    session.tenantId,
    new URL(req.url).searchParams,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const csv = buildRecapCsv(result.rows);
  const monthLabel = new Date(result.year, result.month - 1).toLocaleDateString(
    "id-ID",
    { month: "long", year: "numeric" },
  );
  const filename = `kehadiran_siswa_${monthLabel.replace(/\s/g, "_")}.csv`;

  return new NextResponse(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
