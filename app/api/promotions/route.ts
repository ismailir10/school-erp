import { lockEnrollmentTopology, lockEnrollmentStreams } from "@/lib/enrollment/topology-lock";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { ensureYearWritableById } from "@/lib/classes/year-guard";

/**
 * Domain error whose message is safe to surface to the client. Anything else
 * thrown inside the transaction (Prisma/Postgres internals) must NOT leak —
 * the 0A000 incident put a raw `prisma.$queryRaw` invocation error straight
 * into the admin dialog.
 */
class PromotionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sourceClassSectionId = req.nextUrl.searchParams.get("sourceClassSectionId");
  if (!sourceClassSectionId) {
    return NextResponse.json({ error: "sourceClassSectionId wajib diisi" }, { status: 400 });
  }

  // Verify source class belongs to tenant
  const sourceSection = await prisma.classSection.findFirst({
    where: { id: sourceClassSectionId, tenantId: session.tenantId },
    select: { id: true, name: true, programId: true },
  });
  if (!sourceSection) {
    return NextResponse.json({ error: "Kelas asal tidak ditemukan" }, { status: 404 });
  }

  // Fetch all ACTIVE enrollments in source class with student data
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      classSectionId: sourceClassSectionId,
      status: "ACTIVE",
      student: { tenantId: session.tenantId },
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          nickname: true,
          nis: true,
          dateOfBirth: true,
          gender: true,
          status: true,
        },
      },
    },
    orderBy: { student: { name: "asc" } },
  });

  const students = enrollments.map((e) => ({
    enrollmentId: e.id,
    ...e.student,
  }));

  return NextResponse.json({
    sourceClass: sourceSection,
    students,
  });
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`bulk-promote:${getClientIp(req)}`, 5, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const { sourceClassSectionId, targetClassSectionId, excludeStudentIds } = await req.json();

  if (!sourceClassSectionId || !targetClassSectionId) {
    return NextResponse.json(
      { error: "Kelas asal dan kelas tujuan wajib dipilih" },
      { status: 400 }
    );
  }

  // Verify source class belongs to tenant
  const sourceSection = await prisma.classSection.findFirst({
    where: { id: sourceClassSectionId, tenantId: tenantId },
  });
  if (!sourceSection) {
    return NextResponse.json({ error: "Kelas asal tidak ditemukan" }, { status: 404 });
  }

  // Verify target class belongs to tenant. Capacity itself is re-checked and
  // row-locked inside the transaction below.
  const targetExists = await prisma.classSection.findFirst({
    where: { id: targetClassSectionId, tenantId: tenantId },
    select: { id: true, academicYearId: true, program: { select: { id: true, type: true } } },
  });
  if (!targetExists) {
    return NextResponse.json({ error: "Kelas tujuan tidak ditemukan" }, { status: 404 });
  }

  // Refuse promotion into a class whose academic year is ARCHIVED — past
  // years are immutable for audit integrity. The bulk-promote dialog has its
  // own year selector, but that is a client-side convenience, not a boundary.
  const yearGuard = await ensureYearWritableById(
    targetExists.academicYearId,
    tenantId,
    "Pilih kelas pada tahun ajaran yang aktif.",
  );
  if (yearGuard instanceof NextResponse) return yearGuard;

  const excluded = new Set<string>(excludeStudentIds || []);
  const today = getTodayInTimezone("Asia/Jakarta");

  // Shared topology → sorted student streams → target class. The first guard
  // freezes class programs; stream locks protect each student's target-year membership.
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await lockEnrollmentTopology(tx, tenantId, "shared");
      const target = await tx.classSection.findFirst({
        where: { id: targetClassSectionId, tenantId: tenantId },
        select: { id: true, academicYearId: true, program: { select: { id: true, type: true } } },
      });
      if (!target || target.academicYearId !== targetExists.academicYearId ||
          target.program.id !== targetExists.program.id || target.program.type !== targetExists.program.type) {
        throw new PromotionError("Program kelas baru saja berubah. Muat ulang lalu coba lagi.", 409);
      }
      const enrollments = await tx.studentEnrollment.findMany({
        where: { classSectionId: sourceClassSectionId, status: "ACTIVE", student: { tenantId: tenantId } },
      });
      const candidates = enrollments.filter((e) => !excluded.has(e.studentId));
      if (candidates.length === 0) return { promoted: 0, skipped: enrollments.length };
      await lockEnrollmentStreams(tx, candidates.map((e) => e.studentId), target.academicYearId, target.program.type);
      // A writer may have moved a source while these stream locks were pending.
      const toPromote = await tx.studentEnrollment.findMany({
        where: { id: { in: candidates.map((e) => e.id) }, classSectionId: sourceClassSectionId,
          status: "ACTIVE", student: { tenantId: tenantId } },
      });
      const skipped = enrollments.length - toPromote.length;
      if (toPromote.length === 0) return { promoted: 0, skipped };
      for (const e of toPromote) {
        const conflict = await tx.studentEnrollment.findFirst({
          where: { studentId: e.studentId, status: "ACTIVE", id: { notIn: toPromote.map((row) => row.id) },
            classSectionId: { not: targetClassSectionId },
            classSection: { academicYearId: target.academicYearId, program: { type: target.program.type } } },
          select: { classSection: { select: { name: true } } },
        });
        if (conflict) throw new PromotionError(`Siswa sudah terdaftar di kelas ${conflict.classSection.name} pada tahun ajaran ini.`, 409);
      }

      const rows = await tx.$queryRaw<
        Array<{ id: string; capacity: number; active_count: number }>
      >`
        SELECT cs.id, cs.capacity,
          (SELECT COUNT(*)::int FROM "StudentEnrollment" se
            WHERE se."classSectionId" = cs.id AND se.status = 'ACTIVE') AS active_count
        FROM "ClassSection" cs
        WHERE cs.id = ${targetClassSectionId}
        FOR UPDATE
      `;
      if (rows.length === 0) {
        throw new PromotionError("Kelas tujuan tidak ditemukan");
      }
      const capacity = rows[0].capacity;
      const currentActive = Number(rows[0].active_count);
      const activeTargets = await tx.studentEnrollment.count({
        where: { classSectionId: targetClassSectionId, status: "ACTIVE", studentId: { in: toPromote.map((e) => e.studentId) } },
      });
      const needed = currentActive + toPromote.length - activeTargets;
      if (needed > capacity) {
        throw new PromotionError(
          `Kapasitas kelas tujuan tidak cukup. Tersedia: ${capacity - currentActive}, dibutuhkan: ${toPromote.length}`,
        );
      }

      // Mark all old enrollments as GRADUATED
      await tx.studentEnrollment.updateMany({
        where: {
          id: { in: toPromote.map((e) => e.id) },
        },
        data: { status: "GRADUATED" },
      });

      // Upsert new ACTIVE enrollments
      for (const e of toPromote) {
        await tx.studentEnrollment.upsert({
          where: { studentId_classSectionId: { studentId: e.studentId, classSectionId: targetClassSectionId } },
          create: {
            studentId: e.studentId,
            classSectionId: targetClassSectionId,
            enrollDate: today,
            status: "ACTIVE",
          },
          update: {
            status: "ACTIVE",
            enrollDate: today,
          },
        });
      }
      return { promoted: toPromote.length, skipped };
    });
    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof PromotionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[promotions POST] transaction failed:", err);
    return NextResponse.json(
      { error: "Gagal memproses naik kelas. Coba lagi." },
      { status: 500 },
    );
  }
}
