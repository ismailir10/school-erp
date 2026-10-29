import { formatYearMonth, fromMonthIndex, monthIndex, parseYearMonth } from "@/lib/enrollment-leave/months";
import { formatMonthLabel } from "@/lib/format";

export type MonthOption = { value: string; label: string };

/** Every `YYYY-MM` from `from` to `to` inclusive, labelled "Desember 2026". Empty for a malformed or inverted range. */
export function monthRangeOptions(from: string, to: string): MonthOption[] {
  const start = parseYearMonth(from);
  const end = parseYearMonth(to);
  if (!start || !end) return [];
  const out: MonthOption[] = [];
  // A billing window is at most a year; the cap only guards a malformed response.
  for (let i = monthIndex(start); i <= monthIndex(end) && out.length < 36; i++) {
    const ym = fromMonthIndex(i);
    out.push({ value: formatYearMonth(ym), label: formatMonthLabel(ym.year, ym.month) });
  }
  return out;
}

/** `month` pulled into `[window.from, window.to]`. `YYYY-MM` text compares correctly as plain text. */
export function clampMonth(month: string, window: { from: string; to: string }): string {
  if (month < window.from) return window.from;
  if (month > window.to) return window.to;
  return month;
}

/** "A", "A dan B", "A, B dan C". */
export function joinWithDan(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} dan ${items[items.length - 1]}`;
}
