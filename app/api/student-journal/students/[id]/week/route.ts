import { NextRequest, NextResponse } from "next/server";
import { JournalStatus } from "@/lib/generated/prisma/enums";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { weekStart, weekDates } from "@/lib/student-journal/week";
import { resolveLastAdminEditByEntryId } from "@/lib/student-journal/audit";
import { enrichNotesWithAuthorMetadata } from "@/lib/student-journal/note-metadata";
import { getDayMarksForStudentWeek } from "@/lib/student-journal/day-marks";
import {
  JOURNAL_FORBIDDEN_MSG,
  JOURNAL_NOT_ENROLLED_MSG,
} from "@/lib/student-journal/messages";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: studentId } = await params;

  // 1. Auth
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Role check — teacher only (parent uses /children/[id]/week)
  if (session.role !== "TEACHER") {
    return NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 });
  }

  // 3. Require tenantId + employeeId
  if (!session.tenantId || !session.employeeId) {
    return NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 });
  }

  // 4. Look up ALL student's active enrollments. Grant if teacher is assigned
  //    to ANY of them — students with cross-program enrollments (e.g. day-care
  //    + school) can otherwise 403 when findFirst picks the wrong class.
  //    The same rows carry everything the page needs to name its subject — the
  //    student and the class(es) they sit in — so identity costs no extra query.
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      studentId,
      status: "ACTIVE",
      classSection: { tenantId: session.tenantId },
    },
    select: {
      classSectionId: true,
      classSection: { select: { name: true } },
      student: { select: { id: true, name: true, nickname: true } },
    },
  });
  if (enrollments.length === 0) {
    return NextResponse.json({ error: JOURNAL_NOT_ENROLLED_MSG }, { status: 404 });
  }

  // 5. Verify teacher is assigned to one of the student's classes. findMany,
  //    not findFirst: the ids are needed again below, because a link into the
  //    fill grid must target a class this teacher may actually fill.
  const assignments = await prisma.teachingAssignment.findMany({
    where: {
      employeeId: session.employeeId,
      classSectionId: { in: enrollments.map((e) => e.classSectionId) },
      classSection: { tenantId: session.tenantId },
    },
    select: { classSectionId: true },
  });
  if (assignments.length === 0) {
    return NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 });
  }
  const assignedClassIds = new Set(assignments.map((a) => a.classSectionId));

  // 6. Identity for the page header. A student may hold several ACTIVE
  //    enrollments (day-care + school), so the class list is de-duplicated
  //    rather than reduced to whichever row sorted first.
  //    Null rather than a throw when the relation is missing: the header is a
  //    nicety, the week grid is the payload, and a partial row must not 500.
  const identity = enrollments.find((e) => e.student)?.student;
  //    `classes` carries ids as well as names because the page links back into
  //    the fill grid, and that link needs a classSectionId — but ONLY for a
  //    class this teacher is assigned to. Abdullah on staging holds two ACTIVE
  //    DCARE enrollments and this guru teaches the second; linking to the first
  //    sent him to a "Data kelas tidak bisa dimuat" + Forbidden, because the
  //    week route grants on ANY enrollment while class-grid guards the specific
  //    class. `classNames` stays the full list — that is identity, not a link.
  const seenClassIds = new Set<string>();
  const classes: Array<{ id: string; name: string }> = [];
  const allClassNames: string[] = [];
  for (const e of enrollments) {
    if (!e.classSection || seenClassIds.has(e.classSectionId)) continue;
    seenClassIds.add(e.classSectionId);
    allClassNames.push(e.classSection.name);
    if (assignedClassIds.has(e.classSectionId)) {
      classes.push({ id: e.classSectionId, name: e.classSection.name });
    }
  }
  const student = identity
    ? {
        id: identity.id,
        name: identity.name,
        nickname: identity.nickname,
        classes,
        classNames: [...new Set(allClassNames)],
      }
    : null;

  // 7. Resolve weekStart param
  const { searchParams } = new URL(req.url);
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

  // 8. Compute week date range
  const dates = weekDates(ws);
  const dateEnd = dates[dates.length - 1];

  // 9. Fetch tenant template
  const tmpl = await prisma.studentJournalTemplate.findUnique({
    where: { tenantId: session.tenantId },
    select: { id: true },
  });

  if (!tmpl) {
    return NextResponse.json({
      data: {
        weekStart: ws,
        dates,
        student,
        categories: [],
        entries: [],
        homeCategories: [],
        homeEntries: [],
        notes: [],
        dayMarks: {},
      },
    });
  }

  // 10. Parallel fetch: categories + entries of BOTH scopes, and notes.
  //     SCHOOL is what the teacher fills; HOME is what the wali ticked in
  //     "Di rumah" ("bantu Ustadzah memantau ibadah dan rutinitas di rumah").
  //     The parent's ticks were readable by admin but never by the class
  //     teacher the wali wrote them for (X-5). Same student and tenant as the
  //     school rows, so the assignment check above already covers it.
  const [allCategories, allEntries, notes] = await Promise.all([
    prisma.studentJournalCategory.findMany({
      where: {
        templateId: tmpl.id,
        scope: { in: ["SCHOOL", "HOME"] },
        status: JournalStatus.ACTIVE,
      },
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
        scope: { in: ["SCHOOL", "HOME"] },
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

  const categories = allCategories.filter((c) => c.scope === "SCHOOL");
  // A HOME category with no active indicator has nothing to show.
  const homeCategories = allCategories.filter(
    (c) => c.scope === "HOME" && c.indicators.length > 0,
  );
  const entries = allEntries.filter((e) => e.scope === "SCHOOL");
  const homeEntries = allEntries.filter((e) => e.scope === "HOME");

  const lastEditByEntryId = await resolveLastAdminEditByEntryId(
    session.tenantId,
    entries.map((e) => e.id),
  );
  const entriesWithAudit = entries.map((e) => ({
    ...e,
    lastAdminEdit: lastEditByEntryId.get(e.id) ?? null,
  }));

  // Days the guru marked "tanpa buku penghubung", keyed by date (keterangan the wali reads).
  const dayMarks = await getDayMarksForStudentWeek(session.tenantId, studentId, dates);

  const notesWithAuthor = await enrichNotesWithAuthorMetadata(session.tenantId, notes);

  return NextResponse.json({
    data: {
      weekStart: ws,
      dates,
      student,
      categories,
      entries: entriesWithAudit,
      homeCategories,
      homeEntries: homeEntries.map(({ id, indicatorId, date, checked }) => ({
        id,
        indicatorId,
        date,
        checked,
      })),
      notes: notesWithAuthor,
      dayMarks,
    },
  });
}
