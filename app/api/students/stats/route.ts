import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";

/**
 * GET /api/students/stats
 *
 * Returns aggregate counts for the students stat cards in a single query.
 * Replaces the prior pattern of firing three `pageSize=1` list queries in
 * parallel from `app/admin/students/page.tsx`.
 *
 * Tenant-scoped via `tenantId`. Admin-only.
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "students.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.student.groupBy({
    by: ["status"],
    where: { tenantId: session.tenantId },
    _count: { status: true },
  });

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = r._count.status;

  const active = byStatus.ACTIVE ?? 0;
  const graduated = byStatus.GRADUATED ?? 0;
  // `total` is the unfiltered row count — equal to GET /api/students'
  // pagination.total when no status filter is applied. Previous shape
  // summed only ACTIVE + GRADUATED, which drifted from the list header
  // count by the number of INACTIVE + WITHDRAWN rows. E2E session confirmed
  // users noticed the drift (Finding F-2).
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  return NextResponse.json({ total, active, graduated });
}
