import { prisma } from "@/lib/db";
import { parseWorkingDays, weekdayCodeFromUtcMidnight } from "@/lib/sessions/dates";

/** Read-only counterpart to reconcileSessions for one day. Existing sessions
 * remain authoritative; otherwise use the same semester/holiday/workday rules.
 * Callers supply only their already-authorized class IDs; tenancy is enforced
 * again here. No session is created by rendering a page or loading Gate. */
export async function scheduledClassIds(tenantId: string, classIds: string[], date: string): Promise<Set<string>> {
  if (!tenantId || classIds.length === 0) return new Set();
  const day = new Date(`${date}T00:00:00Z`);
  const sections = await prisma.classSection.findMany({
    where: { id: { in: [...new Set(classIds)] }, tenantId, status: "ACTIVE", academicYear: { status: "ACTIVE" } },
    select: {
      id: true,
      sessions: { where: { date }, select: { id: true } },
      academicYear: { select: { semesters: { where: { startDate: { lte: day }, endDate: { gte: day } }, select: { id: true } } } },
    },
  });
  const scheduled = new Set(sections.filter(section => section.sessions.length > 0).map(section => section.id));
  const eligible = sections.filter(section => !scheduled.has(section.id) && section.academicYear.semesters.length > 0);
  if (eligible.length === 0) return scheduled;
  const [config, holidays] = await Promise.all([
    prisma.orgConfig.findUnique({ where: { tenantId }, select: { workingDays: true } }),
    prisma.holiday.findMany({ where: { tenantId, date }, select: { isHalfDay: true } }),
  ]);
  if (!config) throw new Error("org_config_not_found");
  const isSchoolDay = holidays.length > 0
    ? holidays.some(holiday => holiday.isHalfDay)
    : parseWorkingDays(config.workingDays).set.has(weekdayCodeFromUtcMidnight(day));
  if (isSchoolDay) for (const section of eligible) scheduled.add(section.id);
  return scheduled;
}
