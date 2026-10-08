export type JournalProgressInput = {
  studentIds: string[];
  indicatorIds: string[];
  entries: { studentId: string; indicatorId: string; checked: boolean }[];
  /** Pupils not at school today (Sakit/Izin/Alpa). They leave both sides of the count. */
  excludedStudentIds?: Iterable<string>;
};

export type JournalProgress = {
  configured: boolean;
  /** Pupils expected to be filled in today: the roster minus `absentCount`. */
  totalStudents: number;
  completeStudents: number;
  completed: boolean;
  /** Roster pupils left out because they are absent today. */
  absentCount?: number;
};

/** Attendance statuses the journal skips. Same set the bulk sheet excludes
 * (`BULK_ABSENCE_LABELS` in class-bulk-sheet.tsx); a test keeps them in step. */
const JOURNAL_ABSENT_STATUSES: ReadonlySet<string> = new Set(["SICK", "PERMISSION", "ABSENT"]);
export function isJournalAbsentStatus(status: unknown): boolean {
  return typeof status === "string" && JOURNAL_ABSENT_STATUSES.has(status);
}

/** Count complete pupils, not interchangeable ticks. Ignore retired indicators,
 * duplicate rows, and pupils who no longer belong to the active roster. Pupils
 * marked absent today are in neither the numerator nor the denominator, so a
 * day with absences can still reach "lengkap". */
export function getJournalProgress({ studentIds, indicatorIds, entries, excludedStudentIds }: JournalProgressInput): JournalProgress {
  const excluded = new Set(excludedStudentIds ?? []);
  const rosterAll = new Set(studentIds);
  const roster = new Set([...rosterAll].filter(id => !excluded.has(id)));
  const absentCount = rosterAll.size - roster.size;
  const indicators = new Set(indicatorIds);
  const checked = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.checked || !roster.has(entry.studentId) || !indicators.has(entry.indicatorId)) continue;
    const row = checked.get(entry.studentId) ?? new Set<string>();
    row.add(entry.indicatorId);
    checked.set(entry.studentId, row);
  }
  const configured = indicators.size > 0;
  const completeStudents = configured
    ? [...roster].filter(id => checked.get(id)?.size === indicators.size).length : 0;
  // A class with nobody present has nothing left to fill; a class with no pupils at all still isn't "done".
  const hasWork = roster.size > 0 || absentCount > 0;
  return { configured, totalStudents: roster.size, completeStudents, absentCount,
    completed: configured && hasWork && completeStudents === roster.size };
}

export function resolveTeacherDate(raw: string | null | undefined, fallback: string) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  const parsed = new Date(`${raw}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : fallback;
}

export type TeacherClassSummary = {
  id: string;
  name: string;
  rosterCount: number;
  isHomeroom?: boolean;
  attendanceRecorded: number | null;
  journal: JournalProgress | null;
  replies: { studentId: string; studentName: string; count: number }[] | null;
  slot: string | null;
};
export type TeacherSessionSummary = { id: string; slot: string; className: string; rosterCount: number };

/** Slots have no clock times in the domain: prioritize the relevant half-day,
 * then full-day and upcoming work, without inventing a precise schedule. */
export function teacherSlotRank(slot: string | null, hour: number) {
  const order = hour < 12 ? ['MORNING', 'FULL_DAY', 'AFTERNOON'] : ['AFTERNOON', 'FULL_DAY', 'MORNING'];
  return slot ? order.indexOf(slot) < 0 ? 3 : order.indexOf(slot) : 3;
}

/** A timetable match wins. With equal relevance, use the teacher's homeroom
 * before an assistant assignment; alphabetical order remains the final tie. */
export function compareTeacherClasses(
  left: Pick<TeacherClassSummary, "slot" | "isHomeroom">,
  right: Pick<TeacherClassSummary, "slot" | "isHomeroom">,
  hour: number,
) {
  return teacherSlotRank(left.slot, hour) - teacherSlotRank(right.slot, hour)
    || Number(right.isHomeroom ?? false) - Number(left.isHomeroom ?? false);
}
