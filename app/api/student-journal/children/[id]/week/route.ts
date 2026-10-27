import { NextRequest, NextResponse } from "next/server";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireGuardianForStudent } from "@/lib/student-journal/guards";
import { weekStart, weekDates } from "@/lib/student-journal/week";
import { resolveLastAdminEditByEntryId } from "@/lib/student-journal/audit";
import { enrichNotesWithAuthorMetadata } from "@/lib/student-journal/note-metadata";
import { getDayMarksForStudentWeek } from "@/lib/student-journal/day-marks";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: studentId } = await params;

  const guard = await requireGuardianForStudent(studentId);
  if (guard.error) return guard.error;
  const { session } = guard;

  // Resolve weekStart param (default to current week)
  const { searchParams } = new URL(req.url);
  const weekStartParam = searchParams.get("weekStart");

  let ws: string;
  if (weekStartParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartParam)) {
      return NextResponse.json({ error: "weekStart harus format YYYY-MM-DD" }, { status: 400 });
    }
    ws = weekStartParam;
  } else {
    const today = getTodayInTimezone("Asia/Jakarta");
    ws = weekStart(today);
  }

  const dates = weekDates(ws);
  const dateEnd = dates[dates.length - 1];

  // Fetch tenant template
  const tmpl = await prisma.studentJournalTemplate.findUnique({
    where: { tenantId: session.tenantId },
    select: { id: true },
  });

  if (!tmpl) {
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

  // Fetch school and home categories with active indicators
  const [schoolCategories, homeCategories, schoolEntries, homeEntries, notes] =
    await Promise.all([
      prisma.studentJournalCategory.findMany({
        where: { templateId: tmpl.id, scope: "SCHOOL", status: JournalStatus.ACTIVE },
        include: {
          indicators: {
            where: { status: JournalStatus.ACTIVE },
            orderBy: { order: "asc" },
          },
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      prisma.studentJournalCategory.findMany({
        where: { templateId: tmpl.id, scope: "HOME", status: JournalStatus.ACTIVE },
        include: {
          indicators: {
            where: { status: JournalStatus.ACTIVE },
            orderBy: { order: "asc" },
          },
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      prisma.studentJournalEntry.findMany({
        where: {
          tenantId: session.tenantId,
          studentId,
          scope: "SCHOOL",
          date: { gte: ws, lte: dateEnd },
        },
        select: {
          id: true,
          indicatorId: true,
          date: true,
          checked: true,
          scope: true,
        },
      }),
      prisma.studentJournalEntry.findMany({
        where: {
          tenantId: session.tenantId,
          studentId,
          scope: "HOME",
          date: { gte: ws, lte: dateEnd },
        },
        select: {
          id: true,
          indicatorId: true,
          date: true,
          checked: true,
          scope: true,
        },
      }),
      prisma.studentJournalNote.findMany({
        where: {
          tenantId: session.tenantId,
          studentId,
          date: { gte: ws, lte: dateEnd },
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

  const allEntryIds = [...schoolEntries, ...homeEntries].map((e) => e.id);
  const lastEditByEntryId = await resolveLastAdminEditByEntryId(
    session.tenantId,
    allEntryIds,
  );
  const decorate = (e: (typeof schoolEntries)[number]) => ({
    ...e,
    lastAdminEdit: lastEditByEntryId.get(e.id) ?? null,
  });

  // Days the guru marked "tanpa buku penghubung", keyed by date (keterangan the wali reads).
  const dayMarks = await getDayMarksForStudentWeek(session.tenantId, studentId, dates);

  const notesWithAuthor = await enrichNotesWithAuthorMetadata(session.tenantId, notes);

  return NextResponse.json({
    data: {
      weekStart: ws,
      dates,
      schoolCategories,
      homeCategories,
      schoolEntries: schoolEntries.map(decorate),
      homeEntries: homeEntries.map(decorate),
      notes: notesWithAuthor,
      dayMarks,
    },
  });
}
