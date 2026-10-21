import { weekStart, weekDates } from "@/lib/student-journal/week";
import type { AgingKey, AttendanceDay } from "./types";

export { weekStart, weekDates };

export const AGING_KEYS: readonly AgingKey[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

const DAY_MS = 86_400_000;

/** Shift a YYYY-MM-DD by whole calendar days (UTC arithmetic, no host-timezone drift). */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetweenYmd(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/** Integer percentage of `part` in `total`, or null when `total` is 0. */
export function rateOf(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 100);
}

export type StatusCount = { status: string; count: number };

const ATTENDANCE_STATUSES: ReadonlySet<string> = new Set(["PRESENT", "PERMISSION", "SICK", "ABSENT"]);

export function sumPresent(rows: StatusCount[]): { present: number; total: number } {
  let present = 0;
  let total = 0;
  for (const r of rows) {
    if (!ATTENDANCE_STATUSES.has(r.status)) continue;
    total += r.count;
    if (r.status === "PRESENT") present += r.count;
  }
  return { present, total };
}

/** Collapse (date, status, count) groups into one row per day, ascending. */
export function buildAttendanceDays(
  rows: { date: string; status: string; count: number }[],
): AttendanceDay[] {
  const byDate = new Map<string, { present: number; permission: number; sick: number; absent: number }>();
  for (const r of rows) {
    const d = byDate.get(r.date) ?? { present: 0, permission: 0, sick: 0, absent: 0 };
    if (r.status === "PRESENT") d.present += r.count;
    else if (r.status === "PERMISSION") d.permission += r.count;
    else if (r.status === "SICK") d.sick += r.count;
    else if (r.status === "ABSENT") d.absent += r.count;
    else continue; // unknown status: not a recognised bucket, not in the total
    byDate.set(r.date, d);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, d]) => {
      const total = d.present + d.permission + d.sick + d.absent;
      return { date, ...d, total, rate: rateOf(d.present, total) ?? 0 };
    })
    .filter((d) => d.total > 0);
}

/**
 * Per-class attendance rate, lowest first (ties by name). Classes missing from
 * `names` (inactive / other tenant) are dropped.
 */
export function rankLowestClasses(
  rows: { classSectionId: string; status: string; count: number }[],
  names: Map<string, string>,
  limit = 3,
): { classSectionId: string; name: string; rate: number; total: number }[] {
  const acc = new Map<string, { present: number; total: number }>();
  for (const r of rows) {
    if (!names.has(r.classSectionId) || !ATTENDANCE_STATUSES.has(r.status)) continue;
    const a = acc.get(r.classSectionId) ?? { present: 0, total: 0 };
    a.total += r.count;
    if (r.status === "PRESENT") a.present += r.count;
    acc.set(r.classSectionId, a);
  }
  return [...acc.entries()]
    .filter(([, a]) => a.total > 0)
    .map(([classSectionId, a]) => ({
      classSectionId,
      name: names.get(classSectionId) as string,
      rate: rateOf(a.present, a.total) ?? 0,
      total: a.total,
    }))
    .sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Monday of the week containing `today`, and the 7 before it. Oldest first. */
export function eightWeekStarts(today: string): string[] {
  const current = weekStart(today);
  return Array.from({ length: 8 }, (_, i) => addDaysYmd(current, (i - 7) * 7));
}

/** Checked / possible as an integer %, capped at 100; null when nothing was possible. */
export function completionPct(checked: number, possible: number): number | null {
  if (possible <= 0) return null;
  return Math.min(100, Math.round((checked / possible) * 100));
}

/**
 * Index into `starts` of the week a date belongs to, or -1. With
 * `schoolDaysOnly` a Saturday/Sunday returns -1 (journal checks are Mon-Fri).
 */
export function weekIndexOf(date: string, starts: string[], schoolDaysOnly = false): number {
  const ws = weekStart(date);
  if (schoolDaysOnly && date > addDaysYmd(ws, 4)) return -1;
  return starts.indexOf(ws);
}

/** Six "YYYY-MM" keys ending with the month of `today`, oldest first. */
export function sixMonths(today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: 6 }, (_, i) => {
    const idx = y * 12 + (m - 1) - (5 - i);
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

/** First day of the month after the given "YYYY-MM". */
export function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + m; // month index of the following month (0-based)
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

/** Sum amounts into the given months by the "YYYY-MM" prefix of `key`; others ignored. */
export function bucketByMonth(
  rows: { key: string; amount: number }[],
  months: string[],
): number[] {
  const totals = new Map<string, number>(months.map((m) => [m, 0]));
  for (const r of rows) {
    const m = r.key.slice(0, 7);
    if (totals.has(m)) totals.set(m, (totals.get(m) ?? 0) + r.amount);
  }
  return months.map((m) => totals.get(m) ?? 0);
}

/** Age bucket by days past due: <=0 current, 1-30, 31-60, 61-90, >90. */
export function agingKey(dueDate: string, today: string): AgingKey {
  const late = daysBetweenYmd(dueDate, today);
  if (late <= 0) return "current";
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  if (late <= 90) return "d61_90";
  return "d90_plus";
}

/** Fold (dueDate, outstanding, count) groups into all five buckets. Outstanding <= 0 is skipped. */
export function bucketAging(
  rows: { dueDate: string; outstanding: number; count: number }[],
  today: string,
): { key: AgingKey; amount: number; count: number }[] {
  const acc = new Map<AgingKey, { amount: number; count: number }>(
    AGING_KEYS.map((k) => [k, { amount: 0, count: 0 }]),
  );
  for (const r of rows) {
    if (r.outstanding <= 0) continue;
    const a = acc.get(agingKey(r.dueDate, today)) as { amount: number; count: number };
    a.amount += r.outstanding;
    a.count += r.count;
  }
  return AGING_KEYS.map((key) => ({ key, ...(acc.get(key) as { amount: number; count: number }) }));
}
