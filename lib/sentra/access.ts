import { prisma } from "@/lib/db";
import { rotationDayIndex } from "./rotation";

/** Scope a putaran grant to the teacher's current campus, even if an old SentraTeacher row survives a transfer. */
function teacherRotationAccess(employeeId: string, tenantId: string) {
  const campusScope = {
    tenantId,
    campus: { tenantId, employees: { some: { id: employeeId, tenantId } } },
  };
  const classMembership = { tenantId, classSection: campusScope };
  const ownedSlot = {
    ...classMembership,
    sentra: {
      ...campusScope,
      status: "ACTIVE",
      teachers: { some: { tenantId, employeeId } },
    },
  };
  return {
    classMembership,
    ownedSlot,
    rotation: {
      ...campusScope,
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
      slots: { some: ownedSlot },
    },
  };
}

/** Classes a guru sentra can reach through any active putaran of hers. */
export async function getSentraClassIds(
  employeeId: string,
  tenantId: string,
): Promise<string[]> {
  const access = teacherRotationAccess(employeeId, tenantId);
  const rotations = await prisma.sentraRotation.findMany({
    where: access.rotation,
    select: {
      classes: { where: access.classMembership, select: { classSectionId: true } },
    },
  });
  return [
    ...new Set(rotations.flatMap((r) => r.classes.map((c) => c.classSectionId))),
  ];
}

/** Assignment first (cheap, common); sentra ownership only as a fallback. */
export async function teacherCanAccessClass(
  employeeId: string,
  tenantId: string,
  classSectionId: string,
): Promise<boolean> {
  const assignment = await prisma.teachingAssignment.findFirst({
    where: { employeeId, classSectionId, classSection: { tenantId } },
    select: { id: true },
  });
  if (assignment) return true;
  return sentraReaches(employeeId, tenantId, { classSectionId });
}

/** True when any of the classes is reachable via assignment OR sentra. */
export async function getStudentSentraAccess(
  employeeId: string,
  tenantId: string,
  classSectionIds: string[],
): Promise<boolean> {
  if (classSectionIds.length === 0) return false;
  const assignment = await prisma.teachingAssignment.findFirst({
    where: {
      employeeId,
      classSectionId: { in: classSectionIds },
      classSection: { tenantId },
    },
    select: { id: true },
  });
  if (assignment) return true;
  return sentraReaches(employeeId, tenantId, { classSectionId: { in: classSectionIds } });
}

async function sentraReaches(
  employeeId: string,
  tenantId: string,
  classFilter: { classSectionId: string | { in: string[] } },
): Promise<boolean> {
  const access = teacherRotationAccess(employeeId, tenantId);
  const hit = await prisma.sentraRotationClass.findFirst({
    where: {
      ...classFilter,
      ...access.classMembership,
      rotation: access.rotation,
    },
    select: { id: true },
  });
  return !!hit;
}

export type TeacherSentraToday = {
  sentraId: string;
  sentraName: string;
  classSectionId: string;
  className: string;
  rotationId: string;
};

/** Where the guru's sentra is hosting a class today (empty on weekends / outside a putaran). */
export async function getTeacherSentraToday(
  employeeId: string,
  tenantId: string,
  todayYmd: string,
): Promise<TeacherSentraToday[]> {
  const access = teacherRotationAccess(employeeId, tenantId);
  const rotations = await prisma.sentraRotation.findMany({
    where: access.rotation,
    select: {
      id: true,
      startDate: true,
      cycleDays: true,
      slots: {
        where: access.ownedSlot,
        select: {
          dayIndex: true,
          sentra: { select: { id: true, name: true } },
          classSection: { select: { id: true, name: true } },
        },
      },
    },
  });

  const out: TeacherSentraToday[] = [];
  for (const r of rotations) {
    const idx = rotationDayIndex(r.startDate, todayYmd, r.cycleDays);
    if (idx === null) continue;
    for (const s of r.slots) {
      if (s.dayIndex !== idx) continue;
      out.push({
        sentraId: s.sentra.id,
        sentraName: s.sentra.name,
        classSectionId: s.classSection.id,
        className: s.classSection.name,
        rotationId: r.id,
      });
    }
  }
  return out;
}
