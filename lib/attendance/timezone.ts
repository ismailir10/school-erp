/**
 * Format any Date as YYYY-MM-DD in the given timezone.
 * Avoids both UTC-drift (host running UTC, e.g. Vercel) and host-local
 * drift (`getFullYear/getMonth/getDate` reading the server's TZ rather
 * than the school's). Use this anywhere a YMD string must line up with
 * Jakarta calendar days.
 */
export function getYmdInTimezone(d: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d); // Returns "YYYY-MM-DD"
}

/**
 * Get today's date string (YYYY-MM-DD) in a specific timezone.
 * Thin wrapper around `getYmdInTimezone(new Date(), timezone)`.
 */
export function getTodayInTimezone(timezone: string): string {
  return getYmdInTimezone(new Date(), timezone);
}

/**
 * The calendar month and year of `d` in `timezone`, as plain numbers
 * (`{ month: 10, year: 2026 }`). Use this for a "current month" default on the
 * server: `new Date().getMonth()` reads the server clock (UTC on Vercel), which
 * is still last month for the first seven hours of the 1st in WIB.
 */
export function getMonthYearInTimezone(
  d: Date = new Date(),
  timezone: string,
): { month: number; year: number } {
  const [year, month] = getYmdInTimezone(d, timezone).split("-");
  return { month: Number(month), year: Number(year) };
}

/**
 * Offset (ms) of `timezone` from UTC at the given instant: the zone's
 * wall-clock reading interpreted as UTC, minus the instant itself.
 */
function getTimezoneOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  // Floor to whole seconds: the formatter output has no sub-second part.
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock time on a calendar date in `timezone` to the real UTC
 * instant. `dateYmd` is `YYYY-MM-DD`, `hhmm` is 24h `HH:MM`. Intl only; never
 * reads the host's local zone. The offset is re-evaluated at the candidate
 * instant so DST-observing zones land on the right side of a transition.
 */
export function zonedDateTimeToUtc(dateYmd: string, hhmm: string, timezone: string): Date {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const firstGuess = wallAsUtc - getTimezoneOffsetMs(new Date(wallAsUtc), timezone);
  return new Date(wallAsUtc - getTimezoneOffsetMs(new Date(firstGuess), timezone));
}

/**
 * True when the wall-clock `hhmm` on `dateYmd` actually occurs in `timezone`.
 * A spring-forward gap (e.g. 02:30 on 2026-03-08 in America/New_York) has no
 * such instant: `zonedDateTimeToUtc` resolves it to a neighbouring time, so we
 * round-trip the result and compare. Ambiguous fall-back times exist (twice)
 * and return true.
 */
export function localTimeExists(dateYmd: string, hhmm: string, timezone: string): boolean {
  const instant = zonedDateTimeToUtc(dateYmd, hhmm, timezone);
  if (getYmdInTimezone(instant, timezone) !== dateYmd) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")}` === hhmm;
}
