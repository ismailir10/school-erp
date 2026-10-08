import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { getCurrentWeek } from "@/lib/curriculum/week-resolver";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import {
  parseJakartaYmd,
  formatJakartaYmd,
} from "@/lib/validations/curriculum";
import { learningCenterSchema } from "@/lib/validations/assessment-entry";

const JAKARTA_TZ = "Asia/Jakarta";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ center: string }> },
) {
  const auth = await requirePermission("assessments.read");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  if (!session.employeeId) {
    return NextResponse.json(
      { error: "Akun tidak terhubung dengan staf." },
      { status: 403 },
    );
  }

  const { center: centerParam } = await params;
  const centerParsed = learningCenterSchema.safeParse(
    centerParam.toUpperCase(),
  );
  if (!centerParsed.success) {
    return NextResponse.json(
      { error: "Sentra tidak dikenal." },
      { status: 404 },
    );
  }
  const center = centerParsed.data;

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date") ?? getTodayInTimezone(JAKARTA_TZ);
  const ageGroupParam = searchParams.get("ageGroup");
  if (ageGroupParam !== "A" && ageGroupParam !== "B") {
    return NextResponse.json(
      { error: "ageGroup wajib bernilai A atau B." },
      { status: 400 },
    );
  }
  const ageGroup = ageGroupParam;

  const targetUtcMidnight = parseJakartaYmd(dateParam);
  const week = await getCurrentWeek(session.tenantId, targetUtcMidnight);
  if (!week) {
    return NextResponse.json(
      {
        error:
          "Belum ada Pekan aktif untuk tanggal yang dipilih. Pilih tanggal lain atau minta admin menambah pekan.",
        reason: "no_active_week",
        center,
        date: dateParam,
        ageGroup,
      },
      { status: 422 },
    );
  }

  // Roster: every ACTIVE student in the tenant whose ACTIVE enrolment is
  // in a ClassSection with the requested ageGroup. Sentra rotation is
  // deferred so we don't yet know which students rotate to which sentra
  // session — caller-side roster is the next-best fallback. Filtering on
  // classSection.ageGroup happens in the DB query (schema column added
  // 2026-05-20 in feat/curriculum-cutover-prep T1), not via name parsing.
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      status: "ACTIVE",
      student: { tenantId: session.tenantId, status: "ACTIVE" },
      classSection: {
        tenantId: session.tenantId,
        status: "ACTIVE",
        ageGroup,
      },
    },
    select: {
      classSection: { select: { id: true, name: true } },
      student: {
        select: { id: true, name: true, nickname: true, status: true },
      },
    },
    orderBy: { student: { name: "asc" } },
  });
  const seenStudentIds = new Set<string>();
  const students: Array<{
    id: string;
    name: string;
    nickname: string | null;
    status: string;
    classSectionId: string;
    className: string;
  }> = [];
  for (const e of enrollments) {
    if (seenStudentIds.has(e.student.id)) continue;
    seenStudentIds.add(e.student.id);
    // Class label so two same-named children in different classes (TKIT A vs
    // POPUP Weekend) are distinguishable, and so the client can default to the
    // teacher's own class.
    students.push({
      ...e.student,
      classSectionId: e.classSection.id,
      className: e.classSection.name,
    });
  }

  const myAssignments = await prisma.teachingAssignment.findMany({
    where: {
      employeeId: session.employeeId,
      classSection: { tenantId: session.tenantId },
    },
    select: { classSectionId: true },
  });
  const myClassSectionIds = myAssignments.map((a) => a.classSectionId);

  const indicators = await prisma.achievementIndicator.findMany({
    where: {
      tenantId: session.tenantId,
      status: "ACTIVE",
      themeLinks: { some: { themeId: week.subTheme.theme.id } },
      objective: { ageGroup },
    },
    select: {
      id: true,
      content: true,
      order: true,
      objective: { select: { id: true, ageGroup: true, element: true } },
    },
    orderBy: [{ objective: { element: "asc" } }, { order: "asc" }],
  });

  const studentIds = students.map((s) => s.id);
  const existingEntries =
    studentIds.length > 0
      ? await prisma.assessmentEntry.findMany({
          where: {
            tenantId: session.tenantId,
            weekId: week.id,
            studentId: { in: studentIds },
            source: "CENTER",
            center,
            date: targetUtcMidnight,
          },
          select: {
            id: true,
            studentId: true,
            indicatorId: true,
            level: true,
            note: true,
            activity: true,
          },
        })
      : [];

  // Convenience prefill for the form's activity field — the most recent
  // activity string at this center+date (any ageGroup). Falls back to null
  // when no entry exists yet.
  const lastActivity =
    existingEntries.find((e) => e.activity)?.activity ?? null;

  return NextResponse.json({
    week: {
      id: week.id,
      number: week.number,
      startDate: formatJakartaYmd(week.startDate),
      endDate: formatJakartaYmd(week.endDate),
      subTheme: { id: week.subTheme.id, name: week.subTheme.name },
      theme: {
        id: week.subTheme.theme.id,
        name: week.subTheme.theme.name,
      },
    },
    center,
    date: dateParam,
    ageGroup,
    students,
    myClassSectionIds,
    indicators,
    entries: existingEntries.map((e) => ({
      id: e.id,
      studentId: e.studentId,
      indicatorId: e.indicatorId,
      level: e.level,
      note: e.note,
      activity: e.activity,
    })),
    lastActivity,
    writable: hasPermission(session, "assessments.write"),
  });
}
