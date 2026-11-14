import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { holidaySchema } from "@/lib/validations/holiday";
import { reconcileSectionsForHoliday } from "@/lib/sessions/holiday-fanout";

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json([], { status: 401 });
  // HR-16: only the admin holiday / employee-attendance screens call this.
  if (!isAdminRole(session.role) || !(hasPermission(session, "settings.view") || hasPermission(session, "attendance.view"))) return NextResponse.json([], { status: 403 });

  const holidays = await prisma.holiday.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { date: "asc" },
  });

  return NextResponse.json(holidays);
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-holiday:${getClientIp(req)}`, 20, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "settings.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = holidaySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }
  const { date, name, type, isHalfDay } = parsed.data;

  // Check duplicate
  const existing = await prisma.holiday.findUnique({
    where: { tenantId_date: { tenantId: session.tenantId, date } },
  });
  if (existing) {
    return NextResponse.json({ error: "Tanggal sudah ada" }, { status: 400 });
  }

  const holiday = await prisma.holiday.create({
    data: {
      tenantId: session.tenantId,
      date,
      name,
      type,
      isHalfDay: isHalfDay ?? false,
    },
  });

  // Reactive session generation: a new holiday changes the working-day set,
  // so every ClassSection in an academic year whose Semester covers this date
  // must be reconciled (a full-day holiday removes the now-skipped empty
  // session; a half-day collapses it to a MORNING slot). The create above has
  // already committed; a fan-out failure is logged but never rolls back the
  // holiday — reconcile is idempotent and re-runnable.
  let reconcileWarning: string | undefined;
  try {
    const { sectionsFailed } = await reconcileSectionsForHoliday(
      session.tenantId,
      date,
    );
    if (sectionsFailed > 0) {
      reconcileWarning = `Sebagian sesi kelas gagal dibuat ulang (${sectionsFailed} kelas) — jalankan ulang dari pengaturan.`;
    }
  } catch (err) {
    console.error(
      `[holidays POST] reconcileSectionsForHoliday failed for date ${date}:`,
      err,
    );
    reconcileWarning = "Sebagian sesi kelas gagal dibuat ulang — jalankan ulang dari pengaturan.";
  }

  return NextResponse.json(
    reconcileWarning ? { ...holiday, reconcileWarning } : holiday,
    { status: 201 },
  );
}
