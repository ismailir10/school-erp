import { prisma } from "@/lib/db";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

/** The school's calendar day for the Gerbang (gate) views. */
export const GATE_TZ = "Asia/Jakarta";

export type GateCampus = { id: string; name: string };

/** The tenant's ACTIVE campuses, A to Z. */
export function listGateCampuses(tenantId: string): Promise<GateCampus[]> {
  return prisma.campus.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** The caller's own campus when it is active, else the first active campus, else null. */
export async function resolveDefaultGateCampusId(
  tenantId: string,
  employeeId: string,
  campuses: GateCampus[],
): Promise<string | null> {
  const me = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { campusId: true },
  });
  return me && campuses.some((c) => c.id === me.campusId) ? me.campusId : (campuses[0]?.id ?? null);
}

/**
 * Every ACTIVE-enrolled student on the campus, in classes of the ACTIVE
 * academic year (one row per child even when
 * enrolled in two placements) with today's non-voided attendance row.
 */
export async function getGateRoster(tenantId: string, campusId: string, date: string) {
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      status: "ACTIVE",
      student: { tenantId, status: "ACTIVE" },
      classSection: { tenantId, campusId, status: "ACTIVE", academicYear: { status: "ACTIVE" } },
    },
    select: {
      student: { select: { id: true, name: true, nickname: true } },
      classSection: { select: { id: true, name: true } },
    },
    orderBy: { student: { name: "asc" } },
  });

  const seen = new Set<string>();
  const unique = enrollments.filter((e) => {
    if (seen.has(e.student.id)) return false;
    seen.add(e.student.id);
    return true;
  });

  const attendance = await prisma.studentAttendance.findMany({
    where: {
      date,
      isVoided: false,
      studentId: { in: unique.map((e) => e.student.id) },
    },
    select: {
      studentId: true,
      status: true,
      checkInTime: true,
      checkOutTime: true,
      pickedUpByRelation: true,
      pickedUpByName: true,
    },
  });
  return { students: unique, byStudent: new Map(attendance.map((a) => [a.studentId, a])) };
}

export type GateSummary = { total: number; arrived: number; pickedUp: number };

/**
 * Today's gate status for one campus: how many children, how many have
 * arrived, how many were picked up. Same scope as the Gerbang page.
 */
export async function getGateSummary(args: {
  tenantId: string;
  employeeId: string;
  campusId?: string | null;
}): Promise<GateSummary> {
  const { tenantId, employeeId } = args;
  const campuses = await listGateCampuses(tenantId);
  const campusId =
    args.campusId && campuses.some((c) => c.id === args.campusId)
      ? args.campusId
      : await resolveDefaultGateCampusId(tenantId, employeeId, campuses);
  if (!campusId) return { total: 0, arrived: 0, pickedUp: 0 };

  const { students, byStudent } = await getGateRoster(tenantId, campusId, getTodayInTimezone(GATE_TZ));
  let arrived = 0;
  let pickedUp = 0;
  for (const s of students) {
    const a = byStudent.get(s.student.id);
    if (a?.checkInTime) arrived++;
    if (a?.checkOutTime) pickedUp++;
  }
  return { total: students.length, arrived, pickedUp };
}
