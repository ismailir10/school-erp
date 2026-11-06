/**
 * Sentra rotation (putaran) day math. Pure, no DB.
 *
 * Dates are "YYYY-MM-DD" Jakarta calendar days, handled as UTC midnight so the
 * runtime timezone can never shift them. Holidays are ignored (Decision 4).
 */

const DAY_MS = 86_400_000;
const WEEKDAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"] as const;

function epochDay(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromEpochDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. 1970-01-05 (epoch day 4) was a Monday. */
function mondayBasedDow(day: number): number {
  return (((day - 4) % 7) + 7) % 7;
}

/** Running count of school weekdays; Mon..Fri of week w = 5w .. 5w+4. */
function weekdayOrdinal(day: number): number {
  const since = day - 4;
  const week = Math.floor(since / 7);
  return week * 5 + Math.min(mondayBasedDow(day), 5);
}

export function isSchoolWeekday(ymd: string): boolean {
  return mondayBasedDow(epochDay(ymd)) < 5;
}

export function normalizeRotationStart(ymd: string): string {
  const day = epochDay(ymd);
  const dow = mondayBasedDow(day);
  return dow < 5 ? ymd : fromEpochDay(day + (7 - dow));
}

export function rotationDayIndex(
  startYmd: string,
  dateYmd: string,
  cycleDays: number,
): number | null {
  if (!Number.isInteger(cycleDays) || cycleDays < 1) return null;
  if (!isSchoolWeekday(dateYmd)) return null;
  const start = epochDay(normalizeRotationStart(startYmd));
  const date = epochDay(dateYmd);
  if (date < start) return null;
  const elapsed = weekdayOrdinal(date) - weekdayOrdinal(start);
  return elapsed % cycleDays;
}

export function rotationDayLabel(startYmd: string, dayIndex: number): string {
  const startOffset = mondayBasedDow(epochDay(normalizeRotationStart(startYmd)));
  const pos = startOffset + dayIndex;
  return `Pekan ${Math.floor(pos / 5) + 1} · ${WEEKDAY_NAMES[pos % 5]}`;
}

export function sentraLabel(name: string): string {
  return /^sentra /i.test(name) ? name : `Sentra ${name}`;
}
