import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { assessmentEntryCenterSessionSchema } from "@/lib/validations/assessment-entry";
import { parseJakartaYmd } from "@/lib/validations/curriculum";
import { getCurrentWeek } from "@/lib/curriculum/week-resolver";
import {
  PENILAIAN_WRITE_BUDGET,
  PENILAIAN_WRITE_WINDOW_MS,
} from "@/lib/api/rate-limit-budgets";

export async function POST(req: NextRequest) {
  const auth = await requirePermission("assessments.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { success } = rateLimit(
    `assessment-entries-center:${session.id}`,
    PENILAIAN_WRITE_BUDGET,
    PENILAIAN_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  if (!session.employeeId) {
    return NextResponse.json(
      {
        error:
          "Akun tidak terhubung dengan staf — tidak dapat mencatat penilaian.",
      },
      { status: 403 },
    );
  }

  const result = await validateBody(
    assessmentEntryCenterSessionSchema,
    await req.json(),
  );
  if (result.error) return result.error;
  const { sentraId, date, activity, entries } = result.data;

  // The sentra must be this tenant's (404 otherwise, never revealing another
  // tenant's row) and still ACTIVE (400: deactivated sentra take no new entries).
  // It must also sit on the teacher's own campus (foreign campus reads as 404).
  const employee = await prisma.employee.findFirst({
    where: { id: session.employeeId, tenantId: session.tenantId },
    select: { campusId: true },
  });
  const sentra = employee?.campusId
    ? await prisma.sentra.findFirst({
        where: {
          id: sentraId,
          tenantId: session.tenantId,
          campusId: employee.campusId,
        },
        select: { id: true, status: true, legacyCenter: true },
      })
    : null;
  if (!sentra) {
    return NextResponse.json({ error: "Sentra tidak ditemukan." }, { status: 404 });
  }
  if (sentra.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Sentra ini sudah tidak aktif. Pilih sentra lain." },
      { status: 400 },
    );
  }
  const center = sentra.legacyCenter;

  // Empty session — no rows to write. Audit the no-op so the activity feed
  // still records that a sentra teacher reviewed the roster + saved.
  if (entries.length === 0) {
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "AssessmentEntry",
      entityId: "bulk",
      action: "CENTER_SESSION",
      after: { sentraId, center, date, activity, count: 0 },
    });
    return NextResponse.json(
      { written: 0, ids: [], reason: "empty_session" },
      { status: 200 },
    );
  }

  const dateUtc = parseJakartaYmd(date);
  const week = await getCurrentWeek(session.tenantId, dateUtc);
  if (!week) {
    return NextResponse.json(
      {
        error:
          "Belum ada Pekan aktif untuk tanggal yang dipilih. Pilih tanggal lain atau minta admin menambah pekan.",
      },
      { status: 422 },
    );
  }

  const studentIds = Array.from(new Set(entries.map((e) => e.studentId)));
  const indicatorIds = Array.from(new Set(entries.map((e) => e.indicatorId)));

  // Tenant-scope all referenced students. Sentra writes don't need a
  // walas/section check (per design §3.2 — any TEACHER may write CENTER
  // entries), but the tenant boundary still applies.
  const tenantStudents = await prisma.student.findMany({
    where: { tenantId: session.tenantId, id: { in: studentIds } },
    select: { id: true },
  });
  if (tenantStudents.length !== studentIds.length) {
    return NextResponse.json(
      { error: "Salah satu siswa tidak ditemukan pada tenant ini." },
      { status: 403 },
    );
  }

  // Tenant-scope all indicators + load theme links to enforce the
  // "indicator linked to active week's theme" gate. Same rule as the
  // walas weekly POST (C4) — keeps sentra writes honest against the
  // PROMES spine.
  const indicators = await prisma.achievementIndicator.findMany({
    where: { tenantId: session.tenantId, id: { in: indicatorIds } },
    select: { id: true, themeLinks: { select: { themeId: true } } },
  });
  if (indicators.length !== indicatorIds.length) {
    return NextResponse.json(
      { error: "Salah satu IKTP tidak ditemukan pada tenant ini." },
      { status: 403 },
    );
  }
  const themesByIndicator = new Map<string, Set<string>>(
    indicators.map((i) => [i.id, new Set(i.themeLinks.map((l) => l.themeId))]),
  );
  const linkBlocker = entries.find(
    (e) => !themesByIndicator.get(e.indicatorId)?.has(week.subTheme.theme.id),
  );
  if (linkBlocker) {
    return NextResponse.json(
      {
        error:
          "Salah satu IKTP belum terhubung ke tema pekan aktif. Minta admin menghubungkan IKTP ke tema.",
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const upserts = entries.map((entry) =>
    prisma.assessmentEntry.upsert({
      where: {
        tenantId_studentId_indicatorId_date_source: {
          tenantId: session.tenantId,
          studentId: entry.studentId,
          indicatorId: entry.indicatorId,
          date: dateUtc,
          source: "CENTER",
        },
      },
      create: {
        tenantId: session.tenantId,
        studentId: entry.studentId,
        indicatorId: entry.indicatorId,
        date: dateUtc,
        weekId: week.id,
        source: "CENTER",
        sentraId,
        center,
        activity,
        level: entry.level,
        note: entry.note ?? null,
        recordedById: session.employeeId!,
        recordedAt: now,
      },
      update: {
        weekId: week.id,
        sentraId,
        center,
        activity,
        level: entry.level,
        note: entry.note ?? null,
        recordedById: session.employeeId!,
        recordedAt: now,
      },
      select: { id: true },
    }),
  );
  const written = await prisma.$transaction(upserts);

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "AssessmentEntry",
    entityId: written.length === 1 ? written[0].id : "bulk",
    action: "CENTER_SESSION",
    after: { sentraId, center, date, activity, count: written.length },
  });

  return NextResponse.json(
    { written: written.length, ids: written.map((w) => w.id) },
    { status: 200 },
  );
}
