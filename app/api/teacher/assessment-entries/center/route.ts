import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { assessmentEntryCenterSessionSchema } from "@/lib/validations/assessment-entry";
import { parseJakartaYmd } from "@/lib/validations/curriculum";
import { getCurrentWeek, getStudentAgeGroups } from "@/lib/curriculum/week-resolver";
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
  const { center, date, activity, entries } = result.data;

  // Empty session — no rows to write. Audit the no-op so the activity feed
  // still records that a sentra teacher reviewed the roster + saved.
  if (entries.length === 0) {
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "AssessmentEntry",
      entityId: "bulk",
      action: "CENTER_SESSION",
      after: { center, date, activity, count: 0 },
    });
    return NextResponse.json(
      { written: 0, ids: [], reason: "empty_session" },
      { status: 200 },
    );
  }

  const dateUtc = parseJakartaYmd(date);

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
    select: {
      id: true,
      objective: { select: { ageGroup: true } },
      themeLinks: { select: { themeId: true } },
    },
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
  const objectiveGroupByIndicator = new Map(
    indicators.map((i) => [i.id, i.objective.ageGroup]),
  );

  // A sentra session can mix TK A and TK B children. Each student resolves
  // the week of their own kelompok, and an indicator must belong to that
  // kelompok's objectives.
  const groupByStudent = await getStudentAgeGroups(session.tenantId, studentIds);
  const weekByGroup = new Map<string, { id: string; themeId: string }>();
  for (const group of new Set(groupByStudent.values())) {
    const wk = await getCurrentWeek(session.tenantId, dateUtc, group);
    if (!wk) {
      return NextResponse.json(
        {
          error:
            "Belum ada Pekan aktif untuk tanggal yang dipilih. Pilih tanggal lain atau minta admin menambah pekan.",
        },
        { status: 422 },
      );
    }
    weekByGroup.set(group, { id: wk.id, themeId: wk.subTheme.theme.id });
  }
  if (studentIds.some((id) => !groupByStudent.has(id))) {
    return NextResponse.json(
      { error: "Siswa belum terdaftar di kelas aktif, kelompok tidak dapat ditentukan." },
      { status: 422 },
    );
  }
  const weekOf = (studentId: string) =>
    weekByGroup.get(groupByStudent.get(studentId)!)!;

  if (
    entries.some(
      (e) =>
        objectiveGroupByIndicator.get(e.indicatorId) !==
        groupByStudent.get(e.studentId),
    )
  ) {
    return NextResponse.json(
      { error: "Salah satu IKTP bukan untuk kelompok siswa." },
      { status: 400 },
    );
  }
  const linkBlocker = entries.find(
    (e) => !themesByIndicator.get(e.indicatorId)?.has(weekOf(e.studentId).themeId),
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
        weekId: weekOf(entry.studentId).id,
        source: "CENTER",
        center,
        activity,
        level: entry.level,
        note: entry.note ?? null,
        recordedById: session.employeeId!,
        recordedAt: now,
      },
      update: {
        weekId: weekOf(entry.studentId).id,
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
    after: { center, date, activity, count: written.length },
  });

  return NextResponse.json(
    { written: written.length, ids: written.map((w) => w.id) },
    { status: 200 },
  );
}
