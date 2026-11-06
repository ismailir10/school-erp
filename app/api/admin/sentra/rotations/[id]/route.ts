import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rotationUpdateSchema } from "@/lib/validations/sentra";
import { normalizeRotationStart } from "@/lib/sentra/rotation";
import {
  badRequest,
  DUP_ROTATION,
  isUniqueViolation,
  limitWrites,
  notFound,
} from "../../_helpers";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const rotation = await prisma.sentraRotation.findFirst({
    where: { id, tenantId: session.tenantId },
    select: {
      id: true,
      name: true,
      campusId: true,
      startDate: true,
      cycleDays: true,
      status: true,
      academicYear: { select: { id: true, name: true, status: true } },
      classes: {
        orderBy: { sortOrder: "asc" },
        select: { classSection: { select: { id: true, name: true } } },
      },
      slots: {
        orderBy: [{ dayIndex: "asc" }],
        select: { dayIndex: true, classSectionId: true, sentraId: true },
      },
    },
  });
  if (!rotation) return notFound("Putaran");

  const sentra = await prisma.sentra.findMany({
    where: { tenantId: session.tenantId, campusId: rotation.campusId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, status: true },
  });

  return NextResponse.json({
    id: rotation.id,
    name: rotation.name,
    campusId: rotation.campusId,
    academicYear: rotation.academicYear,
    startDate: rotation.startDate,
    cycleDays: rotation.cycleDays,
    status: rotation.status,
    classes: rotation.classes.map((c) => ({
      classSectionId: c.classSection.id,
      name: c.classSection.name,
    })),
    slots: rotation.slots,
    sentra,
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const limited = limitWrites(req, "sentra-rotation-update");
  if (limited) return limited;

  const existing = await prisma.sentraRotation.findFirst({
    where: { id, tenantId: session.tenantId },
    select: {
      id: true,
      campusId: true,
      academicYearId: true,
      cycleDays: true,
    },
  });
  if (!existing) return notFound("Putaran");

  const parsed = await validateBody(rotationUpdateSchema, await req.json());
  if (parsed.error) return parsed.error;
  const { name, startDate, cycleDays, status, classSectionIds } = parsed.data;

  const uniqueClasses = classSectionIds ? [...new Set(classSectionIds)] : null;
  if (uniqueClasses) {
    const found = await prisma.classSection.findMany({
      where: {
        id: { in: uniqueClasses },
        tenantId: session.tenantId,
        campusId: existing.campusId,
        academicYearId: existing.academicYearId,
      },
      select: { id: true },
    });
    if (found.length !== uniqueClasses.length) {
      return badRequest(
        "Semua kelas harus berada di kampus dan tahun ajaran putaran ini.",
      );
    }
  }

  if (name !== undefined) {
    const dup = await prisma.sentraRotation.findFirst({
      where: {
        tenantId: session.tenantId,
        campusId: existing.campusId,
        academicYearId: existing.academicYearId,
        id: { not: id },
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ error: DUP_ROTATION }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sentraRotation.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(startDate !== undefined && {
            startDate: normalizeRotationStart(startDate),
          }),
          ...(cycleDays !== undefined && { cycleDays }),
          ...(status !== undefined && { status }),
        },
      });

      if (uniqueClasses) {
        await tx.sentraRotationClass.deleteMany({
          where: { rotationId: id, classSectionId: { notIn: uniqueClasses } },
        });
        const current = await tx.sentraRotationClass.findMany({
          where: { rotationId: id },
          select: { classSectionId: true },
        });
        const have = new Set(current.map((c) => c.classSectionId));
        const toAdd = uniqueClasses.filter((c) => !have.has(c));
        if (toAdd.length > 0) {
          await tx.sentraRotationClass.createMany({
            data: toAdd.map((classSectionId) => ({
              tenantId: session.tenantId,
              rotationId: id,
              classSectionId,
            })),
          });
        }
        // Re-apply requested order.
        for (let i = 0; i < uniqueClasses.length; i++) {
          await tx.sentraRotationClass.updateMany({
            where: { rotationId: id, classSectionId: uniqueClasses[i] },
            data: { sortOrder: i },
          });
        }
        // Slots of removed classes are now orphans.
        await tx.sentraRotationSlot.deleteMany({
          where: { rotationId: id, classSectionId: { notIn: uniqueClasses } },
        });
      }

      if (cycleDays !== undefined && cycleDays < existing.cycleDays) {
        await tx.sentraRotationSlot.deleteMany({
          where: { rotationId: id, dayIndex: { gte: cycleDays } },
        });
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: DUP_ROTATION }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const limited = limitWrites(req, "sentra-rotation-delete");
  if (limited) return limited;

  const existing = await prisma.sentraRotation.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!existing) return notFound("Putaran");

  // Classes and slots cascade (onDelete: Cascade).
  await prisma.sentraRotation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
