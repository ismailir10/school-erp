import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { assessmentEntryBulkCreateSchema } from "@/lib/validations/assessment-entry";
import { parseJakartaYmd } from "@/lib/validations/curriculum";
import { getHomeroomClassSection } from "@/lib/curriculum/homeroom";
import { getCurrentWeek, getStudentAgeGroups } from "@/lib/curriculum/week-resolver";
import {
  PENILAIAN_WRITE_BUDGET,
  PENILAIAN_WRITE_WINDOW_MS,
} from "@/lib/api/rate-limit-budgets";

type Source = "HOMEROOM" | "CENTER";

function rejectMissingActiveYear() {
  return NextResponse.json(
    {
      error:
        "Tahun ajaran aktif belum diset. Hubungi admin untuk mengaktifkan tahun ajaran.",
    },
    { status: 422 },
  );
}

function rejectNoClass() {
  return NextResponse.json(
    { error: "Siswa belum terdaftar di kelas aktif, kelompok tidak dapat ditentukan." },
    { status: 422 },
  );
}

function rejectMissingWeek() {
  return NextResponse.json(
    {
      error:
        "Belum ada Pekan aktif untuk tanggal yang dipilih. Pilih tanggal lain atau minta admin menambah pekan.",
    },
    { status: 422 },
  );
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission("assessments.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { success } = rateLimit(
    `assessment-entries-create:${session.id}`,
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
      { error: "Akun tidak terhubung dengan staf — tidak dapat mencatat penilaian." },
      { status: 403 },
    );
  }

  const result = await validateBody(
    assessmentEntryBulkCreateSchema,
    await req.json(),
  );
  if (result.error) return result.error;
  const { entries } = result.data;

  const activeYear = await prisma.academicYear.findFirst({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!activeYear) return rejectMissingActiveYear();

  // For HOMEROOM entries we must verify the student is rostered into the
  // walas's ClassSection. Resolve the walas's section once up front; null
  // means "not a walas this year" — block any HOMEROOM entry in the bulk.
  const homeroomSection = await getHomeroomClassSection(
    session.tenantId,
    session.employeeId,
    activeYear.id,
  );

  const studentIds = Array.from(new Set(entries.map((e) => e.studentId)));
  const indicatorIds = Array.from(new Set(entries.map((e) => e.indicatorId)));

  // Tenant-scope all referenced students up front; reject the whole bulk if
  // any student isn't in the caller's tenant — never trust client IDs.
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

  // For HOMEROOM entries: every studentId must currently be ACTIVE-enrolled
  // in the walas's section. We query once for the union of HOMEROOM-source
  // student IDs and intersect.
  const homeroomStudentIds = Array.from(
    new Set(
      entries.filter((e) => e.source === "HOMEROOM").map((e) => e.studentId),
    ),
  );
  if (homeroomStudentIds.length > 0) {
    if (!homeroomSection) {
      return NextResponse.json(
        {
          error:
            "Akun ini bukan walas dari kelas manapun pada tahun ajaran aktif.",
        },
        { status: 403 },
      );
    }
    const enrolled = await prisma.studentEnrollment.findMany({
      where: {
        classSectionId: homeroomSection.id,
        studentId: { in: homeroomStudentIds },
        status: "ACTIVE",
      },
      select: { studentId: true },
    });
    if (enrolled.length !== homeroomStudentIds.length) {
      return NextResponse.json(
        { error: "Salah satu siswa tidak terdaftar di kelas walas Anda." },
        { status: 403 },
      );
    }
  }

  // Tenant-scope all indicators + load their theme links. We need the link
  // set per indicator to enforce the "indicator belongs to active week's
  // theme" check below.
  const indicators = await prisma.achievementIndicator.findMany({
    where: { tenantId: session.tenantId, id: { in: indicatorIds }, status: "ACTIVE", objective: { status: "ACTIVE", semester: { status: "ACTIVE" } } },
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
  const objectiveGroupByIndicator = new Map(
    indicators.map((i) => [i.id, i.objective.ageGroup]),
  );
  const themesByIndicator = new Map<string, Set<string>>(
    indicators.map((i) => [i.id, new Set(i.themeLinks.map((l) => l.themeId))]),
  );

  // Each student resolves the week of their own kelompok (TK A and TK B can
  // run different themes on the same dates). HOMEROOM entries are already
  // pinned to the walas's section; CENTER entries use the student's current
  // active class.
  const centerStudentIds = Array.from(
    new Set(entries.filter((e) => e.source !== "HOMEROOM").map((e) => e.studentId)),
  );
  const groupByStudent = await getStudentAgeGroups(
    session.tenantId,
    centerStudentIds,
  );
  const groupOf = (entry: (typeof entries)[number]) =>
    entry.source === "HOMEROOM"
      ? homeroomSection?.ageGroup
      : groupByStudent.get(entry.studentId);

  // Resolve weekId per distinct (date, kelompok) once and fail fast if any
  // pair doesn't bracket an active week.
  const weekByKey = new Map<string, { id: string; themeId: string }>();
  for (const entry of entries) {
    const group = groupOf(entry);
    if (!group) return rejectNoClass();
    const key = `${entry.date}|${group}`;
    if (weekByKey.has(key)) continue;
    const wk = await getCurrentWeek(
      session.tenantId,
      parseJakartaYmd(entry.date),
      group,
    );
    if (!wk) return rejectMissingWeek();
    weekByKey.set(key, { id: wk.id, themeId: wk.subTheme.theme.id });
  }

  const wrongGroup = entries.find(
    (e) => objectiveGroupByIndicator.get(e.indicatorId) !== groupOf(e),
  );
  if (wrongGroup) {
    return NextResponse.json(
      { error: "Salah satu IKTP bukan untuk kelompok siswa." },
      { status: 400 },
    );
  }

  // Last-write-wins upsert per entry on the design-locked unique
  // (tenantId, studentId, indicatorId, date, source). We do them in a
  // single $transaction so the audit row is consistent with the writes.
  const now = new Date();
  const writes = entries.map((entry) => {
    const week = weekByKey.get(`${entry.date}|${groupOf(entry)}`)!;
    const indicatorThemes = themesByIndicator.get(entry.indicatorId)!;
    if (!indicatorThemes.has(week.themeId)) {
      return { kind: "skip-not-linked" as const, entry };
    }
    return {
      kind: "upsert" as const,
      entry,
      weekId: week.id,
    };
  });

  const notLinked = writes.find((w) => w.kind === "skip-not-linked");
  if (notLinked) {
    return NextResponse.json(
      {
        error:
          "Salah satu IKTP belum terhubung ke tema pekan aktif. Minta admin menghubungkan IKTP ke tema.",
      },
      { status: 400 },
    );
  }

  const upsertOps = writes
    .filter((w): w is { kind: "upsert"; entry: typeof entries[number]; weekId: string } => w.kind === "upsert")
    .map((w) => {
      const { entry, weekId } = w;
      const dateUtc = parseJakartaYmd(entry.date);
      const source = entry.source as Source;
      return prisma.assessmentEntry.upsert({
        where: {
          tenantId_studentId_indicatorId_date_source: {
            tenantId: session.tenantId,
            studentId: entry.studentId,
            indicatorId: entry.indicatorId,
            date: dateUtc,
            source,
          },
        },
        create: {
          tenantId: session.tenantId,
          studentId: entry.studentId,
          indicatorId: entry.indicatorId,
          date: dateUtc,
          weekId,
          source,
          center: entry.center ?? null,
          activity: entry.activity ?? null,
          level: entry.level,
          note: entry.note ?? null,
          recordedById: session.employeeId!,
          recordedAt: now,
        },
        update: {
          weekId,
          activity: entry.activity ?? null,
          level: entry.level,
          note: entry.note ?? null,
          center: entry.center ?? null,
          recordedById: session.employeeId!,
          recordedAt: now,
        },
        select: { id: true },
      });
    });

  const written = await prisma.$transaction(upsertOps);

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "AssessmentEntry",
    entityId: written.length === 1 ? written[0].id : "bulk",
    action: "bulk-upsert",
    after: {
      count: written.length,
      sources: Array.from(new Set(entries.map((e) => e.source))),
    },
  });

  return NextResponse.json(
    { written: written.length, ids: written.map((w) => w.id) },
    { status: 200 },
  );
}
