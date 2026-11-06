import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { parsePagination, parseSort } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { themeCreateSchema } from "@/lib/validations/curriculum";
import { themeScopeLabel, themesVisibleTo } from "@/lib/curriculum/age-scope";
import {
  CURRICULUM_WRITE_BUDGET,
  CURRICULUM_WRITE_WINDOW_MS,
  ensureActiveParent,
  isUniqueViolation,
  themeListSelect,
} from "../_helpers";


export async function GET(req: NextRequest) {
  const auth = await requirePermission("curriculum.read");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["order", "name", "status", "createdAt"],
    default: "order",
    defaultOrder: "asc",
  });
  if (sort instanceof Response) return sort;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  const semesterId = searchParams.get("semesterId");
  if (semesterId) where.semesterId = semesterId;
  const status = searchParams.get("status");
  if (status && status !== "all") where.status = status;
  const ageGroupParam = searchParams.get("ageGroup");
  if (ageGroupParam) {
    if (ageGroupParam === "A" || ageGroupParam === "B") {
      Object.assign(where, themesVisibleTo(ageGroupParam));
    } else if (ageGroupParam === "shared") {
      where.ageGroup = null;
    } else {
      return NextResponse.json(
        { error: "ageGroup harus salah satu dari: A, B, shared." },
        { status: 400 },
      );
    }
  }

  const [data, total] = await Promise.all([
    prisma.theme.findMany({ where, select: themeListSelect, orderBy: sort.orderBy, skip, take }),
    prisma.theme.count({ where }),
  ]);
  return NextResponse.json(paginatedResponse(data, total, page, pageSize));
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission("curriculum.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { success } = rateLimit(
    `curriculum-theme-create:${getClientIp(req)}`,
    CURRICULUM_WRITE_BUDGET,
    CURRICULUM_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const result = await validateBody(themeCreateSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  const parent = await ensureActiveParent("semester", body.semesterId, session.tenantId, "Semester");
  if (parent instanceof NextResponse) return parent;

  const name = body.name.trim();
  const ageGroup = body.ageGroup ?? null;
  const duplicate = await prisma.theme.findFirst({
    where: { tenantId: session.tenantId, semesterId: body.semesterId, name, ageGroup },
    select: { id: true },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: `Tema "${name}" sudah ada untuk ${themeScopeLabel(ageGroup)}.` },
      { status: 409 },
    );
  }

  try {
    const created = await prisma.theme.create({
      data: {
        tenantId: session.tenantId,
        semesterId: body.semesterId,
        name,
        ageGroup,
        order: body.order,
      },
      select: themeListSelect,
    });
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "Theme",
      entityId: created.id,
      action: "create",
      after: { semesterId: created.semesterId, name: created.name, ageGroup: created.ageGroup, order: created.order },
    });
    return NextResponse.json(created, { status: 201 });
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
