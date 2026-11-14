import { NextRequest, NextResponse } from "next/server";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/student-journal/guards";
import { weekStart, weekDates } from "@/lib/student-journal/week";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { JAKARTA_TZ } from "@/lib/sessions/dates";

/**
 * GET /api/student-journal/admin/classes?weekStart=
 *
 * Returns the active academic year's classes for the tenant with a weekly
 * completion summary:
 * - classSectionId, className, programName
 * - studentCount: active enrollments
 * - checkedCount: checked SCHOOL entries in the week (raw, not derived)
 * - completionPct: (checkedCount / (studentCount * indicatorCount * 5)) * 100
 * - lastFilledAt: MAX(updatedAt) over the *checked* entries in that class-week
 *   scope — the same set `checkedCount` counts, so "filled" means one thing:
 *   `checkedCount > 0` ⇔ `lastFilledAt != null` (ACAD-8: the monitor's "Kelas
 *   sudah isi" card and "Terakhir diisi" column used to disagree)
 *
 * Plus a tenant-level `summary.activeStudentCount` — DISTINCT students, not a
 * sum of per-class counts (a student may hold more than one active enrollment).
 *
 * Scoped to the ACTIVE AcademicYear, matching `/api/admin/assessments`. Without
 * that filter archived cohorts leaked into the monitor: staging listed 15
 * classes (7 of them from the archived 2024/2025 year) and counted 37
 * "active students" against 21 real ones.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const { session } = guard;

  const { searchParams } = req.nextUrl;
  const weekStartParam = searchParams.get("weekStart");

  let ws: string;
  if (weekStartParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartParam)) {
      return NextResponse.json(
        { error: "weekStart harus format YYYY-MM-DD" },
        { status: 400 },
      );
    }
    ws = weekStartParam;
  } else {
    // Jakarta, not UTC: between 00:00-06:59 WIB a UTC read still returns
    // yesterday, and on a Monday that shifts the whole monitor a week back.
    // Matches the sibling `admin/class-roll-up` route.
    ws = weekStart(getTodayInTimezone(JAKARTA_TZ));
  }

  const dates = weekDates(ws);
  const weekEnd = dates[dates.length - 1];

  // Fetch tenant template to count active SCHOOL indicators
  const template = await prisma.studentJournalTemplate.findUnique({
    where: { tenantId: session.tenantId },
    select: { id: true },
  });

  let activeIndicatorCount = 0;
  if (template) {
    activeIndicatorCount = await prisma.studentJournalIndicator.count({
      where: {
        category: {
          templateId: template.id,
          scope: "SCHOOL",
          status: JournalStatus.ACTIVE,
        },
        status: JournalStatus.ACTIVE,
      },
    });
  }

  const activeYear = await prisma.academicYear.findFirst({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!activeYear) {
    return NextResponse.json(
      {
        error:
          "Tahun ajaran aktif belum diset. Aktifkan tahun ajaran terlebih dahulu.",
      },
      { status: 422 },
    );
  }

  // Active class sections in the active academic year
  const classSections = await prisma.classSection.findMany({
    where: {
      tenantId: session.tenantId,
      academicYearId: activeYear.id,
      status: "ACTIVE",
    },
    include: {
      program: { select: { name: true } },
      campus: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  if (classSections.length === 0) {
    return NextResponse.json({
      data: [],
      summary: { activeStudentCount: 0 },
    });
  }

  const classSectionIds = classSections.map((c) => c.id);

  // Pull the enrollment rows themselves rather than a per-class groupBy: the
  // same pass yields both the per-class counts and the DISTINCT student set
  // behind `activeStudentCount`.
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      classSectionId: { in: classSectionIds },
      status: "ACTIVE",
    },
    select: { studentId: true, classSectionId: true },
  });

  const enrollmentMap = new Map<string, number>();
  const distinctStudentIds = new Set<string>();
  for (const e of enrollments) {
    enrollmentMap.set(e.classSectionId, (enrollmentMap.get(e.classSectionId) ?? 0) + 1);
    distinctStudentIds.add(e.studentId);
  }

  // Count checked entries per class for the week
  const checkedCounts = await prisma.studentJournalEntry.groupBy({
    by: ["classSectionId"],
    where: {
      tenantId: session.tenantId,
      classSectionId: { in: classSectionIds },
      scope: "SCHOOL",
      date: { gte: ws, lte: weekEnd },
      checked: true,
    },
    _count: { id: true },
  });

  const checkedMap = new Map<string, number>(
    checkedCounts
      .filter((e): e is typeof e & { classSectionId: string } => e.classSectionId !== null)
      .map((e) => [e.classSectionId, e._count.id]),
  );

  // Get last filled timestamp per class. Same `checked: true` predicate as the
  // count above — an entry that was toggled off again is not "filled".
  const lastFilledRows = await prisma.studentJournalEntry.groupBy({
    by: ["classSectionId"],
    where: {
      tenantId: session.tenantId,
      classSectionId: { in: classSectionIds },
      scope: "SCHOOL",
      date: { gte: ws, lte: weekEnd },
      checked: true,
    },
    _max: { updatedAt: true },
  });

  const lastFilledMap = new Map<string, Date | null>(
    lastFilledRows
      .filter((e): e is typeof e & { classSectionId: string } => e.classSectionId !== null)
      .map((e) => [e.classSectionId, e._max.updatedAt ?? null]),
  );

  const data = classSections.map((cs) => {
    const studentCount = enrollmentMap.get(cs.id) ?? 0;
    const checkedCount = checkedMap.get(cs.id) ?? 0;
    const denominator = studentCount * activeIndicatorCount * 5;
    const completionPct =
      denominator > 0 ? Math.round((checkedCount / denominator) * 100) : 0;
    const lastFilledAt = lastFilledMap.get(cs.id) ?? null;

    return {
      classSectionId: cs.id,
      className: cs.name,
      programName: cs.program.name,
      campusName: cs.campus?.name ?? null,
      studentCount,
      checkedCount,
      completionPct,
      lastFilledAt: lastFilledAt ? lastFilledAt.toISOString() : null,
    };
  });

  return NextResponse.json({
    data,
    summary: { activeStudentCount: distinctStudentIds.size },
  });
}
