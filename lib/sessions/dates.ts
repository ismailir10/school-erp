/**
 * Date helpers for ClassSession reconciliation.
 *
 * Storage contract: `Semester.startDate` / `Semester.endDate` are persisted as
 * UTC-midnight DateTimes that represent a Jakarta-tz calendar day (the same
 * convention `parseJakartaYmd` in `lib/validations/curriculum.ts` writes). A
 * `ClassSession.date` is a `YYYY-MM-DD` string in the Jakarta-tz calendar.
 *
 * Because a Semester boundary is *already* UTC-midnight-of-the-Jakarta-day,
 * reading its calendar day is `getYmdInTimezone(d, "UTC")` — NOT
 * `"Asia/Jakarta"`, which would shift the +07:00 stored value back a day. The
 * weekday is likewise the UTC weekday of that same UTC-midnight instant.
 */
export const JAKARTA_TZ = "Asia/Jakarta";

const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Read the Jakarta calendar day (YYYY-MM-DD) off a Semester boundary
 * DateTime. The boundary is stored as UTC midnight of the Jakarta day, so the
 * UTC YMD is the calendar day — using Jakarta tz here would mis-shift it.
 *
 * Hand-formatted from the UTC getters rather than `Intl.DateTimeFormat`: this
 * runs once per day across potentially thousands of days in a reconcile, and
 * constructing a formatter per call is measurably slow.
 */
export function ymdFromSemesterBoundary(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The MON/TUE/.../SUN weekday code for a Semester-boundary-style UTC-midnight
 * date. `getUTCDay()` on a UTC-midnight instant yields the Jakarta weekday
 * because the stored value already encodes the Jakarta day.
 */
export function weekdayCodeFromUtcMidnight(d: Date): WeekdayCode {
  return WEEKDAY_CODES[d.getUTCDay()];
}

/**
 * Inclusive list of every Jakarta calendar day (as YYYY-MM-DD) between two
 * Semester boundaries. Iterates by adding whole UTC days so DST-free Jakarta
 * never drops or doubles a boundary day. Returns `[]` if `end` precedes
 * `start`.
 */
export function eachDayInclusive(
  start: Date,
  end: Date,
): { ymd: string; weekday: WeekdayCode }[] {
  const out: { ymd: string; weekday: WeekdayCode }[] = [];
  // Normalise to UTC midnight defensively — callers pass Prisma DateTimes that
  // should already be UTC midnight, but a corrupted row could carry a time.
  let cursor = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    ),
  );
  const endMs = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );
  while (cursor.getTime() <= endMs) {
    out.push({
      ymd: ymdFromSemesterBoundary(cursor),
      weekday: weekdayCodeFromUtcMidnight(cursor),
    });
    cursor = new Date(cursor.getTime() + MS_PER_DAY);
  }
  return out;
}

/**
 * Parse `OrgConfig.workingDays` into a Set. Accepts the JSON string array
 * ('["MON","TUE"]') and the legacy CSV form ("MON,TUE"), tolerating
 * whitespace/case. Throws when the value is neither: JSON that is not an
 * array, or a non-JSON string with no recognisable day code at all, so a
 * corrupted config fails loud rather than silently generating zero sessions.
 *
 * Returns both the recognised weekday `set` and the list of `unknownCodes` —
 * entries that didn't match a known MON..SUN code (e.g. a `"MONDAY"` typo).
 * Callers surface `unknownCodes` as a warning rather than silently dropping
 * them.
 */
export function parseWorkingDays(raw: string): {
  set: Set<WeekdayCode>;
  unknownCodes: string[];
} {
  let items: unknown[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("org_config_working_days_not_array");
    }
    items = parsed;
  } catch (err) {
    if (err instanceof Error && err.message === "org_config_working_days_not_array") throw err;
    // Legacy CSV ("MON,TUE,WED"): needs at least one real day code.
    items = raw.split(",");
    const hasKnown = items.some((v) =>
      (WEEKDAY_CODES as readonly string[]).includes(String(v).trim().toUpperCase()),
    );
    if (!hasKnown) throw new Error("org_config_working_days_invalid_json");
  }
  const set = new Set<WeekdayCode>();
  const unknownCodes: string[] = [];
  for (const v of items) {
    const code = String(v).trim().toUpperCase();
    if ((WEEKDAY_CODES as readonly string[]).includes(code)) {
      set.add(code as WeekdayCode);
    } else {
      unknownCodes.push(code);
    }
  }
  return { set, unknownCodes };
}
