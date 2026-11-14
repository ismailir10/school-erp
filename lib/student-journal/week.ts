export function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function weekReadDates(weekStartYmd: string): string[] {
  const start = new Date(`${weekStartYmd}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** Five school days by default; show weekend columns only when there is activity. */
export function weekDates(weekStartYmd: string, observedDates: readonly string[] = []): string[] {
  const dates = weekReadDates(weekStartYmd);
  const observed = new Set(observedDates);
  return dates.filter((date, index) => index < 5 || observed.has(date));
}
