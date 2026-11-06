import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rotationCreateSchema } from "@/lib/validations/sentra";
import { normalizeRotationStart } from "@/lib/sentra/rotation";
import {
  badRequest,
  DUP_ROTATION,
  findCampus,
  isUniqueViolation,
  limitWrites,
  notFound,
} from "../_helpers";

export async function POST(req: NextRequest) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const limited = limitWrites(req, "sentra-rotation-create");
  if (limited) return limited;

  const parsed = await validateBody(rotationCreateSchema, await req.json());
  if (parsed.error) return parsed.error;
  const { campusId, academicYearId, name, startDate, cycleDays, classSectionIds } =
    parsed.data;

  if (!(await findCampus(campusId, session.tenantId))) {
    return notFound("Kampus");
  }
  const year = await prisma.academicYear.findFirst({
    where: { id: academicYearId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!year) return notFound("Tahun ajaran");

  const uniqueClasses = [...new Set(classSectionIds)];
  const classes = await prisma.classSection.findMany({
    where: {
      id: { in: uniqueClasses },
      tenantId: session.tenantId,
      campusId,
      academicYearId,
    },
    select: { id: true },
  });
  if (classes.length !== uniqueClasses.length) {
    return badRequest("Semua kelas harus berada di kampus dan tahun ajaran putaran ini.");
  }

  const dup = await prisma.sentraRotation.findFirst({
    where: {
      tenantId: session.tenantId,
      campusId,
      academicYearId,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (dup) return NextResponse.json({ error: DUP_ROTATION }, { status: 409 });

  try {
    const created = await prisma.sentraRotation.create({
      data: {
        tenantId: session.tenantId,
        campusId,
        academicYearId,
        name,
        startDate: normalizeRotationStart(startDate),
        cycleDays,
        classes: {
          create: uniqueClasses.map((classSectionId, i) => ({
            tenantId: session.tenantId,
            classSectionId,
            sortOrder: i,
          })),
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: DUP_ROTATION }, { status: 409 });
    }
    throw err;
  }
}
