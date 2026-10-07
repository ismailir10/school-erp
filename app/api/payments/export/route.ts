import { NextRequest, NextResponse } from "next/server";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { CSV_BOM } from "@/lib/students/export";
import { resolveLedgerRequest, buildLedgerCsv } from "@/lib/finance/payments-ledger";

/**
 * GET /api/payments/export?dateFrom=&dateTo=&method=
 *
 * CSV download of the payments-received ledger. Same query as GET /api/payments;
 * same response contract as the other admin exports (text/csv, attachment,
 * Bahasa filename).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role) || !hasPermission(session, "invoices.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await resolveLedgerRequest(
    session.tenantId,
    new URL(req.url).searchParams,
    getTodayInTimezone("Asia/Jakarta"),
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const csv = buildLedgerCsv(result.rows);
  const filename = `penerimaan_${result.dateFrom}_${result.dateTo}.csv`;

  return new NextResponse(CSV_BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
