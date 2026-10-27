import { NextResponse } from "next/server";
import { getSession, isAdminRole, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  JOURNAL_FORBIDDEN_MSG,
  JOURNAL_NOT_ENROLLED_MSG,
} from "@/lib/student-journal/messages";

/**
 * Admin guard for Student Journal routes.
 *
 * Returns `{ session }` when the caller is authenticated AND carries an admin
 * role (SUPER_ADMIN or SCHOOL_ADMIN) AND has a tenantId. Otherwise returns
 * `{ error: NextResponse }` ready to be returned from the handler.
 *
 * Using `isAdminRole()` (not `session.role === "SCHOOL_ADMIN"`) — the
 * latter pattern caused a bug during the student CRUD cycle where
 * SUPER_ADMIN users were denied their own tenant's data.
 */
export async function requireAdmin(): Promise<
  | { session: SessionUser & { tenantId: string }; error?: undefined }
  | { session?: undefined; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isAdminRole(session.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!session.tenantId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session: session as SessionUser & { tenantId: string } };
}

/**
 * Teacher guard for Student Journal class routes.
 *
 * Returns `{ session }` when:
 * - Caller is authenticated with role TEACHER
 * - Has a tenantId
 * - Has an active TeachingAssignment for the given classSectionId
 *
 * NOTE: TeachingAssignment has no `status` field — existence of the row
 * means the assignment is active. Cross-tenant safety is enforced by
 * checking classSection.tenantId = session.tenantId.
 */
export async function requireTeacherForClass(classSectionId: string): Promise<
  | { session: SessionUser & { tenantId: string; employeeId: string }; error?: undefined }
  | { session?: undefined; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== "TEACHER") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!session.tenantId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!session.employeeId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  // Verify the teacher is assigned to this class AND the class belongs to their tenant
  const assignment = await prisma.teachingAssignment.findFirst({
    where: {
      employeeId: session.employeeId,
      classSectionId,
      classSection: { tenantId: session.tenantId },
    },
  });

  if (!assignment) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return {
    session: session as SessionUser & { tenantId: string; employeeId: string },
  };
}

/**
 * Guard for writing a class-day mark ("hari tanpa buku penghubung").
 *
 * - **Admin** (SUPER_ADMIN | SCHOOL_ADMIN): any class of their own tenant, so a
 *   past day can be corrected from the monitoring side. A class id from another
 *   tenant answers 404 — same as the rest of the admin journal routes.
 * - **Teacher**: delegates to `requireTeacherForClass` (assigned to this class).
 * - Everyone else (wali included): 403.
 */
export async function requireDayMarkWriter(classSectionId: string): Promise<
  | { session: SessionUser & { tenantId: string }; error?: undefined }
  | { session?: undefined; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isAdminRole(session.role)) return requireTeacherForClass(classSectionId);
  if (!session.tenantId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const classSection = await prisma.classSection.findFirst({
    where: { id: classSectionId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!classSection) {
    return { error: NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 404 }) };
  }
  return { session: session as SessionUser & { tenantId: string } };
}

/**
 * Note-surface guard — who may read or write the note thread of one student.
 *
 * Lifted verbatim out of `app/api/student-journal/notes/route.ts`'s POST, which
 * was the only caller until the thread read + mark-read routes arrived. Three
 * surfaces answering "may this session touch this student's catatan?" with
 * three copies of the branching is exactly how one of them ends up subtly
 * looser than the others, so they share this.
 *
 * - **Admin** (SUPER_ADMIN | SCHOOL_ADMIN): tenant scope only. Admins write on
 *   behalf of staff and are not assigned to classes.
 * - **Teacher**: must hold a TeachingAssignment for at least ONE of the
 *   student's ACTIVE enrollments. A student may sit in several (day-care plus
 *   school), and checking only the first 403s a guru who is legitimately
 *   assigned via the other.
 * - **Guardian**: delegates to `requireGuardianForStudent`.
 *
 * Returns the student's own `tenantId` alongside the session: a note is tagged
 * to the student's tenant, not the author's, so a guru pengganti reading across
 * a tenant boundary cannot strand a note where the wali will never see it.
 */
export async function requireNoteAccessForStudent(studentId: string): Promise<
  | { session: SessionUser; studentTenantId: string; error?: undefined }
  | { session?: undefined; studentTenantId?: undefined; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const studentForTenant = await prisma.student.findUnique({
    where: { id: studentId },
    select: { tenantId: true },
  });
  if (!studentForTenant) {
    return { error: NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 }) };
  }

  const forbidden = () =>
    NextResponse.json({ error: JOURNAL_FORBIDDEN_MSG }, { status: 403 });

  if (isAdminRole(session.role)) {
    if (!session.tenantId) return { error: forbidden() };
    const studentInTenant = await prisma.student.findFirst({
      where: { id: studentId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!studentInTenant) return { error: forbidden() };
  } else if (session.role === "TEACHER") {
    if (!session.tenantId || !session.employeeId) return { error: forbidden() };

    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        studentId,
        status: "ACTIVE",
        classSection: { tenantId: session.tenantId },
      },
      select: { classSectionId: true },
    });
    if (enrollments.length === 0) {
      return {
        error: NextResponse.json({ error: JOURNAL_NOT_ENROLLED_MSG }, { status: 404 }),
      };
    }

    const assignment = await prisma.teachingAssignment.findFirst({
      where: {
        employeeId: session.employeeId,
        classSectionId: { in: enrollments.map((e) => e.classSectionId) },
        classSection: { tenantId: session.tenantId },
      },
    });
    if (!assignment) return { error: forbidden() };
  } else if (session.role === "GUARDIAN") {
    const guard = await requireGuardianForStudent(studentId);
    if (guard.error) return { error: guard.error };
  } else {
    return { error: forbidden() };
  }

  return { session, studentTenantId: studentForTenant.tenantId };
}

/**
 * Guardian guard for Student Journal parent routes.
 *
 * Returns `{ session }` when:
 * - Caller is authenticated with role GUARDIAN
 * - Has a tenantId
 * - Has an active StudentGuardian row linking the caller's Parent record to studentId
 *
 * Relation chain: session.id → User.parentId → Parent.id → StudentGuardian.parentId
 */
export async function requireGuardianForStudent(studentId: string): Promise<
  | { session: SessionUser & { tenantId: string }; error?: undefined }
  | { session?: undefined; error: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role !== "GUARDIAN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!session.tenantId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  // Look up the Parent record for this user via User.parentId
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { parentId: true },
  });
  if (!user?.parentId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const link = await prisma.studentGuardian.findFirst({
    where: {
      studentId,
      parentId: user.parentId,
      status: "ACTIVE",
      // Defense in depth: StudentGuardian has no direct tenantId column, so
      // scope via the student relation. Without this, a guardian's active
      // link record for a student in another tenant (shouldn't exist, but
      // isn't schema-enforced) would silently pass this guard.
      student: { tenantId: session.tenantId },
    },
  });
  if (!link) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { session: session as SessionUser & { tenantId: string } };
}
