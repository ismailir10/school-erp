import { prisma } from "@/lib/db";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import {
  addDaysYmd,
  completionPct,
  eightWeekStarts,
  weekDates,
  weekIndexOf,
} from "./helpers";
import type { JournalAnalytics } from "./types";

/**
 * Buku penghubung over the last 8 Mon-start weeks (current week last).
 *
 * Completion mirrors Monitoring (`app/api/student-journal/admin/classes`):
 * checked SCHOOL entries / (active enrolled students x active SCHOOL
 * indicators x 5 school days), over ACTIVE classes of the ACTIVE academic year.
 * The schema keeps no history of enrolments or indicators, so every week uses
 * today's denominator and is capped at 100%.
 *
 * Notes: authorRole TEACHER -> teacherNotes, GUARDIAN -> guardianNotes (the
 * only roles that write notes, see `app/api/student-journal/notes/route.ts`);
 * ACTIVE notes only, any day of the week.
 */
export async function loadJournalAnalytics(
  tenantId: string,
  today: string,
): Promise<JournalAnalytics> {
  const starts = eightWeekStarts(today);
  const currentWeek = starts[7];
  const currentWeekEnd = weekDates(currentWeek)[4];
  const rangeStart = starts[0];
  const rangeEnd = addDaysYmd(currentWeek, 6);

  const [indicatorCount, sections, enrollments] = await Promise.all([
    prisma.studentJournalIndicator.count({
      where: {
        status: JournalStatus.ACTIVE,
        category: {
          scope: "SCHOOL",
          status: JournalStatus.ACTIVE,
          template: { tenantId },
        },
      },
    }),
    prisma.classSection.findMany({
      where: { tenantId, status: "ACTIVE", academicYear: { status: "ACTIVE" } },
      select: { id: true, name: true },
    }),
    prisma.studentEnrollment.groupBy({
      by: ["classSectionId"],
      where: {
        status: "ACTIVE",
        classSection: { tenantId, status: "ACTIVE", academicYear: { status: "ACTIVE" } },
      },
      _count: { _all: true },
    }),
  ]);

  const classIds = sections.map((s) => s.id);
  const studentCount = new Map(enrollments.map((e) => [e.classSectionId, e._count._all]));
  // Monitoring's denominator is a full Mon–Fri week. The current week only
  // counts the school days elapsed so far, so "this week" can reach 100% on a
  // Wednesday instead of topping out at 60%.
  const elapsedDays = weekDates(currentWeek).filter((d) => d <= today).length;
  const perDayByClass = new Map(
    sections.map((s) => [s.id, (studentCount.get(s.id) ?? 0) * indicatorCount]),
  );
  const perDay = [...perDayByClass.values()].reduce((a, b) => a + b, 0);

  const [entriesByDate, entriesByClass, notes] = await Promise.all([
    classIds.length
      ? prisma.studentJournalEntry.groupBy({
          by: ["date"],
          where: {
            tenantId,
            classSectionId: { in: classIds },
            scope: "SCHOOL",
            checked: true,
            date: { gte: rangeStart, lte: currentWeekEnd },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    classIds.length
      ? prisma.studentJournalEntry.groupBy({
          by: ["classSectionId"],
          where: {
            tenantId,
            classSectionId: { in: classIds },
            scope: "SCHOOL",
            checked: true,
            date: { gte: currentWeek, lte: currentWeekEnd },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.studentJournalNote.groupBy({
      by: ["date", "authorRole"],
      where: {
        tenantId,
        status: JournalStatus.ACTIVE,
        date: { gte: rangeStart, lte: rangeEnd },
      },
      _count: { _all: true },
    }),
  ]);

  const weeks = starts.map((weekStart) => ({
    weekStart,
    completionPct: null as number | null,
    checked: 0,
    possible: perDay * (weekStart === currentWeek ? elapsedDays : 5),
    teacherNotes: 0,
    guardianNotes: 0,
  }));

  for (const r of entriesByDate) {
    const i = weekIndexOf(r.date, starts, true);
    if (i >= 0) weeks[i].checked += r._count._all;
  }
  for (const r of notes) {
    const i = weekIndexOf(r.date, starts);
    if (i < 0) continue;
    if (r.authorRole === "TEACHER") weeks[i].teacherNotes += r._count._all;
    else if (r.authorRole === "GUARDIAN") weeks[i].guardianNotes += r._count._all;
  }
  for (const w of weeks) w.completionPct = completionPct(w.checked, w.possible);

  const checkedByClass = new Map(
    entriesByClass
      .filter((e): e is typeof e & { classSectionId: string } => e.classSectionId !== null)
      .map((e) => [e.classSectionId, e._count._all]),
  );
  const leastCompleteClasses = sections
    .filter((s) => (perDayByClass.get(s.id) ?? 0) * elapsedDays > 0)
    .map((s) => ({
      classSectionId: s.id,
      name: s.name,
      completionPct:
        completionPct(checkedByClass.get(s.id) ?? 0, (perDayByClass.get(s.id) ?? 0) * elapsedDays) ?? 0,
    }))
    .sort((a, b) => a.completionPct - b.completionPct || a.name.localeCompare(b.name))
    .slice(0, 3);

  return {
    weeks,
    thisWeekPct: weeks[7].completionPct,
    teacherNotes: weeks.reduce((n, w) => n + w.teacherNotes, 0),
    guardianNotes: weeks.reduce((n, w) => n + w.guardianNotes, 0),
    leastCompleteClasses,
  };
}
