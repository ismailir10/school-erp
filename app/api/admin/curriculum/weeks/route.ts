import { validateWeekSemester } from "@/lib/curriculum/week-dates";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { parsePagination, parseSort } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import {
  weekCreateSchema,
  parseJakartaYmd,
  findWeekOverlap,
} from "@/lib/validations/curriculum";
import { findScopedWeekOverlap, themeScopeLabel } from "@/lib/curriculum/age-scope";
import {
  CURRICULUM_WRITE_BUDGET,
  CURRICULUM_WRITE_WINDOW_MS,
  ensureActiveParent,
  isUniqueViolation,
  weekListSelect,
} from "../_helpers";

export async function GET(req: NextRequest) {
  const auth = await requirePermission("curriculum.read");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["number", "startDate", "endDate", "status", "createdAt"],
    default: "startDate",
    defaultOrder: "asc",
  });
  if (sort instanceof Response) return sort;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  const subThemeId = searchParams.get("subThemeId");
  if (subThemeId) where.subThemeId = subThemeId;
  const status = searchParams.get("status");
  if (status && status !== "all") where.status = status;

  const [data, total] = await Promise.all([
    prisma.week.findMany({ where, select: weekListSelect, orderBy: sort.orderBy, skip, take }),
    prisma.week.count({ where }),
  ]);
  return NextResponse.json(paginatedResponse(data, total, page, pageSize));
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission("curriculum.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { success } = rateLimit(
    `curriculum-week-create:${getClientIp(req)}`,
    CURRICULUM_WRITE_BUDGET,
    CURRICULUM_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const result = await validateBody(weekCreateSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  const parent = await ensureActiveParent("subTheme", body.subThemeId, session.tenantId, "Subtema");
  if (parent instanceof NextResponse) return parent;

  const dateError = await validateWeekSemester(body.subThemeId, session.tenantId, body.startDate, body.endDate);
  if (dateError) return NextResponse.json({ error: dateError, errors: [{ field: "endDate", message: dateError }] }, { status: 400 });

  // Overlap check against sibling ACTIVE Weeks in the same SubTheme.
  const siblings = await prisma.week.findMany({
    where: { tenantId: session.tenantId, subThemeId: body.subThemeId, status: "ACTIVE" },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  const overlap = findWeekOverlap(siblings, {
    startDate: body.startDate,
    endDate: body.endDate,
  });
  if (overlap) {
    return NextResponse.json(
      { error: "Pekan bertumpang tindih dengan pekan lain pada subtema ini.", conflictingWeekId: overlap.id },
      { status: 409 },
    );
  }

  // Cross-subtheme check: weeks of themes visible to the same kelompok must
  // not overlap. TK A vs TK B weeks may share dates.
  const scope = await prisma.subTheme.findFirst({
    where: { id: body.subThemeId, tenantId: session.tenantId },
    select: { theme: { select: { semesterId: true, ageGroup: true } } },
  });
  if (scope) {
    const scoped = await findScopedWeekOverlap({
      tenantId: session.tenantId,
      semesterId: scope.theme.semesterId,
      ageGroup: scope.theme.ageGroup,
      candidates: [{ startDate: body.startDate, endDate: body.endDate }],
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

  try {
    const created = await prisma.week.create({
      data: {
        tenantId: session.tenantId,
        subThemeId: body.subThemeId,
        number: body.number,
        startDate: parseJakartaYmd(body.startDate),
        endDate: parseJakartaYmd(body.endDate),
      },
      select: weekListSelect,
    });
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "Week",
      entityId: created.id,
      action: "create",
      after: { subThemeId: created.subThemeId, number: created.number },
    });
    return NextResponse.json(created, { status: 201 });
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
