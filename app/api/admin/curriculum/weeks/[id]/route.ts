import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  weekUpdateSchema,
  parseJakartaYmd,
  findWeekOverlap,
  formatJakartaYmd,
} from "@/lib/validations/curriculum";
import { findScopedWeekOverlap, themeScopeLabel } from "@/lib/curriculum/age-scope";
import { auditActionForUpdate, CURRICULUM_WRITE_BUDGET, CURRICULUM_WRITE_WINDOW_MS, isUniqueViolation, weekListSelect } from "../../_helpers";

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("curriculum.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const { success } = rateLimit(
    `curriculum-week-update:${getClientIp(req)}`,
    CURRICULUM_WRITE_BUDGET,
    CURRICULUM_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const before = await prisma.week.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, subThemeId: true, number: true, startDate: true, endDate: true, status: true },
  });
  if (!before) {
    return NextResponse.json({ error: "Pekan tidak ditemukan" }, { status: 404 });
  }

  const result = await validateBody(weekUpdateSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (body.number !== undefined) data.number = body.number;
  if (body.startDate !== undefined) data.startDate = parseJakartaYmd(body.startDate);
  if (body.endDate !== undefined) data.endDate = parseJakartaYmd(body.endDate);
  if (body.status !== undefined) data.status = body.status;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Tidak ada perubahan" }, { status: 400 });
  }

  // Cross-field date check after merge.
  const finalStart: Date = data.startDate ?? before.startDate;
  const finalEnd: Date = data.endDate ?? before.endDate;
  if (finalStart >= finalEnd) {
    return NextResponse.json(
      { error: "Tanggal mulai harus sebelum tanggal selesai", errors: [{ field: "endDate", message: "Tanggal mulai harus sebelum tanggal selesai" }] },
      { status: 400 },
    );
  }

  // Overlap check only if the row is (still) ACTIVE after the update — a row
  // being deactivated cannot conflict with anything.
  const willBeActive = (data.status ?? before.status) === "ACTIVE";
  if (willBeActive) {
    const siblings = await prisma.week.findMany({
      where: { tenantId: session.tenantId, subThemeId: before.subThemeId, status: "ACTIVE" },
      select: { id: true, startDate: true, endDate: true, status: true },
    });
    const overlap = findWeekOverlap(siblings, {
      id,
      startDate: formatJakartaYmd(finalStart),
      endDate: formatJakartaYmd(finalEnd),
    });
    if (overlap) {
      return NextResponse.json(
        { error: "Pekan bertumpang tindih dengan pekan lain pada subtema ini.", conflictingWeekId: overlap.id },
        { status: 409 },
      );
    }

    // Cross-subtheme check within the theme's kelompok scope (also covers a
    // PUT that reactivates an INACTIVE week).
    const scope = await prisma.subTheme.findFirst({
      where: { id: before.subThemeId, tenantId: session.tenantId },
      select: { theme: { select: { semesterId: true, ageGroup: true } } },
    });
    if (scope) {
      const scoped = await findScopedWeekOverlap({
        tenantId: session.tenantId,
        semesterId: scope.theme.semesterId,
        ageGroup: scope.theme.ageGroup,
        candidates: [
          { id, startDate: formatJakartaYmd(finalStart), endDate: formatJakartaYmd(finalEnd) },
        ],
        excludeWeekIds: [id],
      });
      if (scoped) {
        return NextResponse.json(
          {
            error: `Pekan bertumpang tindih dengan pekan lain di ${themeScopeLabel(scope.theme.ageGroup)}.`,
            conflictingWeekId: scoped.id,
          },
          { status: 409 },
        );
      }
    }
  }

  try {
    const updated = await prisma.week.update({
      where: { id },
      data,
      select: weekListSelect,
    });
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "Week",
      entityId: id,
      action: auditActionForUpdate(body),
      before: {
        number: before.number,
        startDate: before.startDate.toISOString(),
        endDate: before.endDate.toISOString(),
        status: before.status,
      },
      after: {
        number: updated.number,
        startDate: updated.startDate.toISOString(),
        endDate: updated.endDate.toISOString(),
        status: updated.status,
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "Nomor pekan ini sudah dipakai pada subtema tersebut." },
        { status: 409 },
      );
    }
    throw err;
  }
}
