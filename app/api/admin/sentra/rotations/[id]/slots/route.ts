import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rotationSlotsSchema } from "@/lib/validations/sentra";
import { badRequest, limitWrites, notFound } from "../../../_helpers";

// Replace-all save of the putaran grid. The same sentra twice on one day is
// allowed on purpose (shared room); the UI warns (Decision 10).

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const limited = limitWrites(req, "sentra-rotation-slots");
  if (limited) return limited;

  const rotation = await prisma.sentraRotation.findFirst({
    where: { id, tenantId: session.tenantId },
    select: {
      id: true,
      campusId: true,
      cycleDays: true,
      classes: { select: { classSectionId: true } },
    },
  });
  if (!rotation) return notFound("Putaran");

  const parsed = await validateBody(rotationSlotsSchema, await req.json());
  if (parsed.error) return parsed.error;
  const { slots } = parsed.data;

  const classIds = new Set(rotation.classes.map((c) => c.classSectionId));
  const seen = new Set<string>();
  for (const s of slots) {
    if (s.dayIndex >= rotation.cycleDays) {
      return badRequest(`Hari ke-${s.dayIndex + 1} di luar siklus putaran.`);
    }
    if (!classIds.has(s.classSectionId)) {
      return badRequest("Kelas tidak termasuk dalam putaran ini.");
    }
    const key = `${s.dayIndex}:${s.classSectionId}`;
    if (seen.has(key)) return badRequest("Ada sel yang terisi dua kali.");
    seen.add(key);
  }

  const sentraIds = [
    ...new Set(slots.map((s) => s.sentraId).filter((v): v is string => !!v)),
  ];
  if (sentraIds.length > 0) {
    const valid = await prisma.sentra.findMany({
      where: {
        id: { in: sentraIds },
        tenantId: session.tenantId,
        campusId: rotation.campusId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (valid.length !== sentraIds.length) {
      return badRequest("Sentra harus aktif dan berada di kampus putaran ini.");
    }
  }

  const rows = slots
    .filter((s): s is typeof s & { sentraId: string } => s.sentraId !== null)
    .map((s) => ({
      tenantId: session.tenantId,
      rotationId: id,
      dayIndex: s.dayIndex,
      classSectionId: s.classSectionId,
      sentraId: s.sentraId,
    }));

  await prisma.$transaction(async (tx) => {
    await tx.sentraRotationSlot.deleteMany({ where: { rotationId: id } });
    if (rows.length > 0) await tx.sentraRotationSlot.createMany({ data: rows });
  });

  return NextResponse.json({ saved: rows.length });
}
