/**
 * Whole-month arithmetic for student enrollment leave (cuti), see
 * docs/cycles/2026-10-29-student-enrollment-leave.md. A leave is an inclusive
 * range of calendar months stored as `YYYY-MM` text. Pure and Prisma-free: the
 * student page (client) imports it too.
 */

export type YearMonth = { year: number; month: number };

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

/** "2026-12" -> { year: 2026, month: 12 }; anything else (incl. "2026-13") -> null. */
export function parseYearMonth(value: string): YearMonth | null {
  const m = YEAR_MONTH.exec(value);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** { year: 2026, month: 12 } -> "2026-12". */
export function formatYearMonth(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

/** Months since year 0, so two YearMonths compare as plain numbers. */
export function monthIndex(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

/** Inverse of `monthIndex`. */
export function fromMonthIndex(index: number): YearMonth {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Negative when a is before b, 0 when equal, positive when after. */
export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return monthIndex(a) - monthIndex(b);
}

export type MonthRange = { start: YearMonth; end: YearMonth };

/** True when two inclusive month ranges share at least one month. */
export function monthsOverlap(a: MonthRange, b: MonthRange): boolean {
  return monthIndex(a.start) <= monthIndex(b.end) && monthIndex(b.start) <= monthIndex(a.end);
}

/** True when `month` lies inside the inclusive range `[start, end]`. */
export function leaveCoversMonth(leave: MonthRange, month: YearMonth): boolean {
  return monthIndex(leave.start) <= monthIndex(month) && monthIndex(month) <= monthIndex(leave.end);
}

/** "Des 2026". */
export function formatShortMonth(ym: YearMonth): string {
  return `${SHORT_MONTHS[ym.month - 1]} ${ym.year}`;
}

/**
 * "Des 2026 – Jan 2027", or just "Des 2026" for a one-month leave. Accepts the
 * stored `YYYY-MM` text; a malformed value is returned as typed rather than
 * throwing, so a bad row never blanks the whole list.
 */
export function formatLeaveRange(startMonth: string, endMonth: string): string {
  const start = parseYearMonth(startMonth);
  const end = parseYearMonth(endMonth);
  if (!start || !end) return startMonth === endMonth ? startMonth : `${startMonth} – ${endMonth}`;
  if (monthIndex(start) === monthIndex(end)) return formatShortMonth(start);
  return `${formatShortMonth(start)} – ${formatShortMonth(end)}`;
}
