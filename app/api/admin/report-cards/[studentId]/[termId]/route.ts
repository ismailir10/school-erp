import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { raportUpsertSchema } from "@/lib/validations/raport";
import { loadRaportDraft } from "@/lib/curriculum/raport-aggregator";
import {
  RAPORT_WRITE_BUDGET,
  RAPORT_WRITE_WINDOW_MS,
  reportCardEntrySelect,
  resolveTerm,
} from "../../_helpers";
import { loadTemplateGrid } from "../../templates/_shared";

type Ctx = { params: Promise<{ studentId: string; termId: string }> };

async function loadStudent(tenantId: string, studentId: string) {
  return prisma.student.findFirst({
    where: { id: studentId, tenantId },
    select: { id: true, name: true, nickname: true },
  });
}

/**
 * Which bank narasi cohort this student belongs to. Read off the active
 * enrolment's class section (`ageGroup` is NOT NULL since the 2026-05-20
 * cycle). Null when the student has no active enrolment — the editor then
 * simply offers no templates rather than guessing a cohort.
 */
async function resolveAgeGroup(
  tenantId: string,
  studentId: string,
): Promise<"A" | "B" | null> {
  const enrolment = await prisma.studentEnrollment.findFirst({
    where: { studentId, status: "ACTIVE", classSection: { tenantId } },
    select: { classSection: { select: { ageGroup: true } } },
    orderBy: { createdAt: "desc" },
  });
  return (enrolment?.classSection.ageGroup as "A" | "B" | undefined) ?? null;
}

/**
 * GET /api/admin/report-cards/[studentId]/[termId]
 *
 * Returns the saved report card (if any) PLUS the always-computed auto-draft
 * (suggested section levels + counts + auto-pulled attendance) so the UI can
 * pre-fill a new raport and show the "saran penilaian" hint on a saved one.
 * Gated by `reportCard.read`. Tenant-scoped.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await requirePermission("reportCard.read");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { studentId, termId } = await ctx.params;

  const [term, student] = await Promise.all([
    resolveTerm(session.tenantId, termId),
    loadStudent(session.tenantId, studentId),
  ]);
  if (!term) return NextResponse.json({ error: "Triwulan tidak ditemukan." }, { status: 404 });
  if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan." }, { status: 404 });

  const [saved, measurement, draft, ageGroup] = await Promise.all([
    prisma.reportCardEntry.findFirst({
      where: { tenantId: session.tenantId, studentId, termId, deletedAt: null },
      select: reportCardEntrySelect,
    }),
    prisma.studentMeasurement.findFirst({
      where: { tenantId: session.tenantId, studentId, termId, deletedAt: null },
      select: { heightCm: true, weightKg: true },
    }),
    loadRaportDraft(session.tenantId, studentId, term),
    resolveAgeGroup(session.tenantId, studentId),
  ]);

  // Bank narasi for this student's cohort, so the editor can pre-fill empty
  // narratives instead of handing the admin 8 blank textareas per child.
  const templates = ageGroup
    ? await loadTemplateGrid(session.tenantId, termId, ageGroup)
    : null;

  return NextResponse.json({
    data: {
      canWrite: hasPermission(session, "reportCard.write"),
      canPublish: hasPermission(session, "reportCard.publish"),
      student,
      term: {
        id: term.id,
        number: term.number,
        semesterNumber: term.semester.number,
        academicYear: term.semester.academicYear.name,
      },
      ageGroup,
      templates,
      saved,
      measurement,
      draft,
    },
  });
}

/**
 * PUT /api/admin/report-cards/[studentId]/[termId]
 *
 * Upsert the admin's report card (section levels + narratives + attendance +
 * hafalan + measurements). Does NOT change publish state (separate endpoint).
 * Gated by `reportCard.write`. Tenant-scoped + audited.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requirePermission("reportCard.write");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { studentId, termId } = await ctx.params;

  const { success } = rateLimit(
    `raport-upsert:${getClientIp(req)}`,
    RAPORT_WRITE_BUDGET,
    RAPORT_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const [term, student] = await Promise.all([
    resolveTerm(session.tenantId, termId),
    loadStudent(session.tenantId, studentId),
  ]);
  if (!term) return NextResponse.json({ error: "Triwulan tidak ditemukan." }, { status: 404 });
  if (!student) return NextResponse.json({ error: "Siswa tidak ditemukan." }, { status: 404 });

  const result = await validateBody(raportUpsertSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  const tenantId = session.tenantId;
  const { heightCm, weightKg, expectedUpdatedAt, ...entryFields } = body;

  // JSON column: distinguish omitted (undefined → skip) from explicit clear
  // (null → SQL NULL via Prisma.DbNull) so a wired parentMeetingAttendance
  // can be cleared, not just set. Mirrors the measurement key-presence guard.
  const pma =
    entryFields.parentMeetingAttendance === undefined
      ? undefined
      : entryFields.parentMeetingAttendance === null
        ? Prisma.DbNull
        : entryFields.parentMeetingAttendance;

  let saved;
  try {
  saved = await prisma.$transaction(async (tx) => {
    const entry = await tx.reportCardEntry.upsert({
      where: { tenantId_studentId_termId: { tenantId, studentId, termId }, updatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : new Date(0) },
      create: {
        tenantId,
        studentId,
        termId,
        homeroomTeacherId: entryFields.homeroomTeacherId ?? null,
        sectionLevels: entryFields.sectionLevels,
        sectionNarratives: entryFields.sectionNarratives,
        permittedAbsenceDays: entryFields.permittedAbsenceDays,
        sickDays: entryFields.sickDays,
        unexcusedAbsenceDays: entryFields.unexcusedAbsenceDays,
        totalSchoolDays: entryFields.totalSchoolDays,
        parentMeetingAttendance: pma,
        memorizationNotes: entryFields.memorizationNotes ?? null,
      },
      update: {
        homeroomTeacherId: entryFields.homeroomTeacherId ?? null,
        sectionLevels: entryFields.sectionLevels,
        sectionNarratives: entryFields.sectionNarratives,
        permittedAbsenceDays: entryFields.permittedAbsenceDays,
        sickDays: entryFields.sickDays,
        unexcusedAbsenceDays: entryFields.unexcusedAbsenceDays,
        totalSchoolDays: entryFields.totalSchoolDays,
        parentMeetingAttendance: pma,
        memorizationNotes: entryFields.memorizationNotes ?? null,
      },
      select: reportCardEntrySelect,
    });

    // Upsert when either key is present in the payload (undefined = omitted,
    // null = explicit clear) so a saved measurement can be cleared, not just set.
    if (heightCm !== undefined || weightKg !== undefined) {
      await tx.studentMeasurement.upsert({
        where: { tenantId_studentId_termId: { tenantId, studentId, termId } },
        create: { tenantId, studentId, termId, heightCm: heightCm ?? null, weightKg: weightKg ?? null },
        update: { heightCm: heightCm ?? null, weightKg: weightKg ?? null },
      });
    }

    await recordAudit(
      {
        tenantId,
        actorId: session.id,
        entity: "ReportCardEntry",
        entityId: entry.id,
        action: "update",
      },
      tx,
    );

    return entry;
  });

  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2025"].includes(error.code)) {
      return NextResponse.json({ error: "Rapor telah diubah di tab lain. Salin perubahan Anda, lalu muat ulang rapor sebelum menyimpan." }, { status: 409 });
    }
    throw error;
  }
  revalidateTag("parent-report-cards", { expire: 0 });
  return NextResponse.json({ data: saved });
}
