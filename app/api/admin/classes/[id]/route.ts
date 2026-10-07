import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { classUpdateSchema } from "@/lib/validations/class";
import { ensureYearWritableForClass } from "@/lib/classes/year-guard";
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
      if (capacityChanging) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const activeCount = await tx.studentEnrollment.count({
          where: { classSectionId: id, status: "ACTIVE" },
        });
        if (activeCount > (body.capacity as number)) {
          throw new CapacityBelowRoster(activeCount);
        }
      }
      await tx.classSection.updateMany({
        where: { id, tenantId: session.tenantId },
        data,
      });
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
      action: auditActionForUpdate(body),
      before: {
        name: before.name,
        capacity: before.capacity,
        slotTemplate: before.slotTemplate,
        ageGroup: before.ageGroup,
        status: before.status,
      },
      after: {
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
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        {
          error:
            "Kelas dengan nama ini sudah ada di kampus dan tahun ajaran tersebut.",
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
