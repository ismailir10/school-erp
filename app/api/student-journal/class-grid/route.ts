import { NextRequest, NextResponse } from "next/server";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { requireTeacherForClass } from "@/lib/student-journal/guards";
import { countUnreadNotesByStudent } from "@/lib/student-journal/note-reads";
import { getDayMark } from "@/lib/student-journal/day-marks";

/**
 * GET /api/student-journal/class-grid?classSectionId=&date=
 *
 * Returns the full data needed for the teacher daily entry grid:
 * - students: active enrollments in the class, sorted by name
 * - categories: SCHOOL-scope active categories with active indicators
 * - entries: existing SCHOOL entries for that class-day (for pre-fill)
 * - dayMark: the "hari tanpa buku penghubung" keterangan for the class-day, or null
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const classSectionId = searchParams.get("classSectionId");
  const date = searchParams.get("date");

  if (!classSectionId || !date) {
    return NextResponse.json(
      { error: "classSectionId and date query params are required" },
      { status: 400 }
    );
  }

  const guard = await requireTeacherForClass(classSectionId);
  if (guard.error) return guard.error;
  const { session } = guard;

  // Fetch active student enrollments sorted by student name, plus the class the
  // grid is for — the entry page header said only "Isi Buku Penghubung" + a
  // date, so a guru teaching two classes could not tell which roster was open.
  // Fetched here rather than derived from an enrollment row so an empty class
  // still names itself.
  const [enrollments, classSection] = await Promise.all([
    prisma.studentEnrollment.findMany({
      where: {
        classSectionId,
        status: "ACTIVE",
      },
      include: {
        student: {
          select: { id: true, name: true, nickname: true },
        },
      },
      orderBy: { student: { name: "asc" } },
    }),
    prisma.classSection.findFirst({
      where: { id: classSectionId, tenantId: session.tenantId },
      select: { id: true, name: true },
    }),
  ]);

  const students = enrollments.map((e) => ({
    id: e.student.id,
    name: e.student.name,
    nickname: e.student.nickname,
  }));

  // Fetch the tenant's template to scope categories correctly
  const template = await prisma.studentJournalTemplate.findUnique({
    where: { tenantId: session.tenantId },
  });

  const categories = template
    ? await prisma.studentJournalCategory.findMany({
        where: {
          templateId: template.id,
          scope: "SCHOOL",
          status: JournalStatus.ACTIVE,
        },
        include: {
          indicators: {
            where: { status: JournalStatus.ACTIVE },
            orderBy: { order: "asc" },
          },
        },
        orderBy: { order: "asc" },
      })
    : [];

  // Fetch existing entries for this class-day to allow pre-fill
  const entries = await prisma.studentJournalEntry.findMany({
    where: {
      tenantId: session.tenantId,
      classSectionId,
      date,
      scope: "SCHOOL",
    },
    select: {
      id: true,
      studentId: true,
      indicatorId: true,
      checked: true,
    },
  });

  // Unread catatan per student, for the roster badge. One query for the whole
  // class rather than one per row — a 30-student roster would otherwise be 30
  // round trips for a number most rows render as nothing.
  const unreadNoteCounts = await countUnreadNotesByStudent({
    tenantId: session.tenantId,
    studentIds: students.map((s) => s.id),
    readerUserId: session.id,
  });

  const dayMark = await getDayMark(session.tenantId, classSectionId, date);

  return NextResponse.json({
    data: {
      students,
      categories,
      entries,
      classSection,
      unreadNoteCounts,
      dayMark,
    },
  });
}
