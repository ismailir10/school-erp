import { studentDays } from "@/lib/attendance/student-days";
import { prisma } from "@/lib/db";
import { formatJakartaYmd } from "@/lib/validations/curriculum";
import {
  aggregateByElement,
  type ElementCounts,
  type PerkembanganLevel,
} from "@/lib/curriculum/perkembangan-loader";

/**
 * Raport draft aggregator (C8 — Admin Raport MVP).
 *
 * Turns a student's penilaian (`AssessmentEntry`) + attendance over a Term
 * window into a *suggested* raport draft: a dominant `AchievementLevel` per
 * narrative section + auto-pulled attendance counts. Every value is a seed —
 * the admin overrides freely on `/admin/report-cards`. Nothing here persists.
 *
 * Section ↔ penilaian-element mapping (master design's 5 narrative sections are
 * NOT 1:1 with the 5 curriculum elements):
 *   INTRODUCTION         → no source (manual narrative; never suggested)
 *   RELIGIOUS_MORAL      → RELIGIOUS_MORAL
 *   IDENTITY             → IDENTITY
 *   STEAM                → STEAM
 *   PERFORMANCE_SHOWCASE → MOTOR_SKILLS + ART pooled (Unjuk Kerja)
 * The 3 closing sections (CLOSING / FOLLOW_UP_PLAN / HOME_ACTIVITIES) carry no
 * level and are not produced here.
 */

export type RaportLevel = PerkembanganLevel; // CONSISTENT | EMERGING | NEEDS_REINFORCEMENT

/** Level-bearing (bucketed) raport sections. */
export type BucketedSection =
  | "INTRODUCTION"
  | "RELIGIOUS_MORAL"
  | "IDENTITY"
  | "STEAM"
  | "PERFORMANCE_SHOWCASE";

export const BUCKETED_SECTIONS: readonly BucketedSection[] = [
  "INTRODUCTION",
  "RELIGIOUS_MORAL",
  "IDENTITY",
  "STEAM",
  "PERFORMANCE_SHOWCASE",
] as const;

/** Curriculum elements feeding each section (empty = no auto-suggestion). */
const SECTION_SOURCE_ELEMENTS: Record<BucketedSection, readonly string[]> = {
  INTRODUCTION: [],
  RELIGIOUS_MORAL: ["RELIGIOUS_MORAL"],
  IDENTITY: ["IDENTITY"],
  STEAM: ["STEAM"],
  PERFORMANCE_SHOWCASE: ["MOTOR_SKILLS", "ART"],
};

/**
 * Tie-break order for the dominant level: when two levels tie on count, the
 * one earlier in this list wins. Ordered lowest-achievement-first so a tie
 * resolves toward the more conservative level (don't over-state a child's
 * progress on a raport).
 */
const TIEBREAK_ORDER: readonly RaportLevel[] = [
  "NEEDS_REINFORCEMENT",
  "EMERGING",
  "CONSISTENT",
] as const;

export type SectionSuggestion = {
  /** Dominant level, or null when no penilaian backs this section. */
  suggested: RaportLevel | null;
  /** Raw rollup the UI shows as the "saran penilaian" hint. */
  counts: ElementCounts;
};

export type RaportAttendance = {
  permittedAbsenceDays: number;
  sickDays: number;
  unexcusedAbsenceDays: number;
  totalSchoolDays: number;
};

export type RaportDraft = {
  sections: Record<BucketedSection, SectionSuggestion>;
  attendance: RaportAttendance;
};

function emptyCounts(): ElementCounts {
  return { CONSISTENT: 0, EMERGING: 0, NEEDS_REINFORCEMENT: 0, total: 0 };
}

/** Pure: dominant level of a counts bag, lower-achievement tie-break. null if empty. */
export function dominantLevel(counts: ElementCounts): RaportLevel | null {
  if (counts.total === 0) return null;
  let best: RaportLevel = TIEBREAK_ORDER[0];
  let bestCount = -1;
  for (const lvl of TIEBREAK_ORDER) {
    if (counts[lvl] > bestCount) {
      best = lvl;
      bestCount = counts[lvl];
    }
  }
  return best;
}

