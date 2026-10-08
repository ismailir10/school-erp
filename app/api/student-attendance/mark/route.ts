import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ATTENDANCE_TAP_BUDGET, ATTENDANCE_TAP_WINDOW_MS } from "@/lib/api/rate-limit-budgets";
import { validateBody } from "@/lib/api/validate";
import { markAttendanceSchema } from "@/lib/validations/student-attendance";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

// Backdating window for this legacy tab. Anything older is a correction for
// the admin recap, not a tap on today's class page.
const MAX_BACKDATE_DAYS = 400;

/** Real calendar day? The schema only checks the YYYY-MM-DD shape, so
 * "2026-02-30" gets through; round-trip it through UTC to catch rollover. */
function isRealCalendarDate(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);
}

/** A changed status without fresh notes must not inherit the previous
 * status's note ("demam" under ABSENT, or an admin's correction under SICK).
 * Unchanged status without notes keeps what is there (undefined = no write). */
function resolveNotes(
  incoming: string | null | undefined,
  existing: { status: string } | null,
  nextStatus: string,
): string | null | undefined {
  if (incoming != null) return incoming;
  return existing && existing.status !== nextStatus ? null : undefined;
}

/** Check-in/out times for the row. A child who is not PRESENT never arrived, so
 * SICK/PERMISSION/ABSENT clears both (null) — including a check-in inherited
 * from the session screen. PRESENT keeps the old "undefined = leave as is"
 * on update. */
function resolveTimes(
  record: { status: string; checkInTime?: string | null; checkOutTime?: string | null },
  fallback: null | undefined,
): { checkInTime: Date | null | undefined; checkOutTime: Date | null | undefined } {
  if (record.status !== "PRESENT") return { checkInTime: null, checkOutTime: null };
  return {
    checkInTime: record.checkInTime ? new Date(record.checkInTime) : fallback,
    checkOutTime: record.checkOutTime ? new Date(record.checkOutTime) : fallback,
  };
}

