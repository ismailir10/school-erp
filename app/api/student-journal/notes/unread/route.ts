import { NextRequest, NextResponse } from "next/server";
import { getSession, isAdminRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSentraClassIds } from "@/lib/sentra/access";
import { JOURNAL_FORBIDDEN_MSG } from "@/lib/student-journal/messages";
import { countUnreadNotesByStudent } from "@/lib/student-journal/note-reads";

/** A wali has a handful of children and a guru one roster; nobody needs more. */
const MAX_STUDENT_IDS = 20;

/**
 * GET /api/student-journal/notes/unread?studentIds=a,b,c
 *
 * Unread note counts for several students at once, as a `{ [studentId]: n }`
 * map. Students the caller may not see are simply absent from the map — the
 * endpoint never says "that student exists but is not yours".
 *
 * Authorization is resolved in **bulk** rather than by calling
 * `requireNoteAccessForStudent` per id: this is a badge query fired on page
 * load, and per-id guarding would be three queries per child. The rule it
 * enforces is the same one that guard applies — guardians see students they
 * hold an ACTIVE link to, teachers see students enrolled in a class they are
 * assigned to or reach as guru sentra, admins see their own tenant — reduced to one query per role.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.tenantId) {
    return NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 });
  }

  const raw = new URL(req.url).searchParams.get("studentIds") ?? "";
  const requested = [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_STUDENT_IDS);

  if (requested.length === 0) {
    return NextResponse.json({ data: { unreadNoteCounts: {} } });
  }

  let allowed: string[] = [];

  if (isAdminRole(session.role)) {
    const students = await prisma.student.findMany({
      where: { id: { in: requested }, tenantId: session.tenantId },
      select: { id: true },
    });
    allowed = students.map((s) => s.id);
  } else if (session.role === "TEACHER") {
    if (!session.employeeId) {
      return NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 });
    }
    const sentraIds = await getSentraClassIds(session.employeeId, session.tenantId);
    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        studentId: { in: requested },
        status: "ACTIVE",
        classSection: {
          tenantId: session.tenantId,
          OR: [
            { teachingAssignments: { some: { employeeId: session.employeeId } } },
            { id: { in: sentraIds } },
          ],
        },
      },
      select: { studentId: true },
    });
    allowed = [...new Set(enrollments.map((e) => e.studentId))];
  } else if (session.role === "GUARDIAN") {
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { parentId: true },
    });
    if (!user?.parentId) {
      return NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 });
    }
    const links = await prisma.studentGuardian.findMany({
      where: {
        studentId: { in: requested },
        parentId: user.parentId,
        status: "ACTIVE",
        student: { tenantId: session.tenantId },
      },
      select: { studentId: true },
    });
    allowed = links.map((l) => l.studentId);
  } else {
    return NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 });
  }

  const unreadNoteCounts = await countUnreadNotesByStudent({
    tenantId: session.tenantId,
    studentIds: allowed,
    readerUserId: session.id,
  });

  return NextResponse.json({ data: { unreadNoteCounts } });
}
