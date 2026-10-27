import { NextRequest, NextResponse } from "next/server";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/student-journal/guards";
import { weekStart, weekDates } from "@/lib/student-journal/week";
import { enrichNotesWithAuthorMetadata } from "@/lib/student-journal/note-metadata";
import { getDayMarksForStudentWeek } from "@/lib/student-journal/day-marks";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

/**
 * GET /api/student-journal/admin/students/[id]/week?weekStart=
 *
 * Admin-scoped endpoint — no teacher assignment gate.
 * Returns all categories, indicators, entries (SCHOOL + HOME), and notes
 * for a single student for the requested week.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const { session } = guard;

  const { id: studentId } = await params;
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
    const today = getTodayInTimezone("Asia/Jakarta");
    ws = weekStart(today);
  }

  const dates = weekDates(ws);
  const weekEnd = dates[dates.length - 1];

  // Verify student belongs to this tenant
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId: session.tenantId },
    select: { id: true, name: true },
  });
  if (!student) {
    return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
  }

  // Fetch tenant template
  const template = await prisma.studentJournalTemplate.findUnique({
    where: { tenantId: session.tenantId },
    select: { id: true },
  });

  if (!template) {
    return NextResponse.json({
      data: {
        weekStart: ws,
        dates,
        schoolCategories: [],
        homeCategories: [],
        schoolEntries: [],
        homeEntries: [],
        notes: [],
        dayMarks: {},
      },
    });
  }

  // Parallel fetch: categories + entries + notes
  const [schoolCategories, homeCategories, schoolEntries, homeEntries, notes] =
    await Promise.all([
      prisma.studentJournalCategory.findMany({
        where: {
          templateId: template.id,
          scope: "SCHOOL",
          status: JournalStatus.ACTIVE,
        },
        orderBy: { order: "asc" },
        include: {
          indicators: {
            where: { status: JournalStatus.ACTIVE },
            orderBy: { order: "asc" },
            select: { id: true, label: true, order: true },
          },
        },
      }),
      prisma.studentJournalCategory.findMany({
        where: {
          templateId: template.id,
          scope: "HOME",
          status: JournalStatus.ACTIVE,
        },
        orderBy: { order: "asc" },
        include: {
          indicators: {
            where: { status: JournalStatus.ACTIVE },
            orderBy: { order: "asc" },
            select: { id: true, label: true, order: true },
          },
        },
      }),
      prisma.studentJournalEntry.findMany({
        where: {
          tenantId: session.tenantId,
          studentId,
          scope: "SCHOOL",
          date: { gte: ws, lte: weekEnd },
        },
        select: { id: true, indicatorId: true, date: true, checked: true },
      }),
      prisma.studentJournalEntry.findMany({
        where: {
          tenantId: session.tenantId,
          studentId,
          scope: "HOME",
          date: { gte: ws, lte: weekEnd },
        },
        select: { id: true, indicatorId: true, date: true, checked: true },
      }),
      prisma.studentJournalNote.findMany({
        where: {
          tenantId: session.tenantId,
          studentId,
          date: { gte: ws, lte: weekEnd },
          status: JournalStatus.ACTIVE,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          date: true,
          authorRole: true,
          authorUserId: true,
          body: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

  // Days the guru marked "tanpa buku penghubung", keyed by date (keterangan the wali reads).
  const dayMarks = await getDayMarksForStudentWeek(session.tenantId, studentId, dates);

  const notesWithAuthor = await enrichNotesWithAuthorMetadata(session.tenantId, notes);

  return NextResponse.json({
    data: {
      weekStart: ws,
      dates,
      schoolCategories: schoolCategories.map((c) => ({
        id: c.id,
        name: c.name,
        scope: c.scope,
        indicators: c.indicators,
      })),
      homeCategories: homeCategories.map((c) => ({
        id: c.id,
        name: c.name,
        scope: c.scope,
        indicators: c.indicators,
      })),
      schoolEntries,
      homeEntries,
      notes: notesWithAuthor,
      dayMarks,
    },
  });
}
