import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { themeUpdateSchema } from "@/lib/validations/curriculum";
import {
  findScopedWeekOverlap,
  themeScopeLabel,
  themeVisibleTo,
  AGE_GROUP_LABEL,
} from "@/lib/curriculum/age-scope";
import { auditActionForUpdate, CURRICULUM_WRITE_BUDGET, CURRICULUM_WRITE_WINDOW_MS, isUniqueViolation, themeListSelect } from "../../_helpers";


export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("curriculum.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const { success } = rateLimit(
    `curriculum-theme-update:${getClientIp(req)}`,
    CURRICULUM_WRITE_BUDGET,
    CURRICULUM_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const before = await prisma.theme.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, semesterId: true, name: true, ageGroup: true, order: true, status: true },
  });
  if (!before) {
    return NextResponse.json({ error: "Tema tidak ditemukan" }, { status: 404 });
  }

  const result = await validateBody(themeUpdateSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.order !== undefined) data.order = body.order;
  if (body.status !== undefined) data.status = body.status;
  if (body.ageGroup !== undefined) data.ageGroup = body.ageGroup;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Tidak ada perubahan" }, { status: 400 });
  }

  const newName: string = data.name ?? before.name;
  const newScope = body.ageGroup !== undefined ? body.ageGroup : before.ageGroup;
  const nameChanged = data.name !== undefined && data.name !== before.name;
  const scopeChanged = body.ageGroup !== undefined && body.ageGroup !== before.ageGroup;

  if (nameChanged || scopeChanged) {
    const duplicate = await prisma.theme.findFirst({
      where: {
        tenantId: session.tenantId,
        semesterId: before.semesterId,
        name: newName,
        ageGroup: newScope,
        id: { not: id },
      },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: `Tema "${newName}" sudah ada untuk ${themeScopeLabel(newScope)}.` },
        { status: 409 },
      );
    }
  }

  if (scopeChanged) {
    const refusal = await checkScopeChange({
      tenantId: session.tenantId,
      themeId: id,
      semesterId: before.semesterId,
      newScope,
    });
    if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });
  }

  try {
    const updated = await prisma.theme.update({
      where: { id },
      data,
      select: themeListSelect,
    });
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "Theme",
      entityId: id,
      action: auditActionForUpdate(body),
      before: { name: before.name, ageGroup: before.ageGroup, order: before.order, status: before.status },
      after: { name: updated.name, ageGroup: updated.ageGroup, order: updated.order, status: updated.status },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "Tema dengan nama tersebut sudah ada di semester ini." },
        { status: 409 },
      );
    }
    throw err;
  }
}

/**
 * Re-scoping a theme must not strand existing data: linked indicators and
 * recorded assessments must still be visible under the new scope, and the
 * theme's weeks must not collide with weeks of a theme now seen by the same
 * kelompok. Returns an Indonesian refusal message, or null when safe.
 */
async function checkScopeChange(params: {
  tenantId: string;
  themeId: string;
  semesterId: string;
  newScope: "A" | "B" | null;
}): Promise<string | null> {
  const { tenantId, themeId, semesterId, newScope } = params;

  if (newScope !== null) {
    const link = await prisma.indicatorThemeLink.findFirst({
      where: { themeId, indicator: { objective: { ageGroup: { not: newScope } } } },
      select: { indicator: { select: { objective: { select: { ageGroup: true } } } } },
    });
    if (link && !themeVisibleTo(newScope, link.indicator.objective.ageGroup)) {
      return `Kelompok tidak bisa diubah: tema ini sudah terhubung dengan indikator ${AGE_GROUP_LABEL[link.indicator.objective.ageGroup]}.`;
    }

    const entry = await prisma.assessmentEntry.findFirst({
      where: {
        tenantId,
        voidedAt: null,
        week: { subTheme: { themeId } },
        indicator: { objective: { ageGroup: { not: newScope } } },
      },
      select: { indicator: { select: { objective: { select: { ageGroup: true } } } } },
    });
    if (entry && !themeVisibleTo(newScope, entry.indicator.objective.ageGroup)) {
      return `Kelompok tidak bisa diubah: sudah ada penilaian ${AGE_GROUP_LABEL[entry.indicator.objective.ageGroup]} pada pekan tema ini.`;
    }
  }

  const weeks = await prisma.week.findMany({
    where: { tenantId, status: "ACTIVE", subTheme: { themeId, status: "ACTIVE" } },
    select: { id: true, startDate: true, endDate: true },
  });
  const overlap = await findScopedWeekOverlap({
    tenantId,
    semesterId,
    ageGroup: newScope,
    candidates: weeks,
    excludeThemeId: themeId,
  });
  if (overlap) {
    return `Kelompok tidak bisa diubah: pekan tema ini bertumpang tindih dengan pekan lain di ${themeScopeLabel(newScope)}.`;
  }
  return null;
}
