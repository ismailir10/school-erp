import { prisma } from "@/lib/db";
import type { AgeGroup } from "@/lib/generated/prisma/client";
import { getCurrentWeek } from "@/lib/curriculum/week-resolver";
import {
  ALL_LEARNING_CENTERS,
  formatEntrySentra,
  formatLearningCenter,
} from "@/lib/format";

/**
 * Admin penilaian monitoring roll-up (read-only).
 *
 * Surfaces completion of the NEW IKTP penilaian flow (`AssessmentEntry`)
 * for a SCHOOL_ADMIN. Two halves, with deliberately different "completion"
 * semantics (see cycle doc 2026-06-01-penilaian-consolidation Assumption 3):
 *
 *  - **Walas weekly** (`source = HOMEROOM`): a real denominator exists —
 *    enrolled active students in each ClassSection. We report `assessed/enrolled`
 *    where `assessed` = distinct students with ≥1 active (non-voided) HOMEROOM
 *    entry in the resolved curriculum Week.
 *  - **Sentra daily** (`source = CENTER`): NO fixed denominator (rotation
 *    deferred; any age-eligible student may attend any sentra). We report raw
 *    entries-made counts per center for the selected day: total entries +
 *    distinct students assessed.
 *
 * Only `voidedAt IS NULL` rows count (C7a soft-void audit trail is excluded),
 * matching the raport / parent-perkembangan rollup contract.
 */

type Center = (typeof ALL_LEARNING_CENTERS)[number];

export type WalasClassCompletion = {
  classSectionId: string;
  className: string;
  programName: string;
  enrolled: number;
  assessed: number;
};

export type SentraCenterCompletion = {
  label: string;
  entries: number;
  studentsAssessed: number;
};

export type PenilaianMonitorWeek = {
  id: string;
  number: number;
  subThemeName: string;
  themeName: string;
};

export type PenilaianMonitor = {
  week: PenilaianMonitorWeek | null;
  walas: WalasClassCompletion[];
  sentra: SentraCenterCompletion[];
};

/**
 * Pure: attribute assessed students to their class via enrollment.
 * `assessedStudentIds` is the tenant-wide set of students with a HOMEROOM
 * entry this week; a student counts toward whichever active class they are
 * enrolled in.
 */
export function aggregateWalas(
  classSections: { id: string; name: string; program: { name: string }; campus?: { name: string } | null }[],
  enrollments: { studentId: string; classSectionId: string }[],
  assessedStudentIds: Set<string>,
): WalasClassCompletion[] {
  const byClass = new Map<string, { enrolled: number; assessed: number }>();
  for (const cs of classSections) byClass.set(cs.id, { enrolled: 0, assessed: 0 });
  for (const e of enrollments) {
    const b = byClass.get(e.classSectionId);
    if (!b) continue;
    b.enrolled += 1;
    if (assessedStudentIds.has(e.studentId)) b.assessed += 1;
  }
  return classSections.map((cs) => {
    const b = byClass.get(cs.id)!;
    return {
      classSectionId: cs.id,
      className: cs.campus ? `${cs.name} · ${cs.campus.name}` : cs.name,
      programName: cs.program.name,
      enrolled: b.enrolled,
      assessed: b.assessed,
    };
  });
}

/**
 * Pure: entries-made counts per sentra for one day, grouped by display label
 * (campus sentra name when the entry has one, else the legacy fixed-list
 * label). The 8 legacy labels are always listed first so the grid stays
 * stable; any other sentra (e.g. "Makro") follows in order of appearance.
 */
export function aggregateSentra(
  centerEntries: {
    center?: Center | null;
    sentra?: { name: string } | null;
    studentId: string;
  }[],
): SentraCenterCompletion[] {
  const byLabel = new Map<string, { entries: number; students: Set<string> }>();
  for (const c of ALL_LEARNING_CENTERS) {
    byLabel.set(formatLearningCenter(c), { entries: 0, students: new Set<string>() });
  }
  for (const e of centerEntries) {
    if (!e.sentra && !e.center) continue;
    const label = formatEntrySentra(e);
    let b = byLabel.get(label);
    if (!b) {
      b = { entries: 0, students: new Set<string>() };
      byLabel.set(label, b);
    }
    b.entries += 1;
    b.students.add(e.studentId);
  }
  return Array.from(byLabel, ([label, b]) => ({
    label,
    entries: b.entries,
    studentsAssessed: b.students.size,
  }));
}

export async function loadPenilaianMonitor(
  tenantId: string,
  academicYearId: string,
  weekTargetUtcMidnight: Date,
  sentraDateUtcMidnight: Date,
): Promise<PenilaianMonitor> {
  // TK A and TK B can run different themes in the same dates, so each class
  // is measured against the week of its own kelompok. `week` in the payload
  // (header label) is TK A's, falling back to TK B's.
  const weekA = await getCurrentWeek(tenantId, weekTargetUtcMidnight, "A");
  const weekB = await getCurrentWeek(tenantId, weekTargetUtcMidnight, "B");
  const weekByGroup: Record<AgeGroup, { id: string } | null> = { A: weekA, B: weekB };
  const week = weekA ?? weekB;

  const classSections = await prisma.classSection.findMany({
    where: { tenantId, academicYearId, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      ageGroup: true,
      campus: { select: { name: true } },
      program: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  const classIds = classSections.map((c) => c.id);

  const enrollments = classIds.length
    ? await prisma.studentEnrollment.findMany({
        where: {
          classSectionId: { in: classIds },
          status: "ACTIVE",
          student: { tenantId },
        },
        select: { studentId: true, classSectionId: true },
      })
    : [];

  const walasById = new Map<string, WalasClassCompletion>();
  for (const group of ["A", "B"] as const) {
    const groupClasses = classSections.filter((c) => c.ageGroup === group);
    if (groupClasses.length === 0) continue;
    let assessed = new Set<string>();
    const groupWeek = weekByGroup[group];
    if (groupWeek) {
      const homeroomEntries = await prisma.assessmentEntry.findMany({
        where: { tenantId, weekId: groupWeek.id, source: "HOMEROOM", voidedAt: null },
        select: { studentId: true },
        distinct: ["studentId"],
      });
      assessed = new Set(homeroomEntries.map((e) => e.studentId));
    }
    for (const row of aggregateWalas(groupClasses, enrollments, assessed)) {
      walasById.set(row.classSectionId, row);
    }
  }

  const centerEntries = (await prisma.assessmentEntry.findMany({
    where: { tenantId, source: "CENTER", date: sentraDateUtcMidnight, voidedAt: null },
    select: { center: true, sentra: { select: { name: true } }, studentId: true },
  })) as {
    center: Center | null;
    sentra: { name: string } | null;
    studentId: string;
  }[];

  return {
    week: week
      ? {
          id: week.id,
          number: week.number,
          subThemeName: week.subTheme.name,
          themeName: week.subTheme.theme.name,
        }
      : null,
    walas: classSections.map((c) => walasById.get(c.id)!),
    sentra: aggregateSentra(centerEntries),
  };
}
