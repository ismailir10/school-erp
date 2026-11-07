import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit } from "@/lib/rate-limit";
import { attendanceDailyBulkSchema } from "@/lib/validations/attendance";
import { DAILY_FUTURE_ERROR, defaultCheckIn, getTenantClock } from "@/lib/attendance/daily";

// POST { date, campusId? } — "Tandai semua hadir": a PRESENT record for every
// ACTIVE employee (of the campus, if given) who has NO record that day yet.
// Never touches an existing record. Returns the created ids for the undo toast.
export async function POST(req: NextRequest) {
  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const tenantId = session.tenantId!;

  const { success } = rateLimit(`attendance-daily-bulk:${session.id}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const raw: unknown = await req.json().catch(() => null);
  if (raw === null) return NextResponse.json({ error: "Body harus JSON valid" }, { status: 400 });
  const parsed = await validateBody(attendanceDailyBulkSchema, raw);
  if (parsed.error) return parsed.error;
  const { date } = parsed.data;
  const campusId = parsed.data.campusId && parsed.data.campusId !== "all" ? parsed.data.campusId : undefined;

  const clock = await getTenantClock(tenantId);
  if (date > clock.today) return NextResponse.json({ error: DAILY_FUTURE_ERROR }, { status: 400 });

  const unmarked = await prisma.employee.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      ...(campusId ? { campusId } : {}),
      attendanceRecords: { none: { date } },
    },
    select: { id: true },
  });
  if (unmarked.length === 0) return NextResponse.json({ count: 0, ids: [] });

  const employeeIds = unmarked.map((e) => e.id);
  const checkInTime = defaultCheckIn(date, clock.workStartTime, clock.timezone);
  // skipDuplicates: a row that appeared since the lookup is left alone.
  await prisma.attendanceRecord.createMany({
    data: employeeIds.map((employeeId) => ({
      employeeId,
      date,
      status: "PRESENT",
      checkInTime,
      source: "ADMIN",
      recordedBy: session.id,
      approvalStatus: "APPROVED",
    })),
    skipDuplicates: true,
  });

  const created = await prisma.attendanceRecord.findMany({
    where: {
      date,
      employeeId: { in: employeeIds },
      source: "ADMIN",
      recordedBy: session.id,
      isManualOverride: false,
    },
    select: { id: true },
  });

  return NextResponse.json({ count: created.length, ids: created.map((r) => r.id) });
}
