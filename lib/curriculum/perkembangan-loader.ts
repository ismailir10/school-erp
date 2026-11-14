import { prisma } from "@/lib/db";
import { getCurrentWeek, getStudentAgeGroups } from "@/lib/curriculum/week-resolver";
import {
  formatJakartaYmd,
  parseJakartaYmd,
} from "@/lib/validations/curriculum";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

const JAKARTA_TZ = "Asia/Jakarta";

export type PerkembanganLevel = "CONSISTENT" | "EMERGING" | "NEEDS_REINFORCEMENT";

export type ElementCounts = {
  CONSISTENT: number;
  EMERGING: number;
  NEEDS_REINFORCEMENT: number;
  total: number;
};

export type ElementRollup = {
  element: string;
  counts: ElementCounts;
};

export type LatestEntry = {
  indicatorContent: string;
  element: string;
  level: PerkembanganLevel;
  date: string; // Jakarta-tz YYYY-MM-DD
  source: "HOMEROOM" | "CENTER";
  center: string | null;
  /** Campus sentra name, when the entry was recorded against the Sentra table. */
  sentraName?: string | null;
  /** Free-text "Kegiatan" the walas typed at the sentra, when recorded. */
  activity: string | null;
};

export type PerkembanganPayload = {
  semester:
    | { id: string; number: number; academicYear: { id: string; name: string } }
    | null;
  elements: ElementRollup[];
  latestThisWeek: LatestEntry[];
  hasActiveWeek: boolean;
};

type PerkembanganPreview = Pick<PerkembanganPayload, "latestThisWeek" | "hasActiveWeek">;

const ELEMENT_ORDER = [
  "RELIGIOUS_MORAL",
  "IDENTITY",
  "STEAM",
  "MOTOR_SKILLS",
  "ART",
] as const;

function emptyCounts(): ElementCounts {
  return { CONSISTENT: 0, EMERGING: 0, NEEDS_REINFORCEMENT: 0, total: 0 };
}

/**
 * Group raw `(element, level)` rows into the design's 5-element rollup.
 * Pure helper — exported for unit testing.
 */
export function aggregateByElement(
  rows: ReadonlyArray<{ element: string; level: PerkembanganLevel }>,
): ElementRollup[] {
  const byElement = new Map<string, ElementCounts>();
  for (const e of ELEMENT_ORDER) byElement.set(e, emptyCounts());
  for (const row of rows) {
    const counts = byElement.get(row.element);
    if (!counts) continue; // future enum values silently dropped — element list is design-locked
    counts[row.level] = (counts[row.level] ?? 0) + 1;
    counts.total += 1;
  }
  return ELEMENT_ORDER.map((element) => ({
    element,
    counts: byElement.get(element) ?? emptyCounts(),
  }));
}

/**
 * Single source of truth for the parent perkembangan rollup.
 *
 * Strategy: instead of joining on date windows, we filter via the
 * indicator's parent objective belonging to the active Semester. The
 * curriculum spine guarantees one Semester per academic year period,
 * and walas + sentra writes are constrained to indicators inside that
 * semester via the IndicatorThemeLink → Theme → Semester chain.
 *
 * Term substitution: design §2.4 says "for the term", but the Term
 * model is C8 work — we aggregate over the full active Semester here
 * and switch to Term in C8 with no UI change (same payload shape).
 *
 * `latestThisWeek` is a small (≤3) preview list driven by
 * `getCurrentWeek(today)`; when no active week, returns []. The home
 * greeting card consumes this; the detail page also surfaces it as a
 * "Pekan ini" block.
 */
export async function loadStudentPerkembangan(
  tenantId: string,
  studentId: string,
): Promise<PerkembanganPayload> {
  const semester = await loadActiveSemester(tenantId);
  if (!semester) {
    return {
      semester: null,
      elements: aggregateByElement([]),
      latestThisWeek: [],
      hasActiveWeek: false,
    };
  }

  // The detail page needs semester totals; Home uses only the bounded preview.
  // These reads are independent once the active-semester gate has passed.
  const [entries, preview] = await Promise.all([
    prisma.assessmentEntry.findMany({
      where: {
        tenantId,
        studentId,
        indicator: { objective: { semesterId: semester.id } },
      },
      select: {
        level: true,
        indicator: { select: { objective: { select: { element: true } } } },
      },
    }),
    loadLatestThisWeek(tenantId, studentId),
  ]);

  return {
    semester,
    elements: aggregateByElement(entries.map((entry) => ({
      element: entry.indicator.objective.element,
      level: entry.level as PerkembanganLevel,
    }))),
    ...preview,
  };
}

function loadActiveSemester(tenantId: string) {
  return prisma.semester.findFirst({
    where: { tenantId, status: "ACTIVE" },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      number: true,
      academicYear: { select: { id: true, name: true } },
    },
  });
}

/** Home's three-entry preview, without loading or aggregating semester history. */
export async function loadStudentPerkembanganPreview(
  tenantId: string,
  studentId: string,
): Promise<PerkembanganPreview> {
  // Preserve the detail loader's gate: no active semester means no preview.
  if (!await loadActiveSemester(tenantId)) {
    return { latestThisWeek: [], hasActiveWeek: false };
  }
  return loadLatestThisWeek(tenantId, studentId);
}

async function loadLatestThisWeek(
  tenantId: string,
  studentId: string,
): Promise<PerkembanganPreview> {
  const todayUtc = parseJakartaYmd(getTodayInTimezone(JAKARTA_TZ));
  // The preview follows the child's own kelompok; no active class, no week.
  const studentGroup = (await getStudentAgeGroups(tenantId, [studentId])).get(
    studentId,
  );
  const week = studentGroup
    ? await getCurrentWeek(tenantId, todayUtc, studentGroup)
    : null;
  let latestThisWeek: LatestEntry[] = [];
  if (week) {
    const recent = await prisma.assessmentEntry.findMany({
      where: {
        tenantId,
        studentId,
        weekId: week.id,
      },
      orderBy: { recordedAt: "desc" },
      take: 3,
      select: {
        level: true,
        date: true,
        source: true,
        center: true,
        sentra: { select: { name: true } },
        activity: true,
        indicator: {
          select: {
            content: true,
            objective: { select: { element: true } },
          },
        },
      },
    });
    latestThisWeek = recent.map((e) => ({
      indicatorContent: e.indicator.content,
      element: e.indicator.objective.element,
      level: e.level as PerkembanganLevel,
      date: formatJakartaYmd(e.date),
      source: e.source as "HOMEROOM" | "CENTER",
      center: e.center,
      sentraName: e.sentra?.name ?? null,
      // Trim to null so a whitespace-only entry does not render an empty
      // "Kegiatan:" label on the parent card.
      activity: e.activity?.trim() ? e.activity.trim() : null,
    }));
  }

  return {
    latestThisWeek,
    hasActiveWeek: !!week,
  };
}
