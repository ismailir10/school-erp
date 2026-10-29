import { fromMonthIndex, monthIndex, parseYearMonth, type YearMonth } from "./months";

/**
 * The months of an academic year that billing can see: the year's first month
 * through its last month, but never more than eleven months after the first.
 * A year that runs 13 Juli to 11 Juli touches 13 calendar months, only twelve
 * of which are its own, so the window is capped at start + 11.
 *
 * Same rule as `loadSppPrepayContext` (lib/finance/spp-prepay-load.ts); kept
 * standalone here so the leave domain does not pull in the finance loader.
 * Dates are `YYYY-MM-DD` strings. Returns `null` for an unparsable date or an
 * end before the start.
 */
export function academicYearBillingWindow(year: {
  startDate: string;
  endDate: string;
}): { from: YearMonth; to: YearMonth } | null {
  const from = parseYearMonth(year.startDate.slice(0, 7));
  const end = parseYearMonth(year.endDate.slice(0, 7));
  if (!from || !end || monthIndex(from) > monthIndex(end)) return null;
  const lastIdx = Math.min(monthIndex(end), monthIndex(from) + 11);
  return { from, to: fromMonthIndex(lastIdx) };
}

/** True when both months lie inside the window (inclusive). */
export function rangeInsideWindow(
  range: { start: YearMonth; end: YearMonth },
  window: { from: YearMonth; to: YearMonth },
): boolean {
  return (
    monthIndex(range.start) >= monthIndex(window.from) &&
    monthIndex(range.end) <= monthIndex(window.to)
  );
}
