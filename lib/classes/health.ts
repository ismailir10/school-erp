import type { PrismaClient } from "@/lib/generated/prisma/client";

export type HealthBadge =
  | "Sehat"
  | "Perhatian"
  | "Kritis"
  | "Belum ada siswa"
  | "Tidak Aktif"
  | "Libur";

export type TodaySessionState = "Held" | "Missing" | "Holiday";

export type HealthInput = {
  status: string;
  enrolledCount: number;
  capacity: number;
  attendance7dPct: number | null;
  todaySession: TodaySessionState;
};

const SEHAT_ATTENDANCE_MIN = 85;
const PERHATIAN_ATTENDANCE_MIN = 70;
const SEHAT_CAPACITY_MIN_PCT = 50;

export function computeHealthBadge(input: HealthInput): HealthBadge {
  if (input.status === "INACTIVE") return "Tidak Aktif";
  if (input.todaySession === "Holiday") return "Libur";

  const att = input.attendance7dPct;
  const capPct =
    input.capacity > 0 ? (input.enrolledCount / input.capacity) * 100 : 0;

  // A brand-new class has no roster yet — that is not an alarm, so it gets a
  // neutral state instead of "Kritis".
  if (input.enrolledCount === 0) return "Belum ada siswa";
  if (att !== null && att < PERHATIAN_ATTENDANCE_MIN) return "Kritis";

  if (
    att !== null &&
    att >= SEHAT_ATTENDANCE_MIN &&
    capPct >= SEHAT_CAPACITY_MIN_PCT &&
    input.todaySession !== "Missing"
  ) {
    return "Sehat";
  }

  return "Perhatian";
}

export type AttendanceWindowEntry = {
  presentCount: number;
  totalCount: number;
  attendance7dPct: number | null;
};

// Only PRESENT is counted toward the numerator. SICK and PERMISSION are
// excused absences — the student was not in class, so they do not raise the
// health badge. ABSENT counts toward the denominator the same way.
export async function attendanceLast7Days(
  prisma: PrismaClient,
  sectionIds: string[],
  todayYmd: string,
): Promise<Map<string, AttendanceWindowEntry>> {
  const result = new Map<string, AttendanceWindowEntry>();
  if (sectionIds.length === 0) return result;

  const startYmd = ymdMinusDays(todayYmd, 6);

  const rows = await prisma.studentAttendance.groupBy({
    by: ["classSectionId", "status"],
    where: {
      classSectionId: { in: sectionIds },
      date: { gte: startYmd, lte: todayYmd },
      isVoided: false,
      sessionId: { not: null },
    },
    _count: { _all: true },
  });

  const byId = new Map<string, { present: number; total: number }>();
  for (const id of sectionIds) byId.set(id, { present: 0, total: 0 });

  for (const r of rows) {
    const bucket = byId.get(r.classSectionId);
    if (!bucket) continue;
    const count = r._count._all;
    bucket.total += count;
    if (r.status === "PRESENT") bucket.present += count;
  }

  for (const [id, { present, total }] of byId.entries()) {
    result.set(id, {
      presentCount: present,
      totalCount: total,
      attendance7dPct: total === 0 ? null : (present / total) * 100,
    });
  }
  return result;
}

export type TodaySessionEntry = { state: TodaySessionState };

export async function todaySessionState(
  prisma: PrismaClient,
  sectionIds: string[],
  todayYmd: string,
  tenantId: string,
  isWorkingDay: boolean,
): Promise<Map<string, TodaySessionEntry>> {
  const result = new Map<string, TodaySessionEntry>();
  if (sectionIds.length === 0) return result;

  const holiday = await prisma.holiday.findFirst({
    where: { tenantId, date: todayYmd },
    select: { id: true },
  });

  if (!isWorkingDay || holiday) {
    for (const id of sectionIds) result.set(id, { state: "Holiday" });
    return result;
  }

  const sessions = await prisma.classSession.findMany({
    where: { classSectionId: { in: sectionIds }, date: todayYmd },
    select: { classSectionId: true },
  });

  const heldSet = new Set(sessions.map((s) => s.classSectionId));
  for (const id of sectionIds) {
    result.set(id, { state: heldSet.has(id) ? "Held" : "Missing" });
  }
  return result;
}

function ymdMinusDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const shifted = new Date(base - days * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