// Mark attendance for multiple students at once (teacher submits class attendance)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Per user, not per IP: the class page saves one request per tap, and every
  // teacher on the school Wi-Fi shares one IP.
  const { success } = rateLimit(`mark-attendance:${session.id}`, ATTENDANCE_TAP_BUDGET, ATTENDANCE_TAP_WINDOW_MS);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  const isTeacher = session.role === "TEACHER";
  const isAdmin = isAdminRole(session.role);
  if (!isTeacher && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // `checkedInBy` is a non-null FK to Employee — both teachers and admins
  // writing here must have an employeeId.
  if (!session.employeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await validateBody(markAttendanceSchema, await req.json());
  if (result.error) return result.error;
  const { classSectionId, date, records } = result.data;

  // Jakarta TZ — UTC split returned yesterday between 00:00–06:59 WIB
  // and caused false 400s for early-morning teacher attendance marking.
  const today = getTodayInTimezone("Asia/Jakarta");
  if (!isRealCalendarDate(date)) {
    return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 });
  }
  if (date > today) {
    return NextResponse.json({ error: "Tidak bisa mencatat kehadiran untuk tanggal yang akan datang" }, { status: 400 });
  }
  if (daysBetween(date, today) > MAX_BACKDATE_DAYS) {
    return NextResponse.json({ error: "Tanggal terlalu lama untuk diubah." }, { status: 400 });
  }

  // Verify teacher is assigned to this class (tenant-scoped via classSection).
  // Admins bypass this check but still need the class to belong to their tenant.
  if (isTeacher) {
    const assignment = await prisma.teachingAssignment.findFirst({
      where: {
        employeeId: session.employeeId!,
        classSectionId,
        classSection: { tenantId: session.tenantId },
      },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Anda tidak ditugaskan di kelas ini" }, { status: 403 });
    }
  } else {
    const classSection = await prisma.classSection.findFirst({
      where: { id: classSectionId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!classSection) {
      return NextResponse.json({ error: "Kelas tidak ditemukan" }, { status: 404 });
    }
  }

  // Validate all students are enrolled in this class — before the transaction
  // so it answers 422, not an uncaught throw → 500.
  const studentIds = records.map((r: { studentId: string }) => r.studentId);
  const activeEnrollments = await prisma.studentEnrollment.findMany({
    where: {
      studentId: { in: studentIds },
      classSectionId,
      status: "ACTIVE",
    },
    select: { studentId: true },
  });
  const enrolledIds = new Set(activeEnrollments.map((e) => e.studentId));
  const notEnrolled = [...new Set(studentIds.filter((id: string) => !enrolledIds.has(id)))];
  if (notEnrolled.length > 0) {
    // Prefer names over cuids in the message; fall back to the id.
    const students = await prisma.student.findMany({
      where: { id: { in: notEnrolled }, tenantId: session.tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(students.map((s) => [s.id, s.name]));
    return NextResponse.json(
      {
        error: "student_not_enrolled",
        message: `Siswa tidak terdaftar di kelas ini: ${notEnrolled.map((id) => nameById.get(id) ?? id).join(", ")}`,
      },
      { status: 422 },
    );
  }

  // Sorted so concurrent requests take the per-student locks in the same
  // order and cannot deadlock each other.
  const sortedRecords = [...records].sort((a, b) =>
    a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0,
  );

  let saved = 0;
  try {
  await prisma.$transaction(async (tx) => {
    // If this class has exactly one ClassSession for this date (the common
    // single-shift case — KB/TKIT/PopUp), write into that session's row so
    // this legacy tab and the session-based "Sesi Hari Ini" card can never
    // both create a row for the same student/day (was silently double-
    // counting in the admin monthly recap, which groups by status without
    // deduping by date — see docs/cycles/archive/2026-07-12-pilot-readiness-audit.md
    // T2). Multi-shift days (DCARE MORNING+AFTERNOON) have >1 session and
    // fall back to the pre-existing sessionId:null path unchanged — Task 7
    // still owns fully resolving that case.
    const daySessions = await tx.classSession.findMany({
      where: { classSectionId, date },
      select: { id: true },
    });
    const singleSessionId = daySessions.length === 1 ? daySessions[0].id : null;

    for (const record of sortedRecords) {
      if (singleSessionId) {
        const existingRow = await tx.studentAttendance.findUnique({
          where: { studentId_sessionId: { studentId: record.studentId, sessionId: singleSessionId } },
          select: { status: true },
        });
        const notes = resolveNotes(record.notes, existingRow, record.status);
        const createTimes = resolveTimes(record, null);
        const updateTimes = resolveTimes(record, undefined);
        await tx.studentAttendance.upsert({
          where: {
            studentId_sessionId: { studentId: record.studentId, sessionId: singleSessionId },
          },
          create: {
            studentId: record.studentId,
            classSectionId,
            sessionId: singleSessionId,
            date,
            status: record.status,
            ...createTimes,
            notes: record.notes ?? null,
            checkedInBy: session.employeeId!,
          },
          update: {
            status: record.status,
            ...updateTimes,
            notes,
            checkedInBy: session.employeeId!,
          },
        });
        saved++;
        continue;
      }

      // The legacy @@unique([studentId, date]) was dropped (cycle
      // 2026-05-15 academic-hierarchy-refactor) to allow DCARE multi-shift
      // attendance; uniqueness moved to (studentId, sessionId). This
      // session-agnostic path still keeps one row per student/date
      // (sessionId stays NULL here), so find-then-update/create on
      // [studentId, date] preserves the prior upsert behavior. Task 7
      // reworks this path onto ClassSession.
      //
      // Find-then-create has no unique key to fall back on, so parallel taps
      // for the same student/day each saw "no row" and each inserted one.
      // Serialize them per student+day with a transaction-scoped advisory
      // lock (released at commit; the next waiter's findFirst then sees the
      // committed row). $executeRaw because the lock fn returns void, which
      // $queryRaw cannot deserialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${record.studentId}::text || ':' || ${date}::text))`;
      const existing = await tx.studentAttendance.findFirst({
        where: { studentId: record.studentId, classSectionId, date, sessionId: null },
        select: { id: true, status: true },
      });
      if (existing) {
        await tx.studentAttendance.update({
          where: { id: existing.id },
          data: {
            status: record.status,
            ...resolveTimes(record, undefined),
            notes: resolveNotes(record.notes, existing, record.status),
            checkedInBy: session.employeeId!,
          },
        });
      } else {
        await tx.studentAttendance.create({
          data: {
            studentId: record.studentId,
            classSectionId,
            date,
            status: record.status,
            ...resolveTimes(record, null),
            notes: record.notes ?? null,
            checkedInBy: session.employeeId!,
          },
        });
      }
      saved++;
    }
  });

  } catch (error) {
    // The legacy partial unique index is student/day. Never overwrite another
    // class when the same child is enrolled in two classes on a null-session day.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({error:"Absensi siswa pada tanggal ini sudah tercatat di kelas lain. Hubungi admin untuk memeriksa catatannya."}, {status:409});
    }
    throw error;
  }
  return NextResponse.json({ saved, total: records.length });
}
