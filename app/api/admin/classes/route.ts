import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { classCreateSchema } from "@/lib/validations/class";
import { ensureYearWritableById } from "@/lib/classes/year-guard";
import {
  CLASS_NAME_CLASH_MESSAGE,
  findClassNameClash,
} from "@/lib/classes/name-clash";
import { reconcileSessions } from "@/lib/sessions/reconcile";
import {
  attendanceLast7Days,
  computeHealthBadge,
  todaySessionState,
  type HealthBadge,
} from "@/lib/classes/health";
import {
  CLASS_WRITE_BUDGET,
  CLASS_WRITE_WINDOW_MS,
  classListSelect,
  ensureActiveParent,
  isUniqueViolation,
  rosterEnrollmentVisible,
} from "./_helpers";

const JAKARTA_TZ = "Asia/Jakarta";
const WEEKDAY_CODES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
type WeekdayCode = (typeof WEEKDAY_CODES)[number];

function todayInJakarta(): { ymd: string; weekday: WeekdayCode } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const wk = get("weekday").toUpperCase().slice(0, 3) as WeekdayCode;
  return { ymd, weekday: wk };
}

async function isWorkingDayInJakarta(
  tenantId: string,
  weekday: WeekdayCode,
): Promise<boolean> {
  const cfg = await prisma.orgConfig.findFirst({
    where: { tenantId },
    select: { workingDays: true },
  });
  if (!cfg?.workingDays) return true;
  try {
    const arr = JSON.parse(cfg.workingDays);
    if (!Array.isArray(arr)) return true;
    const set = new Set(arr.map((v) => String(v).trim().toUpperCase()));
    return set.has(weekday);
  } catch {
    return true;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission("academic.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["name", "status"],
    default: "name",
    defaultOrder: "asc",
  });
  if (sort instanceof Response) return sort;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  const yearId = searchParams.get("yearId");
  if (yearId && yearId !== "all") where.academicYearId = yearId;
  const status = searchParams.get("status");
  if (status && status !== "all") where.status = status;
  const campusId = searchParams.get("campusId");
  if (campusId && campusId !== "all") where.campusId = campusId;
  const programId = searchParams.get("programId");
  if (programId && programId !== "all") where.programId = programId;
  const q = escapeLike(cleanSearch(searchParams.get("q")));
  if (q) where.name = { contains: q, mode: "insensitive" };

  const [rows, total] = await Promise.all([
    prisma.classSection.findMany({
      where,
      select: classListSelect,
      orderBy: sort.orderBy,
      skip,
      take,
    }),
    prisma.classSection.count({ where }),
  ]);

  const sectionIds = rows.map((r) => r.id);
  const { ymd, weekday } = todayInJakarta();
  const workingDay = await isWorkingDayInJakarta(session.tenantId, weekday);
  const [attendance, sessions] = await Promise.all([
    attendanceLast7Days(prisma, sectionIds, ymd),
    todaySessionState(prisma, sectionIds, ymd, session.tenantId, workingDay),
  ]);

  const enriched = rows.map((row) => {
    const att = attendance.get(row.id);
    const ses = sessions.get(row.id);
    const { enrollments, ...rest } = row;
    // Year-aware count: current-year classes count ACTIVE only; past-year
    // classes count their GRADUATED cohort. WITHDRAWN already excluded by the
    // query. Prevents promoted-out students inflating a still-current roster.
    const enrolledCount = enrollments.filter((e) =>
      rosterEnrollmentVisible(e.status, row.academicYear.status),
    ).length;
    const badge: HealthBadge = computeHealthBadge({
      status: row.status,
      enrolledCount,
      capacity: row.capacity,
      attendance7dPct: att?.attendance7dPct ?? null,
      todaySession: ses?.state ?? (workingDay ? "Missing" : "Holiday"),
    });
    return {
      ...rest,
      enrolledCount,
      attendance7dPct: att?.attendance7dPct ?? null,
      todaySession: ses?.state ?? (workingDay ? "Missing" : "Holiday"),
      health: badge,
    };
  });

  return NextResponse.json(paginatedResponse(enriched, total, page, pageSize));
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { success } = rateLimit(
    `class-create:${getClientIp(req)}`,
    CLASS_WRITE_BUDGET,
    CLASS_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const result = await validateBody(classCreateSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  // FK guards — all three (campus, program, academicYear) must resolve to
  // tenant-scoped rows and the year must be writable (PLANNING or ACTIVE).
  const campus = await ensureActiveParent(
    "campus",
    body.campusId,
    session.tenantId,
    "Kampus",
  );
  if (campus instanceof NextResponse) return campus;
  const program = await ensureActiveParent(
    "program",
    body.programId,
    session.tenantId,
    "Program",
  );
  if (program instanceof NextResponse) return program;
  const yearGuard = await ensureYearWritableById(
    body.academicYearId,
    session.tenantId,
  );
  if (yearGuard instanceof NextResponse) return yearGuard;

  const sectionName = body.name.trim();

  // Class names are unique ignoring case — "TK A" and "tk a" are the same class.
  const clash = await findClassNameClash(prisma, {
    tenantId: session.tenantId,
    academicYearId: body.academicYearId,
    campusId: body.campusId,
    name: sectionName,
  });
  if (clash) {
    return NextResponse.json({ error: CLASS_NAME_CLASH_MESSAGE }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Find-or-create ClassTrack, matching the name ignoring case so "tk a"
      // reuses the existing "TK A" track; reactivate if INACTIVE.
      const existingTrack = await tx.classTrack.findFirst({
        where: {
          tenantId: session.tenantId,
          campusId: body.campusId,
          programId: body.programId,
          name: { equals: sectionName, mode: "insensitive" },
        },
        select: { id: true },
      });
      const track = existingTrack
        ? await tx.classTrack.update({
            where: { id: existingTrack.id },
            data: { status: "ACTIVE" },
          })
        : await tx.classTrack.create({
            data: {
              tenantId: session.tenantId,
              campusId: body.campusId,
              programId: body.programId,
              name: sectionName,
            },
          });
      const created = await tx.classSection.create({
        data: {
          tenantId: session.tenantId,
          classTrackId: track.id,
          programId: body.programId,
          academicYearId: body.academicYearId,
          campusId: body.campusId,
          name: sectionName,
          capacity: body.capacity,
          slotTemplate: body.slotTemplate,
          ageGroup: body.ageGroup,
        },
        select: classListSelect,
      });
      return created;
    });

    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "ClassSection",
      entityId: result.id,
      action: "class.create",
      after: {
        name: result.name,
        capacity: result.capacity,
        ageGroup: result.ageGroup,
        campusId: result.campusId,
        programId: result.programId,
        academicYearId: result.academicYearId,
      },
    });

    // Reconcile fires outside the txn — failure non-fatal, idempotent retry-safe.
    let reconcileWarning: string | undefined;
    try {
      await reconcileSessions(result.id);
    } catch (err) {
      console.error(
        `[classes POST] reconcileSessions failed for section ${result.id}:`,
        err,
      );
      reconcileWarning = "Sesi kelas akan dibuat ulang otomatis.";
    }

    return NextResponse.json(
      reconcileWarning ? { ...result, reconcileWarning } : result,
      { status: 201 },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: CLASS_NAME_CLASH_MESSAGE },
        { status: 409 },
      );
    }
    throw err;
  }
}
