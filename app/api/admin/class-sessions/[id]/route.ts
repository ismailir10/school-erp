import { requirePermission } from "@/lib/auth-guards";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { JAKARTA_TZ } from "@/lib/sessions/dates";
import { validateBody } from "@/lib/api/validate";
import { swapClassSessionTeacherSchema } from "@/lib/validations/class-session";

/**
 * PATCH /api/admin/class-sessions/[id] — swap the EFFECTIVE teacher on one
 * ClassSession (academic-hierarchy-refactor Task 6).
 *
 * Behaviour:
 *  - Sets `teacherId` to the new effective teacher (may be a substitute, or
 *    null to clear). `substituteReason` follows the body (cleared when absent).
 *  - NEVER touches `defaultTeacherId` — it stays as the homeroom snapshot for
 *    audit. A "revert to homeroom" is simply `teacherId === defaultTeacherId`
 *    with no reason; no special-casing needed.
 *  - If the session's date is in the past (Jakarta-tz), also flags
 *    `isBackfilled = true` — a past-date edit is a backfill by definition.
 *  - Records an audit row (entity "ClassSession", action "swap_teacher").
 *
 * It does NOT call reconcile: a teacher swap changes WHO teaches a session,
 * never WHICH sessions exist.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth runs before rate-limit so an unauthenticated burst can't drain the
  // per-IP budget and lock out a legitimate admin behind the same NAT/proxy.
  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { success } = rateLimit(
    `swap-class-session-teacher:${getClientIp(req)}`,
    20,
    60_000,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const { id } = await params;

  const result = await validateBody(swapClassSessionTeacherSchema, await req.json());
  if (result.error) return result.error;
  const body = result.data;

  // Tenant scope: ClassSession has no tenantId column — resolve through the
  // parent ClassSection. A cross-tenant id simply fails to match → 404.
  const existing = await prisma.classSession.findFirst({
    where: { id, classSection: { tenantId: session.tenantId } },
    select: {
      id: true,
      date: true,
      teacherId: true,
      defaultTeacherId: true,
      substituteReason: true,
      isBackfilled: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  }

  // A non-null effective teacher must belong to the caller's tenant — guards
  // against pointing a session at a cross-tenant Employee id.
  if (body.teacherId) {
    const teacher = await prisma.employee.findFirst({
      where: { id: body.teacherId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!teacher) {
      return NextResponse.json(
        { error: "Guru tidak ditemukan." },
        { status: 400 },
      );
    }
  }

  // A genuine substitution (effective teacher ≠ the homeroom snapshot,
  // INCLUDING clearing to null) must carry a reason — otherwise the swap
  // lands with an empty audit trail. A revert to homeroom
  // (teacherId === defaultTeacherId) needs no reason and clears any stale one.
  //
  // This rule cannot live in `swapClassSessionTeacherSchema`: it needs
  // `existing.defaultTeacherId`, which only this DB read knows — trusting a
  // client-supplied `defaultTeacherId` instead would let a caller bypass the
  // reason requirement outright. It stays an in-route check, but returns the
  // same `{ error, errors: [{ field, message }] }` shape `validateBody`
  // produces so the client's `applyServerErrors` maps it onto the field.
  const isSubstitution = body.teacherId !== existing.defaultTeacherId;
  const trimmedReason = body.substituteReason?.trim();
  if (isSubstitution && !trimmedReason) {
    const message = "Alasan pengganti wajib diisi untuk pergantian guru.";
    return NextResponse.json(
      { error: message, errors: [{ field: "substituteReason", message }] },
      { status: 400 },
    );
  }
  const substituteReason = isSubstitution ? trimmedReason! : null;

  // Past-date edit ⇒ backfill. We OR with the existing flag so a row that was
  // already backfilled stays backfilled even if today's swap is for a future
  // date (it shouldn't un-set history).
  const isPast = existing.date < getTodayInTimezone(JAKARTA_TZ);
  const isBackfilled = existing.isBackfilled || isPast;

  const updated = await prisma.classSession.update({
    where: { id },
    data: {
      teacherId: body.teacherId,
      substituteReason,
      isBackfilled,
    },
    select: {
      id: true,
      classSectionId: true,
      semesterId: true,
      date: true,
      slot: true,
      teacherId: true,
      defaultTeacherId: true,
      substituteReason: true,
      isBackfilled: true,
      teacher: { select: { id: true, nama: true } },
      defaultTeacher: { select: { id: true, nama: true } },
    },
  });

  await recordAudit({
    tenantId: session.tenantId,
    actorId: session.id,
    entity: "ClassSession",
    entityId: id,
    action: "swap_teacher",
    before: {
      teacherId: existing.teacherId,
      substituteReason: existing.substituteReason,
    },
    after: {
      teacherId: updated.teacherId,
      substituteReason: updated.substituteReason,
    },
  });

  return NextResponse.json(updated);
}
