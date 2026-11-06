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
import { rotationDayIndex } from "@/lib/sentra/rotation";

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

  // The route segment is a Sentra id (campus table); tenant-checked, 404 otherwise.
  // Tiles are the guru's own campus (Decision 8), and only ACTIVE sentra show.
  // Admin-role readers keep the tenant boundary but skip the campus pin.
  const { center: sentraId } = await params;
  let campusId: string | null = null;
  if (session.role === "TEACHER") {
    const employee = await prisma.employee.findFirst({
      where: { id: session.employeeId, tenantId: session.tenantId },
      select: { campusId: true },
    });
    campusId = employee?.campusId ?? null;
    if (!campusId) {
      return NextResponse.json(
        { error: "Sentra tidak dikenal." },
        { status: 404 },
      );
    }
  }
  const sentra = await prisma.sentra.findFirst({
    where: {
      id: sentraId,
      tenantId: session.tenantId,
      status: "ACTIVE",
      ...(campusId ? { campusId } : {}),
    },
    select: { id: true, name: true, legacyCenter: true, campusId: true },
  });
  if (!sentra) {
    return NextResponse.json(
      { error: "Sentra tidak dikenal." },
      { status: 404 },
    );
  }

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date") ?? getTodayInTimezone(JAKARTA_TZ);
  const classSectionIdParam = searchParams.get("classSectionId");
  let ageGroupParam = searchParams.get("ageGroup");
  if (classSectionIdParam) {
    // A class view carries its own age group (indicators follow it), so the
    // ageGroup query becomes optional and the class's value wins.
    const cls = await prisma.classSection.findFirst({
      where: {
        id: classSectionIdParam,
        tenantId: session.tenantId,
        campusId: sentra.campusId,
        status: "ACTIVE",
        academicYear: { status: "ACTIVE" },
      },
      select: { id: true, ageGroup: true },
    });
    if (!cls) {
      return NextResponse.json(
        { error: "Kelas tidak ditemukan." },
        { status: 404 },
      );
    }
    ageGroupParam = cls.ageGroup;
  }
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
        sentra: { id: sentra.id, name: sentra.name },
        date: dateParam,
        ageGroup,
      },
      { status: 422 },
    );
  }

  // Roster: with `classSectionId`, the ACTIVE students enrolled in that class
  // (the putaran's visiting class); otherwise every ACTIVE student in the
  // tenant whose ACTIVE enrolment is in a ClassSection of the requested
  // ageGroup. Filtering on classSection.ageGroup happens in the DB query, not
  // via name parsing.
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      status: "ACTIVE",
      student: { tenantId: session.tenantId, status: "ACTIVE" },
      classSection: classSectionIdParam
        ? { id: classSectionIdParam, tenantId: session.tenantId }
        : { tenantId: session.tenantId, status: "ACTIVE", ageGroup },
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
            // Entries recorded before the Sentra table only carry the old enum.
            ...(sentra.legacyCenter
              ? {
                  OR: [
                    { sentraId: sentra.id },
                    { sentraId: null, center: sentra.legacyCenter },
                  ],
                }
              : { sentraId: sentra.id }),
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

  // Putaran info: which class visits this sentra on the requested date, and
  // every class of a putaran that includes this sentra (for the switcher).
  const rotations = await prisma.sentraRotation.findMany({
    where: {
      tenantId: session.tenantId,
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
      slots: { some: { sentraId: sentra.id } },
    },
    select: {
      startDate: true,
      cycleDays: true,
      slots: {
        where: { sentraId: sentra.id },
        select: { dayIndex: true, classSectionId: true },
      },
      classes: {
        orderBy: { sortOrder: "asc" },
        select: { classSection: { select: { id: true, name: true } } },
      },
    },
  });
  let todayClassSectionId: string | null = null;
  const rotationClasses: Array<{ id: string; name: string }> = [];
  const seenClassIds = new Set<string>();
  for (const r of rotations) {
    for (const c of r.classes) {
      if (seenClassIds.has(c.classSection.id)) continue;
      seenClassIds.add(c.classSection.id);
      rotationClasses.push({ id: c.classSection.id, name: c.classSection.name });
    }
    if (todayClassSectionId) continue;
    const idx = rotationDayIndex(r.startDate, dateParam, r.cycleDays);
    if (idx === null) continue;
    todayClassSectionId =
      r.slots.find((slot) => slot.dayIndex === idx)?.classSectionId ?? null;
  }

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
    sentra: { id: sentra.id, name: sentra.name },
    todayClassSectionId,
    rotationClasses,
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
