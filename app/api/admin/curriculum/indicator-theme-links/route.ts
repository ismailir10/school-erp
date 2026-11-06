import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { indicatorThemeLinkToggleSchema } from "@/lib/validations/curriculum";
import { themeVisibleTo } from "@/lib/curriculum/age-scope";
import {
  CURRICULUM_WRITE_BUDGET,
  CURRICULUM_WRITE_WINDOW_MS,
} from "../_helpers";

/**
 * Idempotent toggle. Body `{ indicatorId, themeId, linked: boolean }`.
 *   linked: true  → upsert link (no-op if it already exists)
 *   linked: false → delete link (no-op if it already absent)
 *
 * Tenant boundary is inherited via the indicator + theme parents
 * (IndicatorThemeLink has no tenantId column by design — both parents
 * carry it, and we cross-check both belong to the caller's tenant).
 *
 * Cross-semester guard: an indicator can only be linked to a theme in
 * the same semester. Theme.semesterId must match indicator.objective.semesterId.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission("curriculum.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { success } = rateLimit(
    `curriculum-indicator-theme-link-toggle:${getClientIp(req)}`,
    CURRICULUM_WRITE_BUDGET,
    CURRICULUM_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const result = await validateBody(
    indicatorThemeLinkToggleSchema,
    await req.json(),
  );
  if (result.error) return result.error;
  const { indicatorId, themeId, linked } = result.data;

  // Cross-tenant + cross-semester guard. Both queries run in parallel.
  const [indicator, theme] = await Promise.all([
    prisma.achievementIndicator.findFirst({
      where: { id: indicatorId, tenantId: session.tenantId },
      select: { id: true, objective: { select: { semesterId: true, ageGroup: true } } },
    }),
    prisma.theme.findFirst({
      where: { id: themeId, tenantId: session.tenantId },
      select: { id: true, semesterId: true, ageGroup: true },
    }),
  ]);
  if (!indicator) {
    return NextResponse.json(
      { error: "Indikator tidak ditemukan" },
      { status: 404 },
    );
  }
  if (!theme) {
    return NextResponse.json(
      { error: "Tema tidak ditemukan" },
      { status: 404 },
    );
  }
  if (indicator.objective.semesterId !== theme.semesterId) {
    return NextResponse.json(
      {
        error:
          "Indikator dan tema harus berada di semester yang sama.",
      },
      { status: 422 },
    );
  }

  if (linked && !themeVisibleTo(theme.ageGroup, indicator.objective.ageGroup)) {
    return NextResponse.json(
      {
        error: `Indikator ${indicator.objective.ageGroup === "A" ? "TK A" : "TK B"} hanya bisa dihubungkan ke tema ${indicator.objective.ageGroup === "A" ? "TK A" : "TK B"} atau Semua kelompok.`,
      },
      { status: 422 },
    );
  }

  if (linked) {
    // Upsert: idempotent. Repeat call with same (indicatorId, themeId)
    // is a no-op write thanks to the composite primary key.
    await prisma.indicatorThemeLink.upsert({
      where: { indicatorId_themeId: { indicatorId, themeId } },
      create: { indicatorId, themeId },
      update: {},
    });
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "IndicatorThemeLink",
      entityId: `${indicatorId}:${themeId}`,
      action: "link",
      after: { indicatorId, themeId },
    });
    return NextResponse.json({ linked: true }, { status: 200 });
  }

  // Unlink: idempotent — deleteMany on the composite is a no-op when the
  // row is already absent (returns count 0; no exception).
  await prisma.indicatorThemeLink.deleteMany({
    where: { indicatorId, themeId },
  });
  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "IndicatorThemeLink",
    entityId: `${indicatorId}:${themeId}`,
    action: "unlink",
    before: { indicatorId, themeId },
  });
  return NextResponse.json({ linked: false }, { status: 200 });
}
