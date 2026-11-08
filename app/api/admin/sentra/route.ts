import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { sentraCreateSchema } from "@/lib/validations/sentra";
import {
  allActiveCampusEmployees,
  badRequest,
  DUP_SENTRA,
  findCampus,
  isUniqueViolation,
  limitWrites,
  notFound,
  TEACHER_ERROR,
} from "./_helpers";

export async function GET(req: NextRequest) {
  const auth = await requirePermission("academic.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const campusId = new URL(req.url).searchParams.get("campusId");
  if (!campusId) return badRequest("campusId wajib disediakan.");
  if (!(await findCampus(campusId, session.tenantId))) {
    return notFound("Kampus");
  }

  const [sentra, rotations] = await Promise.all([
    prisma.sentra.findMany({
      where: { tenantId: session.tenantId, campusId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        sortOrder: true,
        legacyCenter: true,
        teachers: { select: { employee: { select: { id: true, nama: true } } } },
      },
    }),
    prisma.sentraRotation.findMany({
      where: { tenantId: session.tenantId, campusId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        startDate: true,
        cycleDays: true,
        status: true,
        academicYear: { select: { id: true, name: true, status: true } },
        classes: {
          orderBy: { sortOrder: "asc" },
          select: { classSection: { select: { id: true, name: true } } },
        },
      },
    }),
  ]);

  return NextResponse.json({
    sentra: sentra.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      sortOrder: s.sortOrder,
      legacyCenter: s.legacyCenter,
      teachers: s.teachers.map((t) => ({
        employeeId: t.employee.id,
        name: t.employee.nama,
      })),
    })),
    rotations: rotations.map((r) => ({
      id: r.id,
      name: r.name,
      academicYear: r.academicYear,
      startDate: r.startDate,
      cycleDays: r.cycleDays,
      status: r.status,
      classes: r.classes.map((c) => ({
        classSectionId: c.classSection.id,
        name: c.classSection.name,
      })),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const limited = limitWrites(req, "sentra-create");
  if (limited) return limited;

  const parsed = await validateBody(sentraCreateSchema, await req.json());
  if (parsed.error) return parsed.error;
  const { campusId, name, teacherIds, sortOrder } = parsed.data;

  if (!(await findCampus(campusId, session.tenantId))) {
    return notFound("Kampus");
  }
  if (!(await allActiveCampusEmployees(teacherIds, session.tenantId, campusId))) {
    return badRequest(TEACHER_ERROR);
  }

  const dup = await prisma.sentra.findFirst({
    where: { campusId, tenantId: session.tenantId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (dup) return NextResponse.json({ error: DUP_SENTRA }, { status: 409 });

  try {
    const created = await prisma.sentra.create({
      data: {
        tenantId: session.tenantId,
        campusId,
        name,
        sortOrder: sortOrder ?? 0,
        teachers: {
          create: [...new Set(teacherIds)].map((employeeId) => ({
            tenantId: session.tenantId,
            employeeId,
          })),
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: DUP_SENTRA }, { status: 409 });
    }
    throw err;
  }
}
