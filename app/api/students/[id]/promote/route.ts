import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { validateBody } from "@/lib/api/validate";
import { promoteStudentSchema } from "@/lib/validations/student";
import { ensureYearWritableById } from "@/lib/classes/year-guard";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`promote-student:${getClientIp(req)}`, 5, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "students.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "students.edit" }, { status: 403 });
  }

  const { id: studentId } = await params;
  const result = await validateBody(promoteStudentSchema, await req.json().catch(() => ({})));
  if (result.error) return result.error;
  const { targetClassSectionId, notes } = result.data;

  // Verify student belongs to tenant
  const student = await prisma.student.findFirst({
    where: { id: studentId, tenantId: session.tenantId },
  });
  if (!student) {
    return NextResponse.json({ error: "Siswa tidak ditemukan" }, { status: 404 });
  }

  // Tenant check on target (the capacity check itself is locked inside the
  // transaction below — mirror of the enroll route pattern). Also loads the
  // target's program type, which scopes the source-enrollment lookup below.
  const targetExists = await prisma.classSection.findFirst({
    where: { id: targetClassSectionId, tenantId: session.tenantId },
    select: { id: true, academicYearId: true, program: { select: { type: true } } },
  });
  if (!targetExists) {
    return NextResponse.json({ error: "Kelas tujuan tidak ditemukan" }, { status: 404 });
  }

  // Refuse promotion into a class whose academic year is ARCHIVED — past
  // years are immutable for audit integrity.
  const yearGuard = await ensureYearWritableById(
    targetExists.academicYearId,
    session.tenantId,
    "Pilih kelas pada tahun ajaran yang aktif.",
  );
  if (yearGuard instanceof NextResponse) return yearGuard;

  // Find the source ACTIVE enrollment — scoped to the target's program type
  // (SEMESTER vs YEAR_ROUND) and to a non-ARCHIVED academic year.
  //
  // Program type, not academic year, is the stream key: a promote call only
  // carries `targetClassSectionId`, and a "promotion" ordinarily moves a
  // student from a class in one year into a class in the *next* year — so
  // matching the target's own academicYearId would almost never find the
  // source row. What must never happen is picking a stale ACTIVE row left
  // behind in an ARCHIVED year (16 of 21 current-year students carry one —
  // see cycle doc), so ARCHIVED years are excluded outright rather than
  // pinned to one specific year id.
  //
  // This does NOT guarantee at most one candidate. `lib/classes/year-guard.ts`
  // blocks only ARCHIVED, so a PLANNING (future) year is fully enrollable —
  // a student legitimately enrolled ahead into next year's class while this
  // year's row is still ACTIVE has TWO non-archived ACTIVE rows of the same
  // program type: one in the current ACTIVE year, one in the future PLANNING
  // year. `orderBy` below breaks that tie deterministically: it always picks
  // the row in the chronologically EARLIEST non-archived year, which is the
  // current (ACTIVE-status) year, never the future PLANNING one — a
  // "promotion" graduates the student out of where they are now, not out of
  // a class they haven't started yet.
  //
  // `findStreamConflict` (lib/enrollment/active.ts) doesn't fit here — it
  // takes a concrete `academicYearId` to look for a *conflicting* row before
  // a create, whereas this is a *lookup* of the row to graduate and the
  // relevant year isn't known in advance. A narrow inline query is scoped to
  // the route's own semantics instead of bending that helper's signature.
  const programType = targetExists.program.type;
  const currentEnrollment = await prisma.studentEnrollment.findFirst({
    where: {
      studentId,
      status: "ACTIVE",
      classSection: {
        academicYear: { NOT: { status: "ARCHIVED" } },
        program: { type: programType },
      },
    },
    orderBy: { classSection: { academicYear: { startDate: "asc" } } },
  });
  if (!currentEnrollment) {
    return NextResponse.json({ error: "Siswa belum terdaftar di kelas aktif" }, { status: 400 });
  }

  const today = getTodayInTimezone("Asia/Jakarta");

  // Transaction: lock target section row, re-check capacity, graduate old
  // enrollment, create/upsert new one. SELECT … FOR UPDATE prevents two
  // concurrent promotes from both seeing "one seat free" and overflowing.
  try {
    const newEnrollment = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; capacity: number; active_count: bigint }>
      >`
        SELECT cs.id, cs.capacity, COUNT(se.id)::int AS active_count
        FROM "ClassSection" cs
        LEFT JOIN "StudentEnrollment" se
          ON se."classSectionId" = cs.id AND se.status = 'ACTIVE'
        WHERE cs.id = ${targetClassSectionId}
        GROUP BY cs.id, cs.capacity
        FOR UPDATE OF cs
      `;
      if (rows.length === 0) {
        throw new PromoteError("Kelas tujuan tidak ditemukan", 404);
      }
      const activeCount = Number(rows[0].active_count);
      if (activeCount >= rows[0].capacity) {
        throw new PromoteError(
          `Kelas tujuan penuh (${activeCount}/${rows[0].capacity})`,
        );
      }

      await tx.studentEnrollment.update({
        where: { id: currentEnrollment.id },
        data: { status: "GRADUATED", notes: notes || undefined },
      });

      return tx.studentEnrollment.upsert({
        where: { studentId_classSectionId: { studentId, classSectionId: targetClassSectionId } },
        create: {
          studentId,
          classSectionId: targetClassSectionId,
          enrollDate: today,
          status: "ACTIVE",
          notes: notes || null,
        },
        update: {
          status: "ACTIVE",
          enrollDate: today,
          notes: notes || null,
        },
        include: {
          classSection: { select: { id: true, name: true } },
        },
      });
    });

    return NextResponse.json(newEnrollment, { status: 201 });
  } catch (err) {
    if (err instanceof PromoteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("promote:", err);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}

class PromoteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
