import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invalidateAdminHeaderContext } from "@/lib/admin/header-context-tag";
import { getSession, isAdminRole } from "@/lib/auth";
import { demoteOtherActiveYears } from "@/lib/academic-year/activate";
import { validateBody } from "@/lib/api/validate";
import { fieldErrorResponse, isUniqueViolation } from "@/lib/api/field-errors";
import { academicYearOverlapMessage, updateAcademicYearSchema } from "@/lib/validations/academic-year";

// Shared archive guard: block transition-to-ARCHIVED (whether via PUT
// status update or DELETE soft-delete) if any class section under the
// year still has ACTIVE student enrollments. Called from both PUT and
// DELETE so the two paths cannot diverge on the check.
async function getActiveEnrollmentBlocker(yearId: string): Promise<NextResponse | null> {
  const activeEnrollments = await prisma.studentEnrollment.count({
    where: { classSection: { academicYearId: yearId }, status: "ACTIVE" },
  });
  if (activeEnrollments > 0) {
    return NextResponse.json(
      { error: `Masih ada ${activeEnrollments} siswa aktif di tahun ajaran ini` },
      { status: 400 },
    );
  }
  return null;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  // Verify tenant ownership
  const existing = await prisma.academicYear.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!existing) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const parsed = await validateBody(updateAcademicYearSchema, await req.json().catch(() => null));
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  if (body.status === "ARCHIVED") {
    const blocker = await getActiveEnrollmentBlocker(id);
    if (blocker) return blocker;
  }

  // ADM-13: validate the effective range (body value, else the stored one)
  // when dates change or an archived year is being brought back — a plain
  // rename or status flip never trips on older overlapping data. An archived
  // year holds no dates anyone else must avoid, so it is never checked.
  const effectiveStatus = body.status ?? existing.status;
  const revivesArchived = existing.status === "ARCHIVED" && effectiveStatus !== "ARCHIVED";
  const datesChanged = body.startDate !== undefined || body.endDate !== undefined;
  if (effectiveStatus !== "ARCHIVED" && (datesChanged || revivesArchived)) {
    const startDate = body.startDate ?? existing.startDate;
    const endDate = body.endDate ?? existing.endDate;
    if (endDate < startDate) {
      return fieldErrorResponse("endDate", "Tanggal selesai harus setelah tanggal mulai", 400);
    }
    const overlapping = await prisma.academicYear.findFirst({
      where: {
        tenantId: session.tenantId,
        id: { not: id },
        status: { not: "ARCHIVED" },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { name: true },
    });
    if (overlapping) {
      return fieldErrorResponse("startDate", academicYearOverlapMessage(overlapping.name));
    }
  }

  // Undefined keys are omitted by Prisma — partial update preserves untouched
  // columns. `name` is already trimmed by the schema.
  const data = {
    name: body.name,
    startDate: body.startDate,
    endDate: body.endDate,
    status: body.status,
  };

  // Capture the narrowed tenantId — inside the transaction closure below TS
  // re-widens `session.tenantId` back to `string | null`.
  const tenantId = session.tenantId;

  // Activating this year must demote every other ACTIVE year for the tenant —
  // at most one ACTIVE year per tenant (single-active invariant). Atomic so a
  // failed update never leaves zero or two active years.
  try {
    const year =
      body.status === "ACTIVE"
        ? await prisma.$transaction(async (tx) => {
            await demoteOtherActiveYears(tx, tenantId, id);
            return tx.academicYear.update({ where: { id }, data });
          })
        : await prisma.academicYear.update({ where: { id }, data });
    invalidateAdminHeaderContext();
    return NextResponse.json(year);
  } catch (error) {
    // Renaming onto an existing (tenantId, name) — same field error as create.
    if (isUniqueViolation(error)) {
      return fieldErrorResponse("name", "Nama tahun ajaran sudah dipakai");
    }
    throw error;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  // Verify tenant ownership
  const existing = await prisma.academicYear.findFirst({ where: { id, tenantId: session.tenantId } });
  if (!existing) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  // DELETE archives the year (soft-delete). Apply the same active-enrollment
  // guard as PUT-to-ARCHIVED — the raw class-section-count check previously
  // here was stricter (blocked on any historical class section, even with
  // no active enrollments), which is inconsistent with the PUT semantics.
  const blocker = await getActiveEnrollmentBlocker(id);
  if (blocker) return blocker;

  // Soft delete — set status to ARCHIVED instead of hard delete
  await prisma.academicYear.update({ where: { id }, data: { status: "ARCHIVED" } });
  invalidateAdminHeaderContext();
  return NextResponse.json({ ok: true });
}
