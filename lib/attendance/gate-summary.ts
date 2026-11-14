import { prisma } from "@/lib/db";
import { scheduledClassIds } from "@/lib/sessions/scheduled-day";
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
 * One row per student in the campus's active-year classes, with today's
 * arrival and pickup across that student's current placements.
 */
export async function getGateRoster(tenantId: string, campusId: string, date: string) {
  const classScope = { tenantId, campusId, status: "ACTIVE", academicYear: { status: "ACTIVE" } } as const;
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      status: "ACTIVE",
      student: { tenantId, status: "ACTIVE" },
      classSection: classScope,
    },
    select: {
      student: { select: { id: true, name: true, nickname: true } },
      classSection: { select: { id: true, name: true } },
    },
    orderBy: { student: { name: "asc" } },
  });

  const students: typeof enrollments = [];
  const placements = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    const { student, classSection } = enrollment;
    const classes = placements.get(student.id);
    if (classes) {
      classes.add(classSection.id);
    } else {
      students.push(enrollment);
      placements.set(student.id, new Set([classSection.id]));
    }
  }

  const attendance = await prisma.studentAttendance.findMany({
    where: {
      date,
      isVoided: false,
      studentId: { in: [...placements.keys()] },
      classSection: classScope,
    },
    select: {
      studentId: true,
      classSectionId: true,
      status: true,
      checkInTime: true,
      checkOutTime: true,
      pickedUpByRelation: true,
      pickedUpByName: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const byStudent = new Map<string, (typeof attendance)[number]>();
  for (const row of attendance) {
    // The campus can have other active classes that this student has left.
    if (!placements.get(row.studentId)?.has(row.classSectionId)) continue;
    const current = byStudent.get(row.studentId);
    if (!current) {
      byStudent.set(row.studentId, { ...row });
      continue;
    }
    if (row.status === "PRESENT") current.status = row.status;
    if (row.checkInTime && (!current.checkInTime || row.checkInTime < current.checkInTime)) {
      current.checkInTime = row.checkInTime;
    }
    if (row.checkOutTime && (!current.checkOutTime || row.checkOutTime > current.checkOutTime)) {
      current.checkOutTime = row.checkOutTime;
      current.pickedUpByRelation = row.pickedUpByRelation;
      current.pickedUpByName = row.pickedUpByName;
    }
  }
  const scheduled = await scheduledClassIds(tenantId, [...new Set(enrollments.map(e => e.classSection.id))], date);
  const availableStudents = new Set([...placements].filter(([, ids]) => [...ids].some(id => scheduled.has(id))).map(([id]) => id));
  // Name the active placement whose session this child can use today.
  const displayStudents = students.map(enrollment => enrollments.find(candidate => candidate.student.id === enrollment.student.id && scheduled.has(candidate.classSection.id)) ?? enrollment);
  return { students: displayStudents, byStudent, availableStudents };
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

  const { students, byStudent, availableStudents } = await getGateRoster(tenantId, campusId, getTodayInTimezone(GATE_TZ));
  let arrived = 0;
  let pickedUp = 0;
  for (const s of students) {
    if (!availableStudents.has(s.student.id)) continue;
    const a = byStudent.get(s.student.id);
    if (a?.checkInTime) arrived++;
    if (a?.checkOutTime) pickedUp++;
  }
  return { total: availableStudents.size, arrived, pickedUp };
}
