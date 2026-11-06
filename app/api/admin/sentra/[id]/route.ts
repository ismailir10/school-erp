import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { sentraUpdateSchema } from "@/lib/validations/sentra";
import {
  allActiveCampusEmployees,
  badRequest,
  DUP_SENTRA,
  isUniqueViolation,
  limitWrites,
  notFound,
  TEACHER_ERROR,
} from "../_helpers";

// No DELETE: a sentra is never hard-deleted, only deactivated (Decision 1).

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const limited = limitWrites(req, "sentra-update");
  if (limited) return limited;

  const existing = await prisma.sentra.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, campusId: true },
  });
  if (!existing) return notFound("Sentra");

  const parsed = await validateBody(sentraUpdateSchema, await req.json());
  if (parsed.error) return parsed.error;
  const { name, status, sortOrder, teacherIds } = parsed.data;

  if (
    teacherIds &&
    !(await allActiveCampusEmployees(teacherIds, session.tenantId, existing.campusId))
  ) {
    return badRequest(TEACHER_ERROR);
  }

  if (name !== undefined) {
    const dup = await prisma.sentra.findFirst({
      where: {
        campusId: existing.campusId,
        tenantId: session.tenantId,
        id: { not: id },
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (dup) return NextResponse.json({ error: DUP_SENTRA }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sentra.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(status !== undefined && { status }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
      });
      if (teacherIds) {
        await tx.sentraTeacher.deleteMany({ where: { sentraId: id } });
        const unique = [...new Set(teacherIds)];
        if (unique.length > 0) {
          await tx.sentraTeacher.createMany({
            data: unique.map((employeeId) => ({
              tenantId: session.tenantId,
              sentraId: id,
              employeeId,
            })),
          });
        }
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: DUP_SENTRA }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
