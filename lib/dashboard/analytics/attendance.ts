import { prisma } from "@/lib/db";
import { addDaysYmd, buildAttendanceDays, rankLowestClasses, rateOf, sumPresent } from "./helpers";
import type { AttendanceAnalytics } from "./types";

/**
 * Student attendance over the 30 calendar days ending `today` (Asia/Jakarta,
 * inclusive), plus the 30 days before for the delta. `StudentAttendance` has no
 * tenantId, so every query scopes through `classSection.tenantId`. Voided rows
 * are excluded. Rate = present / all non-voided records.
 */
export async function loadAttendanceAnalytics(
  tenantId: string,
  today: string,
): Promise<AttendanceAnalytics> {
  const windowStart = addDaysYmd(today, -29);
  const prevStart = addDaysYmd(today, -59);
  const prevEnd = addDaysYmd(today, -30);
  const base = { classSection: { tenantId }, isVoided: false };

  const [daily, previous, perClass] = await Promise.all([
    prisma.studentAttendance.groupBy({
      by: ["date", "status"],
      where: { ...base, date: { gte: windowStart, lte: today } },
      _count: { _all: true },
    }),
    prisma.studentAttendance.groupBy({
      by: ["status"],
      where: { ...base, date: { gte: prevStart, lte: prevEnd } },
      _count: { _all: true },
    }),
    prisma.studentAttendance.groupBy({
      by: ["classSectionId", "status"],
      where: { ...base, date: { gte: windowStart, lte: today } },
      _count: { _all: true },
    }),
  ]);

  const days = buildAttendanceDays(
    daily.map((r) => ({ date: r.date, status: r.status, count: r._count._all })),
  );
  const current = sumPresent(
    daily.map((r) => ({ status: r.status, count: r._count._all })),
  );
  const prev = sumPresent(
    previous.map((r) => ({ status: r.status, count: r._count._all })),
  );

  const classIds = [...new Set(perClass.map((r) => r.classSectionId))];
  const sections = classIds.length
    ? await prisma.classSection.findMany({
        where: { id: { in: classIds }, tenantId, status: "ACTIVE" },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(sections.map((s) => [s.id, s.name]));

  return {
    windowStart,
    windowEnd: today,
    days,
    rate: rateOf(current.present, current.total),
    previousRate: rateOf(prev.present, prev.total),
    totalRecords: current.total,
    lowestClasses: rankLowestClasses(
      perClass.map((r) => ({
        classSectionId: r.classSectionId,
        status: r.status,
        count: r._count._all,
      })),
      names,
    ),
  };
}
