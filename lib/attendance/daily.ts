import { prisma } from "@/lib/db";
import { getTodayInTimezone, zonedDateTimeToUtc } from "@/lib/attendance/timezone";

/** The school's clock for a tenant: timezone, today's date there, work start. */
export async function getTenantClock(tenantId: string) {
  const cfg = await prisma.orgConfig.findUnique({
    where: { tenantId },
    select: { timezone: true, workStartTime: true },
  });
  const timezone = cfg?.timezone ?? "Asia/Jakarta";
  const workStartTime = cfg?.workStartTime ?? "07:00";
  return { timezone, workStartTime, today: getTodayInTimezone(timezone) };
}

/** Default check-in for an admin-recorded "Hadir": work start on that date. */
export function defaultCheckIn(date: string, workStartTime: string, timezone: string): Date {
  return zonedDateTimeToUtc(date, workStartTime, timezone);
}

export const DAILY_FUTURE_ERROR = "Tanggal belum tiba. Kehadiran hanya bisa dicatat sampai hari ini.";
