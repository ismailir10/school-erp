import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";

/**
 * GET /api/admin/class-sessions?classSectionId=<id>&month=<YYYY-MM>
 *
 * Lists the ClassSession rows for one class section, scoped to a calendar
 * month, for the admin session-calendar (academic-hierarchy-refactor Task 6).
 * Tenancy is indirect — ClassSession has no tenantId column — so the section
 * must resolve through `classSection: { tenantId }`.
 *
 * Auth matches the sibling /api/class-sections routes: getSession + isAdminRole.
 * Class sessions are academic structure, same family; the route is read-only
 * here so no rate-limit (writes live in [id]/route.ts).
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission("academic.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const classSectionId = searchParams.get("classSectionId");
  if (!classSectionId) {
    return NextResponse.json(
      { error: "classSectionId wajib diisi" },
      { status: 400 },
    );
  }

  // Date-range filter. `month=YYYY-MM` is the calendar's primary mode; an
  // explicit `from`/`to` pair (inclusive YYYY-MM-DD) is also accepted.
  const month = searchParams.get("month");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  let dateFilter: { gte: string; lte: string } | undefined;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    // ClassSession.date is a YYYY-MM-DD string — lexicographic compare is
    // calendar-correct for fixed-width ISO dates, so a string range works.
    // Compute the actual last day of the month: `new Date(y, m, 0)` is day 0
    // of the *next* month, i.e. the last day of `month` (handles 28/29/30/31).
    const [y, m] = month.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    dateFilter = {
      gte: `${month}-01`,
      lte: `${month}-${String(lastDay).padStart(2, "0")}`,
    };
  } else if (from && to) {
    dateFilter = { gte: from, lte: to };
  }

  const sessions = await prisma.classSession.findMany({
    where: {
      classSectionId,
      classSection: { tenantId: session.tenantId },
      ...(dateFilter ? { date: dateFilter } : {}),
    },
    select: {
      id: true,
      classSectionId: true,
      semesterId: true,
      date: true,
      slot: true,
      teacherId: true,
      defaultTeacherId: true,
      substituteReason: true,
      isBackfilled: true,
      teacher: { select: { id: true, nama: true } },
      defaultTeacher: { select: { id: true, nama: true } },
    },
    orderBy: [{ date: "asc" }, { slot: "asc" }],
  });

  return NextResponse.json(sessions);
}
