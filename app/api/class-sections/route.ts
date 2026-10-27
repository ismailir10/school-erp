import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { createClassSectionSchema } from "@/lib/validations/class-section";
import { reconcileSessions } from "@/lib/sessions/reconcile";
import { BILLABLE_FEE_COMPONENT_WHERE } from "@/lib/finance/billable-fees";
import { hasPermission } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json([], { status: 401 });
  // HR-16: capacity / enrollment counts are read by admin screens only; the
  // teacher and parent portals use their own scoped /api/teacher and
  // /api/parent endpoints.
  if (!isAdminRole(session.role)) return NextResponse.json([], { status: 403 });

  const { searchParams } = new URL(req.url);
  const programId = searchParams.get("programId");
  const academicYearId = searchParams.get("academicYearId");
  const yearStatusParam = searchParams.get("yearStatus");

  const where: Record<string, unknown> = { tenantId: session.tenantId };
  if (programId) where.programId = programId;
  if (academicYearId) where.academicYearId = academicYearId;

  // yearStatus is an opt-in comma-separated allowlist of AcademicYear.status
  // values (PLANNING | ACTIVE | ARCHIVED). Unknown/garbage tokens are dropped
  // rather than rejected with a 400: callers building the class picker send
  // this straight from UI toggles, and a stray/misspelled token should degrade
  // to "no filter" (today's behaviour) rather than break the request. If every
  // token is invalid the param is treated as fully absent, preserving
  // byte-identical output for the four existing no-param callers.
  const VALID_YEAR_STATUSES = new Set(["PLANNING", "ACTIVE", "ARCHIVED"]);
  const yearStatuses = (yearStatusParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_YEAR_STATUSES.has(s));
  if (yearStatuses.length > 0) {
    where.academicYear = { status: { in: yearStatuses } };
  }

  const sections = await prisma.classSection.findMany({
    where,
    include: {
      program: { select: { name: true, code: true } },
      academicYear: { select: { id: true, name: true, status: true } },
      campus: { select: { name: true } },
      // Seat count = ACTIVE enrolments only; a WITHDRAWN row must not make a
      // class look fuller than /admin/classes (which counts the roster).
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
    orderBy: { name: "asc" },
  });

  // Opt-in: what a billing run would bill per period for each section's own
  // program in its own year (`null` = no billable fee line at all). The
  // billing wizard shows it next to each class so a class linked to the wrong
  // program is visible before invoices are made. Other callers omit it and
  // get the response unchanged.
  // A role without a finance permission gets the plain list: the key is left
  // out rather than nulled, because `null` already means "no fee line".
  if (
    searchParams.get("include") !== "fees" ||
    !(hasPermission(session, "fees.view") || hasPermission(session, "invoices.view"))
  ) {
    return NextResponse.json(sections);
  }

  const structures = await prisma.programFeeStructure.findMany({
    where: {
      tenantId: session.tenantId,
      programId: { in: [...new Set(sections.map((s) => s.programId))] },
      academicYearId: { in: [...new Set(sections.map((s) => s.academicYearId))] },
      feeComponent: BILLABLE_FEE_COMPONENT_WHERE,
    },
    select: { programId: true, academicYearId: true, amount: true },
  });
  const totals = new Map<string, number>();
  for (const f of structures) {
    const key = `${f.programId}|${f.academicYearId}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(f.amount));
  }
  return NextResponse.json(
    sections.map((s) => ({
      ...s,
      recurringFeeTotal: totals.get(`${s.programId}|${s.academicYearId}`) ?? null,
    })),
  );
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success } = rateLimit(`create-class-section:${getClientIp(req)}`, 20, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const parsed = createClassSectionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Block writes targeting INACTIVE/cross-tenant campus — see Campus DELETE guard.
  const activeCampus = await prisma.campus.findFirst({
    where: { id: body.campusId, tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!activeCampus) {
    return NextResponse.json(
      { error: "Kampus tidak ditemukan atau nonaktif." },
      { status: 400 },
    );
  }

  // Block writes targeting a cross-tenant program — body.programId is written
  // directly into ClassTrack + ClassSection below, so it must belong to the
  // caller's tenant.
  const tenantProgram = await prisma.program.findFirst({
    where: { id: body.programId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!tenantProgram) {
    return NextResponse.json(
      { error: "Program tidak ditemukan." },
      { status: 400 },
    );
  }

  // Every ClassSection belongs to a stable multi-year ClassTrack
  // (cycle 2026-05-15 academic-hierarchy-refactor). Resolve-or-create
  // the track for this (campus, program, name) tuple — ClassTrack is now
  // silent plumbing (its dedicated CRUD UI was retired in the kelas-page
  // cycle); a section created without a pre-existing track still needs one.
  const sectionName = body.name.trim();
  const classTrack = await prisma.classTrack.upsert({
    where: {
      tenantId_campusId_programId_name: {
        tenantId: session.tenantId,
        campusId: body.campusId,
        programId: body.programId,
        name: sectionName,
      },
    },
    update: {},
    create: {
      tenantId: session.tenantId,
      campusId: body.campusId,
      programId: body.programId,
      name: sectionName,
    },
  });

  const section = await prisma.classSection.create({
    data: {
      tenantId: session.tenantId,
      classTrackId: classTrack.id,
      programId: body.programId,
      academicYearId: body.academicYearId,
      name: sectionName,
      ageGroup: body.ageGroup,
      capacity: body.capacity,
      campusId: body.campusId,
    },
  });

  // Reactive session generation — the new section's ClassSession rows are
  // generated now, not via an admin "Generate" button. The create above has
  // already committed and is independently valid; if reconcile throws we log
  // it and still return 201 — reconcile is idempotent and re-runnable, and a
  // session fan-out failure must not roll back a legitimate section create.
  let reconcileWarning: string | undefined;
  try {
    await reconcileSessions(section.id);
  } catch (err) {
    console.error(
      `[class-sections POST] reconcileSessions failed for section ${section.id}:`,
      err,
    );
    reconcileWarning = "Sesi kelas akan dibuat ulang otomatis.";
  }

  revalidatePath("/api/class-sections");
  return NextResponse.json(
    reconcileWarning ? { ...section, reconcileWarning } : section,
    { status: 201 },
  );
}
