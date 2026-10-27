import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { classUpdateSchema } from "@/lib/validations/class";
import { ensureYearWritableForClass } from "@/lib/classes/year-guard";
import {
  CLASS_NAME_CLASH_MESSAGE,
  findClassNameClash,
} from "@/lib/classes/name-clash";
import {
  countInvoicedStudents,
  findTypeChangeConflict,
  programChangeInvoicedMessage,
  typeChangeConflictMessage,
} from "@/lib/classes/program-change";
import {
  auditActionForUpdate,
  CLASS_WRITE_BUDGET,
  CLASS_WRITE_WINDOW_MS,
  classDetailSelect,
  classListSelect,
  isUniqueViolation,
  rosterEnrollmentVisible,
} from "../_helpers";

class CapacityBelowRoster extends Error {
  constructor(readonly activeCount: number) {
    super("CAPACITY_BELOW_ROSTER");
  }
}

class ProgramHasInvoices extends Error {
  constructor(readonly invoicedStudents: number) {
    super("PROGRAM_HAS_INVOICES");
  }
}

class ProgramTypeConflict extends Error {
  constructor(readonly detail: string) {
    super("PROGRAM_TYPE_CONFLICT");
  }
}

class ClassChangedMeanwhile extends Error {
  constructor() {
    super("CLASS_CHANGED_MEANWHILE");
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const row = await prisma.classSection.findFirst({
    where: { id, tenantId: session.tenantId },
    select: classDetailSelect,
  });
  if (!row) {
    return NextResponse.json(
      { error: "Kelas tidak ditemukan" },
      { status: 404 },
    );
  }
  // Year-aware roster: current-year classes show only ACTIVE enrollments; a
  // past (non-ACTIVE) year shows its GRADUATED cohort. WITHDRAWN already
  // excluded by the query.
  const visibleEnrollments = row.enrollments.filter((e) =>
    rosterEnrollmentVisible(e.status, row.academicYear.status),
  );
  return NextResponse.json({
    ...row,
    enrollments: visibleEnrollments,
    enrolledCount: visibleEnrollments.length,
  });
}

async function update(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const { success } = rateLimit(
    `class-update:${getClientIp(req)}`,
    CLASS_WRITE_BUDGET,
    CLASS_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const yearGuard = await ensureYearWritableForClass(id, session.tenantId);
  if (yearGuard instanceof NextResponse) return yearGuard;

  const before = await prisma.classSection.findFirst({
    where: { id, tenantId: session.tenantId },
    select: {
      id: true,
      name: true,
      capacity: true,
      slotTemplate: true,
      ageGroup: true,
      status: true,
      classTrackId: true,
      academicYearId: true,
      campusId: true,
      programId: true,
      program: { select: { type: true } },
      academicYear: { select: { startDate: true } },
    },
  });
  if (!before) {
    return NextResponse.json(
      { error: "Kelas tidak ditemukan" },
      { status: 404 },
    );
  }

  const result = await validateBody(classUpdateSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.capacity !== undefined) data.capacity = body.capacity;
  if (body.slotTemplate !== undefined) data.slotTemplate = body.slotTemplate;
  if (body.ageGroup !== undefined) data.ageGroup = body.ageGroup;
  if (body.status !== undefined) data.status = body.status;

  // Sending the class's current program is a no-op, not a change.
  const programChanging =
    body.programId !== undefined && body.programId !== before.programId;
  let nextProgram: { id: string; type: string } | null = null;
  if (programChanging) {
    nextProgram = await prisma.program.findFirst({
      where: { id: body.programId, tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true, type: true },
    });
    if (!nextProgram) {
      const message = "Program tidak ditemukan atau tidak aktif.";
      return NextResponse.json(
        {
          error: message,
          field: "programId",
          errors: [{ field: "programId", message }],
        },
        { status: 400 },
      );
    }
    data.programId = body.programId;
  }

  // Renames are unique ignoring case within the year + campus. The check runs
  // whenever the name is sent but differs from the stored one (a case-only
  // change of the same class passes: excludeId keeps it from clashing with
  // itself). The DB unique stays as the race backstop (isUniqueViolation).
  if (body.name !== undefined && body.name.trim() !== before.name) {
    const clash = await findClassNameClash(prisma, {
      tenantId: session.tenantId,
      academicYearId: before.academicYearId,
      campusId: before.campusId,
      name: body.name,
      excludeId: id,
    });
    if (clash) {
      return NextResponse.json(
        {
          error: CLASS_NAME_CLASH_MESSAGE,
          field: "name",
          // Same shape as the capacity 409 so applyServerErrors lands it
          // inline on the Nama field.
          errors: [{ field: "name", message: CLASS_NAME_CLASH_MESSAGE }],
        },
        { status: 409 },
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Tidak ada perubahan" },
      { status: 400 },
    );
  }

  // Lowering capacity below the ACTIVE roster would render "2/1". Only checked
  // when the value actually changes, so an unrelated edit (name, slot) on an
  // already-overfull class is not blocked. Runs inside the transaction under
  // the same advisory lock the enrol routes take, so a concurrent enrol cannot
  // slip in between the count and the write.
  const capacityChanging =
    body.capacity !== undefined && body.capacity !== before.capacity;

  try {
    await prisma.$transaction(async (tx) => {
      if (programChanging && nextProgram) {
        // Serialises against enrolments and other edits of this class. Invoice
        // creation takes no such lock, so the invoice check narrows the race
        // with a billing commit rather than closing it.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const invoicedStudents = await countInvoicedStudents(tx, {
          tenantId: session.tenantId,
          classSectionId: id,
          academicYearId: before.academicYearId,
          yearStartDate: before.academicYear.startDate,
        });
        if (invoicedStudents > 0) throw new ProgramHasInvoices(invoicedStudents);
        const conflict = await findTypeChangeConflict(tx, {
          classSectionId: id,
          academicYearId: before.academicYearId,
          currentType: before.program.type,
          nextType: nextProgram.type,
        });
        if (conflict) throw new ProgramTypeConflict(typeChangeConflictMessage(conflict));
      }
      if (capacityChanging) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const activeCount = await tx.studentEnrollment.count({
          where: { classSectionId: id, status: "ACTIVE" },
        });
        if (activeCount > (body.capacity as number)) {
          throw new CapacityBelowRoster(activeCount);
        }
      }
      // A program change only lands on the program the admin was looking at:
      // someone else moving the class first makes this a conflict, not a
      // silent overwrite with a wrong audit `before`.
      const written = await tx.classSection.updateMany({
        where: {
          id,
          tenantId: session.tenantId,
          ...(programChanging ? { programId: before.programId } : {}),
        },
        data,
      });
      if (programChanging && written.count === 0) throw new ClassChangedMeanwhile();
      // Reactivating an INACTIVE section should also reactivate its parent
      // ClassTrack if the track was incidentally marked INACTIVE; otherwise
      // the unique-key upsert in POST would fail for a new section in the
      // same lineage.
      if (body.status === "ACTIVE" && before.classTrackId) {
        await tx.classTrack.updateMany({
          where: {
            id: before.classTrackId,
            tenantId: session.tenantId,
            status: "INACTIVE",
          },
          data: { status: "ACTIVE" },
        });
      }
    });
    const updated = await prisma.classSection.findFirstOrThrow({
      where: { id, tenantId: session.tenantId },
      select: classListSelect,
    });
    await recordAudit({
      tenantId: session.tenantId,
      actorId: session.id,
      entity: "ClassSection",
      entityId: id,
      action: programChanging ? "class.program_change" : auditActionForUpdate(body),
      before: {
        programId: before.programId,
        name: before.name,
        capacity: before.capacity,
        slotTemplate: before.slotTemplate,
        ageGroup: before.ageGroup,
        status: before.status,
      },
      after: {
        programId: updated.programId,
        name: updated.name,
        capacity: updated.capacity,
        slotTemplate: updated.slotTemplate,
        ageGroup: updated.ageGroup,
        status: updated.status,
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof CapacityBelowRoster) {
      const message = `Kapasitas tidak bisa lebih kecil dari jumlah siswa aktif (${err.activeCount} siswa).`;
      return NextResponse.json(
        {
          error: message,
          field: "capacity",
          // Same shape as the validateBody 400 so applyServerErrors can land
          // the message inline on the Kapasitas field.
          errors: [{ field: "capacity", message }],
        },
        { status: 409 },
      );
    }
    if (err instanceof ProgramHasInvoices) {
      const message = programChangeInvoicedMessage(err.invoicedStudents);
      return NextResponse.json(
        {
          error: message,
          field: "programId",
          code: "PROGRAM_HAS_INVOICES",
          errors: [{ field: "programId", message }],
        },
        { status: 409 },
      );
    }
    if (err instanceof ProgramTypeConflict) {
      return NextResponse.json(
        {
          error: err.detail,
          field: "programId",
          code: "PROGRAM_TYPE_CONFLICT",
          errors: [{ field: "programId", message: err.detail }],
        },
        { status: 409 },
      );
    }
    if (err instanceof ClassChangedMeanwhile) {
      const message = "Kelas ini baru saja diubah orang lain. Muat ulang lalu coba lagi.";
      return NextResponse.json(
        { error: message, field: "programId", errors: [{ field: "programId", message }] },
        { status: 409 },
      );
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          error: CLASS_NAME_CLASH_MESSAGE,
          field: "name",
          errors: [{ field: "name", message: CLASS_NAME_CLASH_MESSAGE }],
        },
        { status: 409 },
      );
    }
    throw err;
  }
}

export const PUT = update;
export const PATCH = update;

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await ctx.params;

  const { success } = rateLimit(
    `class-delete:${getClientIp(req)}`,
    CLASS_WRITE_BUDGET,
    CLASS_WRITE_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const yearGuard = await ensureYearWritableForClass(id, session.tenantId);
  if (yearGuard instanceof NextResponse) return yearGuard;

  const before = await prisma.classSection.findFirst({
    where: { id, tenantId: session.tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });
  if (!before) {
    return NextResponse.json(
      { error: "Kelas tidak ditemukan" },
      { status: 404 },
    );
  }

  await prisma.classSection.updateMany({
    where: { id, tenantId: session.tenantId },
    data: { status: "INACTIVE" },
  });
  const updated = await prisma.classSection.findFirstOrThrow({
    where: { id, tenantId: session.tenantId },
    select: classListSelect,
  });

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "ClassSection",
    entityId: id,
    action: "class.delete",
    before: {
      name: before.name,
      status: before.status,
      activeEnrollmentCount: before._count.enrollments,
    },
    after: { name: updated.name, status: updated.status },
  });
  return NextResponse.json({
    ok: true,
    activeEnrollmentCount: before._count.enrollments,
  });
}
