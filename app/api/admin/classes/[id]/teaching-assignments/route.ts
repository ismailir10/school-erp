import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { teachingAssignmentAddSchema } from "@/lib/validations/class";
import { ensureYearWritableForClass } from "@/lib/classes/year-guard";
import { backfillSessionTeacher } from "@/lib/sessions/teacher-backfill";
import {
  CLASS_WRITE_BUDGET,
  CLASS_WRITE_WINDOW_MS,
  isUniqueViolation,
} from "../../_helpers";

// Manage which employees are assigned to a given class (ClassSection.id).
// HOMEROOM uniqueness is enforced at the route layer (only one HOMEROOM per
// section); ASSISTANT can repeat.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id: classId } = await ctx.params;

  const { success } = rateLimit(
    `class-teacher-add:${getClientIp(req)}`,
    CLASS_WRITE_BUDGET,
    CLASS_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const yearGuard = await ensureYearWritableForClass(classId, session.tenantId);
  if (yearGuard instanceof NextResponse) return yearGuard;

  const parsed = await validateBody(
    teachingAssignmentAddSchema,
    await req.json(),
  );
  if (parsed.error) return parsed.error;
  const { employeeId, role, replaceAssignmentId } = parsed.data;

  const classSection = await prisma.classSection.findFirst({
    where: { id: classId, tenantId: session.tenantId },
    select: { id: true, name: true },
  });
  if (!classSection) {
    return NextResponse.json(
      { error: "Kelas tidak ditemukan" },
      { status: 404 },
    );
  }

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId: session.tenantId },
    select: { id: true, nama: true },
  });
  if (!employee) {
    return NextResponse.json(
      { error: "Guru tidak ditemukan." },
      { status: 400 },
    );
  }

  try {
    // Advisory lock keyed on classId serialises HOMEROOM-uniqueness check +
    // create across concurrent requests for the same class. Same pattern as
    // the enrollment route. ASSISTANT inserts still pass through but the
    // unique (employeeId, classSectionId) constraint catches duplicates.
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${classId}))`;

      if (role === "HOMEROOM") {
        const existing = await tx.teachingAssignment.findFirst({
          where: {
            classSectionId: classId,
            role: "HOMEROOM",
            classSection: { tenantId: session.tenantId },
          },
          select: {
            id: true,
            employeeId: true,
            employee: { select: { id: true, nama: true } },
          },
        });
        if (replaceAssignmentId && existing?.id !== replaceAssignmentId) {
          throw new HomeroomExists({ existingAssignmentId: existing?.id ?? "", existingEmployeeId: existing?.employeeId ?? "", existingEmployeeName: existing?.employee.nama ?? "" });
        }
        if (existing && replaceAssignmentId === existing.id) {
          await tx.teachingAssignment.delete({ where: { id: existing.id } });
        } else if (existing) {
          throw new HomeroomExists({
            existingAssignmentId: existing.id,
            existingEmployeeId: existing.employeeId,
            existingEmployeeName: existing.employee.nama,
          });
        }
      }

      return tx.teachingAssignment.create({
        data: { employeeId, classSectionId: classId, role },
        select: {
          id: true,
          role: true,
          createdAt: true,
          employee: {
            select: { id: true, nama: true, formalName: true },
          },
        },
      });
    });

    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "TeachingAssignment",
      entityId: created.id,
      action: "class.teacher.add",
      after: {
        employeeId,
        classSectionId: classId,
        role,
        className: classSection.name,
      },
    });

    if (role === "HOMEROOM") {
      await syncSessionTeacher(classId, session.tenantId);
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof HomeroomExists) {
      return NextResponse.json(
        {
          error: "Kelas ini sudah memiliki wali kelas.",
          code: "HOMEROOM_EXISTS",
          ...err.detail,
        },
        { status: 409 },
      );
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          error: "Guru ini sudah ditugaskan pada kelas ini.",
          code: "ALREADY_ASSIGNED",
        },
        { status: 409 },
      );
    }
    throw err;
  }
}

/**
 * A class's sessions are generated once, so they keep whatever teacher the
 * class had at that moment — none, for a class whose wali kelas is assigned
 * afterwards. The teacher home reads sessions by teacher, so the new wali saw
 * "Belum ada sesi terjadwal" until an admin re-generated them (DOC-1).
 * Re-derives today-and-later, non-substituted sessions; idempotent.
 * Failure-isolated: the assignment is already saved, and a missed backfill is
 * repaired by the next assignment change.
 */
async function syncSessionTeacher(classId: string, tenantId: string) {
  try {
    await backfillSessionTeacher(classId, tenantId);
  } catch (err) {
    console.error(
      `[class teaching-assignments] backfillSessionTeacher failed for section ${classId}:`,
      err,
    );
  }
}

class HomeroomExists extends Error {
  constructor(
    public readonly detail: {
      existingAssignmentId: string;
      existingEmployeeId: string;
      existingEmployeeName: string;
    },
  ) {
    super("Kelas ini sudah memiliki wali kelas.");
    this.name = "HomeroomExists";
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id: classId } = await ctx.params;

  const { success } = rateLimit(
    `class-teacher-remove:${getClientIp(req)}`,
    CLASS_WRITE_BUDGET,
    CLASS_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const yearGuard = await ensureYearWritableForClass(classId, session.tenantId);
  if (yearGuard instanceof NextResponse) return yearGuard;

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  if (!employeeId) {
    return NextResponse.json(
      { error: "employeeId wajib disediakan." },
      { status: 400 },
    );
  }

  const assignment = await prisma.teachingAssignment.findFirst({
    where: {
      employeeId,
      classSectionId: classId,
      classSection: { tenantId: session.tenantId },
    },
    select: { id: true, role: true },
  });
  if (!assignment) {
    return NextResponse.json(
      { error: "Penugasan tidak ditemukan." },
      { status: 404 },
    );
  }

  await prisma.teachingAssignment.delete({ where: { id: assignment.id } });

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "TeachingAssignment",
    entityId: assignment.id,
    action: "class.teacher.remove",
    before: {
      employeeId,
      classSectionId: classId,
      role: assignment.role,
    },
  });

  if (assignment.role === "HOMEROOM") {
    await syncSessionTeacher(classId, session.tenantId);
  }

  return NextResponse.json({ ok: true });
}
