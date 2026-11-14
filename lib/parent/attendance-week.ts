import { getYmdInTimezone } from "@/lib/attendance/timezone";
import { weekDates, weekStart } from "@/lib/student-journal/week";

const WIB = "Asia/Jakarta";

function validYmd(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Parent records stop at the current calendar week, including weekends. */
export function resolveParentWeek(requestedWeek: string | null | undefined, today: string): string {
  const currentMonday = weekStart(today);
  const requestedMonday = weekStart(validYmd(requestedWeek) ? requestedWeek : today);
  return requestedMonday > currentMonday ? currentMonday : requestedMonday;
}

export function parentAttendanceWeek(now: Date, requestedWeek?: string) {
  const today = getYmdInTimezone(now, WIB);
  const monday = resolveParentWeek(requestedWeek, today);
  const days = weekDates(monday);
  const moveWeek = (offset: number) => {
    const date = new Date(`${monday}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  return { today, days, isCurrentWeek: monday === weekStart(today), prevWeek: moveWeek(-7), nextWeek: moveWeek(7) };
}
