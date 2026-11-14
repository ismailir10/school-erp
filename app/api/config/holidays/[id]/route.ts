import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyTenantOwnership } from "@/lib/auth-guard";
import { holidaySchema } from "@/lib/validations/holiday";
import { reconcileSectionsForHoliday } from "@/lib/sessions/holiday-fanout";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`update-holiday:${getClientIp(req)}`, 20, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "settings.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!(await verifyTenantOwnership("holiday", id, session.tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = holidaySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }
  const { date, name, type, isHalfDay } = parsed.data;

  // Capture the pre-update date so a date change can reconcile BOTH the old
  // calendar day (which may regain a session) and the new one.
  const before = await prisma.holiday.findUnique({
    where: { id },
    select: { date: true },
  });

  const holiday = await prisma.holiday.update({
    where: { id },
    data: {
      date,
      name,
      type,
      isHalfDay: isHalfDay ?? false,
    },
  });

  // Reactive session generation: an edited holiday (date moved, or half-day
  // toggled) changes which sessions exist. Reconcile sections for the new date
  // AND the old date if it moved. The update above has already committed; a
  // fan-out failure is logged but never rolls back the holiday — reconcile is
  // idempotent and re-runnable.
  let reconcileWarning: string | undefined;
  try {
    const dates = new Set<string>([holiday.date]);
    if (before && before.date !== holiday.date) dates.add(before.date);
    let totalFailed = 0;
    for (const d of dates) {
      const { sectionsFailed } = await reconcileSectionsForHoliday(
        session.tenantId,
        d,
      );
      totalFailed += sectionsFailed;
    }
    if (totalFailed > 0) {
      reconcileWarning = `Sebagian sesi kelas gagal dibuat ulang (${totalFailed} kelas) — jalankan ulang dari pengaturan.`;
    }
  } catch (err) {
    console.error(
      `[holidays PUT] reconcileSectionsForHoliday failed for holiday ${id}:`,
      err,
    );
    reconcileWarning = "Sebagian sesi kelas gagal dibuat ulang — jalankan ulang dari pengaturan.";
  }

  return NextResponse.json(
    reconcileWarning ? { ...holiday, reconcileWarning } : holiday,
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`delete-holiday:${getClientIp(req)}`, 20, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "settings.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!(await verifyTenantOwnership("holiday", id, session.tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Capture the date before deletion so the fan-out knows which calendar day
  // to re-add sessions for.
  const before = await prisma.holiday.findUnique({
    where: { id },
    select: { date: true },
  });

  // Intentional hard delete — Holiday has no status field (config entity)
  await prisma.holiday.delete({ where: { id } });

  // Reactive session generation: removing a holiday turns its calendar day
  // back into a normal working day, so affected sections should re-add the
  // session for that date. The delete above has already committed; a fan-out
  // failure is logged but never rolls back the deletion — reconcile is
  // idempotent and re-runnable.
  let reconcileWarning: string | undefined;
  if (before) {
    try {
      const { sectionsFailed } = await reconcileSectionsForHoliday(
        session.tenantId,
        before.date,
      );
      if (sectionsFailed > 0) {
        reconcileWarning = `Sebagian sesi kelas gagal dibuat ulang (${sectionsFailed} kelas) — jalankan ulang dari pengaturan.`;
      }
    } catch (err) {
      console.error(
        `[holidays DELETE] reconcileSectionsForHoliday failed for holiday ${id} (date ${before.date}):`,
        err,
      );
      reconcileWarning = "Sebagian sesi kelas gagal dibuat ulang — jalankan ulang dari pengaturan.";
    }
  }

  return NextResponse.json(
    reconcileWarning ? { ok: true, reconcileWarning } : { ok: true },
  );
}