/**
 * Pure: per-element `(element, level)` rows → suggested level + counts per
 * bucketed section. Reuses `aggregateByElement` for the per-element rollup,
 * then pools elements into sections (PERFORMANCE_SHOWCASE = MOTOR+ART).
 */
export function suggestSectionLevels(
  rows: ReadonlyArray<{ element: string; level: RaportLevel }>,
): Record<BucketedSection, SectionSuggestion> {
  const byElement = new Map<string, ElementCounts>();
  for (const r of aggregateByElement(rows)) byElement.set(r.element, r.counts);

  const out = {} as Record<BucketedSection, SectionSuggestion>;
  for (const section of BUCKETED_SECTIONS) {
    const pooled = emptyCounts();
    for (const element of SECTION_SOURCE_ELEMENTS[section]) {
      const c = byElement.get(element);
      if (!c) continue;
      pooled.CONSISTENT += c.CONSISTENT;
      pooled.EMERGING += c.EMERGING;
      pooled.NEEDS_REINFORCEMENT += c.NEEDS_REINFORCEMENT;
      pooled.total += c.total;
    }
    out[section] = { suggested: dominantLevel(pooled), counts: pooled };
  }
  return out;
}

/**
 * Pure: a student's attendance statuses over the window + the school-day
 * denominator → the 4 raport attendance counts. Status mapping mirrors
 * `StudentAttendance.status` (PRESENT | ABSENT | SICK | PERMISSION).
 */
export function summarizeAttendance(
  statuses: ReadonlyArray<string>,
  totalSchoolDays: number,
): RaportAttendance {
  let sickDays = 0;
  let permittedAbsenceDays = 0;
  let unexcusedAbsenceDays = 0;
  for (const s of statuses) {
    if (s === "SICK") sickDays += 1;
    else if (s === "PERMISSION") permittedAbsenceDays += 1;
    else if (s === "ABSENT") unexcusedAbsenceDays += 1;
  }
  return { permittedAbsenceDays, sickDays, unexcusedAbsenceDays, totalSchoolDays };
}

/**
 * Build the (unsaved) raport draft for one student over a Term window.
 *
 * - Penilaian: `AssessmentEntry` with `date ∈ [term.startDate, term.endDate]`
 *   and `voidedAt IS NULL`, joined indicator→objective→element. Matches the
 *   parent-perkembangan rollup contract (void-filtered).
 * - Attendance: the student's non-voided `StudentAttendance` rows in the
 *   window (string YMD compare). `totalSchoolDays` = distinct dates with any
 *   non-voided attendance row tenant-wide in the window (school operating-day
 *   proxy, so a student's missing rows don't shrink the denominator).
 *
 * Tenant-scoped on every query (defense in depth — caller already gates).
 */
export async function loadRaportDraft(
  tenantId: string,
  studentId: string,
  term: { startDate: Date; endDate: Date },
): Promise<RaportDraft> {
  const entries = await prisma.assessmentEntry.findMany({
    where: {
      tenantId,
      studentId,
      voidedAt: null,
      date: { gte: term.startDate, lte: term.endDate },
    },
    select: {
      level: true,
      indicator: { select: { objective: { select: { element: true } } } },
    },
  });
  const rows = entries.map((e) => ({
    element: e.indicator.objective.element,
    level: e.level as RaportLevel,
  }));

  const startYmd = formatJakartaYmd(term.startDate);
  const endYmd = formatJakartaYmd(term.endDate);

  const studentRows = await prisma.studentAttendance.findMany({
    where: {
      studentId,
      isVoided: false,
      date: { gte: startYmd, lte: endYmd },
      student: { tenantId },
    },
    select: { studentId: true, date: true, sessionId: true, status: true },
  });

  const schoolDayRows = await prisma.studentAttendance.findMany({
    where: {
      isVoided: false,
      date: { gte: startYmd, lte: endYmd },
      student: { tenantId },
    },
    select: { date: true },
    distinct: ["date"],
  });

  return {
    sections: suggestSectionLevels(rows),
    attendance: summarizeAttendance(
      studentDays(studentRows).map((a) => a.status),
      schoolDayRows.length,
    ),
  };
}
