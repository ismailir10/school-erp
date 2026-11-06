import { prisma } from "@/lib/db";
import { rotationDayIndex } from "./rotation";

/** Rotation filter shared by every query: ACTIVE rotation, ACTIVE year, this tenant. */
function activeRotation(tenantId: string) {
  return { status: "ACTIVE", tenantId, academicYear: { status: "ACTIVE" } };
}

/** Rotation has a slot whose sentra is ACTIVE and owned by this employee. */
function ownsSentraSlot(employeeId: string) {
  return {
    slots: {
      some: {
        sentra: { status: "ACTIVE", teachers: { some: { employeeId } } },
      },
    },
  };
}

/** Classes a guru sentra can reach through any active putaran of hers. */
export async function getSentraClassIds(
  employeeId: string,
  tenantId: string,
): Promise<string[]> {
  const rotations = await prisma.sentraRotation.findMany({
    where: { ...activeRotation(tenantId), ...ownsSentraSlot(employeeId) },
    select: { classes: { select: { classSectionId: true } } },
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
  const hit = await prisma.sentraRotationClass.findFirst({
    where: {
      ...classFilter,
      classSection: { tenantId },
      rotation: { ...activeRotation(tenantId), ...ownsSentraSlot(employeeId) },
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
  const rotations = await prisma.sentraRotation.findMany({
    where: { ...activeRotation(tenantId), ...ownsSentraSlot(employeeId) },
    select: {
      id: true,
      startDate: true,
      cycleDays: true,
      slots: {
        where: {
          sentra: { status: "ACTIVE", teachers: { some: { employeeId } } },
        },
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
