export type YearForDefaults = { name: string; startDate: string; endDate: string; status: string };

export type NextYearDefaults = { name: string; startDate: string; endDate: string };

const ymd = (s: string) => s.slice(0, 10);

function addDays(date: string, days: number): string {
  const d = new Date(`${ymd(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addYears(date: string, years: number): string {
  const [y, m, d] = ymd(date).split("-").map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

/**
 * Suggested values for "Tambah Tahun Ajaran" (R2-ADMIN-15): the year that
 * follows the latest non-archived one. Starts the day after that year ends and
 * runs one year less a day, so the overlap check (inclusive ends) passes; the
 * name continues "2026/2027" -> "2027/2028". Returns `null` when there is no
 * non-archived year to continue from — the dialog then opens blank, as before.
 */
export function nextAcademicYearDefaults(years: YearForDefaults[]): NextYearDefaults | null {
  const open = years.filter((y) => y.status !== "ARCHIVED");
  if (open.length === 0) return null;
  const latest = open.reduce((a, b) => (ymd(b.endDate) > ymd(a.endDate) ? b : a));

  const startDate = addDays(latest.endDate, 1);
  const endDate = addDays(addYears(startDate, 1), -1);

  const m = /^(\d{4})\s*\/\s*(\d{4})$/.exec(latest.name.trim());
  const name = m
    ? `${Number(m[1]) + 1}/${Number(m[2]) + 1}`
    : `${startDate.slice(0, 4)}/${Number(startDate.slice(0, 4)) + 1}`;

  return { name, startDate, endDate };
}
