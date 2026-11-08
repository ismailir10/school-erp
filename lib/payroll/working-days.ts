const VALID_DAY_CODES = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

/**
 * Tolerant parser for OrgConfig.workingDays.
 *
 * Historical drift: rows seeded before the current API path stored the value
 * as a CSV string ("MON,TUE,WED,THU,FRI") while the current API writes a
 * JSON-encoded array ('["MON","TUE","WED","THU","FRI"]'). JSON.parse on the
 * legacy CSV form throws SyntaxError and crashes any consumer. This parser
 * accepts both shapes plus the empty/null edge cases. Anything truly
 * unparseable returns an empty array — caller decides the fallback.
 */
export function parseWorkingDays(stored: string | null | undefined): string[] {
  if (!stored) return [];
  const trimmed = stored.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeDayCodes(parsed);
    } catch {
      // fall through to CSV path
    }
  }

  return normalizeDayCodes(trimmed.split(","));
}

function normalizeDayCodes(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const code = v.trim().toUpperCase();
    if (VALID_DAY_CODES.has(code) && !out.includes(code)) {
      out.push(code);
    }
  }
  return out;
}

/**
 * Calculate actual working days in a payroll period.
 * Excludes weekends (not in workingDays) and holidays.
 * Half-day holidays count as 0.5.
 */
export function calculateWorkingDays(
  periodStart: string, // "2024-08-21"
  periodEnd: string, // "2024-09-20"
  workingDays: string[], // ["MON","TUE","WED","THU","FRI"]
  holidays: { date: string; isHalfDay: boolean }[]
): number {
  const DAY_MAP: Record<number, string> = {
    0: "SUN", 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT",
  };

  const holidayMap = new Map<string, boolean>();
  for (const h of holidays) {
    holidayMap.set(h.date, h.isHalfDay);
  }

  let count = 0;
  const start = new Date(periodStart + "T00:00:00");
  const end = new Date(periodEnd + "T00:00:00");

  const current = new Date(start);
  while (current <= end) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, "0");
    const d = String(current.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    const dow = current.getDay();
    const dayName = DAY_MAP[dow];

    if (workingDays.includes(dayName)) {
      if (holidayMap.has(dateStr)) {
        // Holiday on a working day
        const isHalf = holidayMap.get(dateStr)!;
        if (isHalf) count += 0.5;
        // Full holiday = 0 (don't add)
      } else {
        count += 1;
      }
    }

    current.setDate(current.getDate() + 1);
  }

  return count;
}

/**
 * Count attendance days for an employee in a period.
 * PRESENT, LATE, PRESENT_NO_CHECKOUT = 1 day
 * HALF_DAY = 0.5
 * LEAVE = 1 (counts as present for pro-rating, paid leave)
 *
 * Only APPROVED records count: a geofence check-in still PENDING (or REJECTED)
 * is not a worked day yet. A record without `approvalStatus` is treated as
 * APPROVED so legacy callers and rows keep their old meaning.
 */
export function countAttendanceDays(
  records: { status: string; approvalStatus?: string | null }[]
): { daysPresent: number; daysLeave: number } {
  let daysPresent = 0;
  let daysLeave = 0;

  for (const r of records) {
    if (r.approvalStatus != null && r.approvalStatus !== "APPROVED") continue;
    switch (r.status) {
      case "PRESENT":
      case "LATE":
      case "PRESENT_NO_CHECKOUT":
        daysPresent += 1;
        break;
      case "HALF_DAY":
        daysPresent += 0.5;
        break;
      case "LEAVE":
        daysLeave += 1;
        break;
    }
  }

  return { daysPresent, daysLeave };
}
