import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  SESSION_ATTENDANCE_SAVE_BUDGET,
  SESSION_ATTENDANCE_SAVE_WINDOW_MS,
} from "@/lib/api/rate-limit-budgets";
import { validateBody } from "@/lib/api/validate";
import { sessionAttendanceSchema } from "@/lib/validations/student-attendance";

/**
 * POST /api/teacher/sessions/[id]/attendance
 *
 * Session-based bulk attendance upsert (academic-hierarchy-refactor Task 7) —
 * the NEW path that runs alongside the legacy session-agnostic
 * /api/student-attendance/mark route. Rows are keyed on the
 * @@unique([studentId, sessionId]) constraint.
 *
 * Authorization: the caller's write permission derives from
 * `ClassSession.teacherId === session.employeeId` (cycle assumption: this is
 * the effective teacher and so covers substitutes — NOT the TeachingAssignment
 * table). Admins may write any session in their tenant. The session is loaded
 * tenant-scoped via `classSection: { tenantId }` so a cross-tenant id 404s.
 *
 * Does NOT call reconcile — recording attendance never changes which sessions
 * exist.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Per user, not per IP — teachers on the school Wi-Fi share one IP.
  const { success } = rateLimit(
    `session-attendance:${session.id}`,
    SESSION_ATTENDANCE_SAVE_BUDGET,
    SESSION_ATTENDANCE_SAVE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }
  const isTeacher = session.role === "TEACHER";
  const isAdmin = isAdminRole(session.role);
  if (!isTeacher && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // `checkedInBy` is a non-null write — the caller must have an employeeId.
  if (!session.employeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Tenant-scoped load — cross-tenant / missing id 404s before any auth leak.
  const classSession = await prisma.classSession.findFirst({
    where: { id, classSection: { tenantId: session.tenantId } },
    select: { id: true, classSectionId: true, date: true, teacherId: true },
  });
  if (!classSession) {
    return NextResponse.json(
      { error: "Sesi kelas tidak ditemukan" },
      { status: 404 },
    );
  }

  // Write permission: caller must be the session's effective teacher, OR an
  // admin (admins may write any session within their tenant).
  if (!isAdmin && classSession.teacherId !== session.employeeId) {
    return NextResponse.json(
      { error: "Anda tidak mengajar di sesi ini" },
      { status: 403 },
    );
  }

  const result = await validateBody(sessionAttendanceSchema, await req.json());
  if (result.error) return result.error;
  const { rows } = result.data;

  // Validate every studentId is ACTIVE-enrolled in the session's class.
  const studentIds = rows.map((r) => r.studentId);
  const activeEnrollments = await prisma.studentEnrollment.findMany({
    where: {
      studentId: { in: studentIds },
      classSectionId: classSession.classSectionId,
      status: "ACTIVE",
    },
    select: { studentId: true },
  });
  const enrolledIds = new Set(activeEnrollments.map((e) => e.studentId));
  const notEnrolled = studentIds.filter((sid) => !enrolledIds.has(sid));
  if (notEnrolled.length > 0) {
    return NextResponse.json(
      {
        error: "student_not_enrolled",
        message: `Siswa tidak terdaftar di kelas ini: ${notEnrolled.join(", ")}`,
      },
      { status: 422 },
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const checkInTime = row.checkInTime ? new Date(row.checkInTime) : null;
      const checkOutTime = row.checkOutTime ? new Date(row.checkOutTime) : null;
      const pickedUpByRelation = row.pickedUpByRelation ?? null;
      const pickedUpByName = row.pickedUpByName?.trim() || null;

      await tx.studentAttendance.upsert({
        where: {
          studentId_sessionId: { studentId: row.studentId, sessionId: id },
        },
        create: {
          studentId: row.studentId,
          classSectionId: classSession.classSectionId,
          sessionId: id,
          date: classSession.date,
          status: row.status,
          checkInTime,
          checkOutTime,
          pickedUpByRelation,
          pickedUpByName,
          checkedInBy: session.employeeId,
        },
        update: {
          // Explicit authorized re-recording replaces an admin-voided entry,
          // like Gerbang. Keeping the flag would report saved but hide the row.
          isVoided: false,
          classSectionId: classSession.classSectionId,
          date: classSession.date,
          status: row.status,
          checkInTime,
          checkOutTime,
          pickedUpByRelation,
          pickedUpByName,
          checkedInBy: session.employeeId,
        },
      });
    }
  });

  // The transaction is all-or-nothing — reaching here means every row
  // persisted, so the saved count equals the input row count.
  return NextResponse.json({ saved: rows.length, total: rows.length });
}
