import { prisma } from "@/lib/db";
import type { AgeGroup } from "@/lib/generated/prisma/client";
import { themesVisibleTo } from "@/lib/curriculum/age-scope";

/**
 * Resolve the curriculum Week containing a given Jakarta-tz date.
 *
 * Storage contract: `Week.startDate` and `Week.endDate` are persisted as
 * UTC-midnight DateTimes representing Jakarta calendar days
 * (see `parseJakartaYmd` in `lib/validations/curriculum.ts`). We compare
 * against `targetUtcMidnight` — the same UTC-midnight projection of the
 * requested date — so the bracket math stays timezone-coherent.
 *
 * Returns the Week + parent SubTheme + Theme + Semester when one is found
 * with `status = ACTIVE`; null otherwise. Caller decides whether the
 * absence of an active week is a 404 (homeroom weekly UI) or a 422
 * (sentra entry on a date outside any active week).
 *
 * Kelompok scope: only weeks under a theme visible to `ageGroup` (its own
 * group or shared, `Theme.ageGroup` null) are considered, so a TK A class and
 * a TK B class can resolve different weeks for the same date.
 *
 * Overlap policy: if multiple ACTIVE weeks straddle the same date (data
 * error), `findFirst` returns whichever Postgres yields first ordered by
 * `startDate asc`. C4 does not detect or repair overlaps; the admin
 * curriculum CRUD enforces non-overlap on write.
 */
export async function getCurrentWeek(
  tenantId: string,
  targetUtcMidnight: Date,
  ageGroup: AgeGroup,
): Promise<{
  id: string;
  number: number;
  startDate: Date;
  endDate: Date;
  subTheme: {
    id: string;
    name: string;
    theme: {
      id: string;
      name: string;
      semesterId: string;
      ageGroup: AgeGroup | null;
    };
  };
} | null> {
  return prisma.week.findFirst({
    where: {
      tenantId,
      status: "ACTIVE",
      startDate: { lte: targetUtcMidnight },
      endDate: { gte: targetUtcMidnight },
      subTheme: { theme: themesVisibleTo(ageGroup) },
    },
    select: {
      id: true,
      number: true,
      startDate: true,
      endDate: true,
      subTheme: {
        select: {
          id: true,
          name: true,
          theme: {
            select: {
              id: true,
              name: true,
              semesterId: true,
              ageGroup: true,
            },
          },
        },
      },
    },
    orderBy: { startDate: "asc" },
  });
}

/**
 * Current kelompok (TK A / TK B) per student, from their ACTIVE enrollment in
 * an ACTIVE class section. Students without one are absent from the map; the
 * caller decides how to reject. If a student is in several active sections
 * (e.g. a daycare placement beside TK), the first found wins.
 */
export async function getStudentAgeGroups(
  tenantId: string,
  studentIds: string[],
): Promise<Map<string, AgeGroup>> {
  const map = new Map<string, AgeGroup>();
  if (studentIds.length === 0) return map;
  const rows = await prisma.studentEnrollment.findMany({
    where: {
      studentId: { in: studentIds },
      status: "ACTIVE",
      classSection: { tenantId, status: "ACTIVE" },
    },
    select: { studentId: true, classSection: { select: { ageGroup: true } } },
  });
  for (const r of rows) {
    if (!map.has(r.studentId)) map.set(r.studentId, r.classSection.ageGroup);
  }
  return map;
}
