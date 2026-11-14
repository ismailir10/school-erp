import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

/** Summary cards need counts, not three paginated lists with child relations. */
export async function GET() {
  const session = await getSession();
  // Match GET /api/guardians, including its 403 for a missing session/tenant.
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "students.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.parent.groupBy({
    by: ["status"],
    where: { tenantId: session.tenantId },
    _count: { status: true },
  });
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row._count.status]));

  return NextResponse.json({
    // Include every status so total agrees with the unfiltered list.
    total: rows.reduce((sum, row) => sum + row._count.status, 0),
    active: byStatus.ACTIVE ?? 0,
    inactive: byStatus.INACTIVE ?? 0,
  });
}
