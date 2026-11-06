import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rotationSlotsSchema } from "@/lib/validations/sentra";
import { badRequest, limitWrites, lockRotation, notFound } from "../../../_helpers";

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

  const parsed = await validateBody(rotationSlotsSchema, await req.json());
  if (parsed.error) return parsed.error;
  const { slots } = parsed.data;
  const { tenantId } = session;

  const rows = slots
    .filter((s): s is typeof s & { sentraId: string } => s.sentraId !== null)
    .map((s) => ({
      tenantId,
      rotationId: id,
      dayIndex: s.dayIndex,
      classSectionId: s.classSectionId,
      sentraId: s.sentraId,
    }));
  const sentraIds = [...new Set(rows.map((row) => row.sentraId))];

  return prisma.$transaction(async (tx) => {
    const rotation = await lockRotation(tx, id, tenantId);
    if (!rotation) return notFound("Putaran");

    const rotationClasses = await tx.sentraRotationClass.findMany({
      where: { rotationId: id, tenantId },
      select: { classSectionId: true },
    });
    const classIds = new Set(rotationClasses.map((c) => c.classSectionId));
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

    if (sentraIds.length > 0) {
      const valid = await tx.sentra.findMany({
        where: {
          id: { in: sentraIds },
          tenantId,
          campusId: rotation.campusId,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (valid.length !== sentraIds.length) {
        return badRequest("Sentra harus aktif dan berada di kampus putaran ini.");
      }
    }

    await tx.sentraRotationSlot.deleteMany({ where: { rotationId: id, tenantId } });
    if (rows.length > 0) await tx.sentraRotationSlot.createMany({ data: rows });
    return NextResponse.json({ saved: rows.length });
  }, { isolationLevel: "ReadCommitted" });
}
