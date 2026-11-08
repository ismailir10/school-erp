import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { validateBody } from "@/lib/api/validate";
import { rateLimit } from "@/lib/rate-limit";
import { ATTENDANCE_TAP_BUDGET, ATTENDANCE_TAP_WINDOW_MS } from "@/lib/api/rate-limit-budgets";
import {
  attendanceDailyQuerySchema,
  attendanceDailySetSchema,
  attendanceDailyUndoSchema,
} from "@/lib/validations/attendance";
import { DAILY_FUTURE_ERROR, defaultCheckIn, getTenantClock } from "@/lib/attendance/daily";

/**
 * Absensi Staf Harian (docs/cycles/2026-11-07-attendance-geofence-gate.md).
 *
 * GET    ?date=&campusId=   every ACTIVE employee of the tenant with that day's record
 * PUT    { employeeId, date, status }   quick status (Hadir/Sakit/Izin/Alpa), source ADMIN
 * DELETE { ids }            undo of a bulk: removes only unlocked, admin-created rows
 *
 * All require attendance.override; tenant scope goes through employee.tenantId.
 */

export async function GET(req: NextRequest) {
  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const tenantId = session.tenantId!;

  const { searchParams } = new URL(req.url);
  const parsed = await validateBody(attendanceDailyQuerySchema, {
    date: searchParams.get("date") ?? undefined,
    campusId: searchParams.get("campusId") ?? undefined,
  });
  if (parsed.error) return parsed.error;

  const clock = await getTenantClock(tenantId);
  const date = parsed.data.date ?? clock.today;
  const campusId = parsed.data.campusId && parsed.data.campusId !== "all" ? parsed.data.campusId : undefined;

  const employees = await prisma.employee.findMany({
    where: { tenantId, status: "ACTIVE", ...(campusId ? { campusId } : {}) },
    select: {
      id: true,
      kode: true,
      nama: true,
      jabatan: true,
      campusId: true,
      campus: { select: { name: true } },
      attendanceRecords: {
        where: { date },
        select: {
          id: true,
          status: true,
          checkInTime: true,
          source: true,
          approvalStatus: true,
          isLocked: true,
        },
      },
    },
    orderBy: { nama: "asc" },
  });

  const rows = employees.map((emp) => {
    const rec = emp.attendanceRecords[0] ?? null;
    return {
      employee: {
        id: emp.id,
        kode: emp.kode,
        nama: emp.nama,
        jabatan: emp.jabatan,
        campusId: emp.campusId,
        campusName: emp.campus.name,
      },
      attendance: rec
        ? {
            id: rec.id,
            status: rec.status,
            checkInTime: rec.checkInTime?.toISOString() ?? null,
            source: rec.source,
            approvalStatus: rec.approvalStatus,
            isLocked: rec.isLocked,
          }
        : null,
    };
  });

  return NextResponse.json({ date, today: clock.today, timezone: clock.timezone, rows });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const tenantId = session.tenantId!;

  const { success } = rateLimit(
    `attendance-daily-put:${session.id}`,
    ATTENDANCE_TAP_BUDGET,
    ATTENDANCE_TAP_WINDOW_MS,
  );
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const raw: unknown = await req.json().catch(() => null);
  if (raw === null) return NextResponse.json({ error: "Body harus JSON valid" }, { status: 400 });
  const parsed = await validateBody(attendanceDailySetSchema, raw);
  if (parsed.error) return parsed.error;
  const { employeeId, date, status } = parsed.data;

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!employee) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const clock = await getTenantClock(tenantId);
  // Sick/permission can be pre-recorded; presence/absence describes observed days.
  if (date > clock.today && (status === "PRESENT" || status === "ABSENT")) {
    return NextResponse.json({ error: DAILY_FUTURE_ERROR }, { status: 400 });
  }

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date } },
    select: { id: true, isLocked: true, checkInTime: true },
  });
  if (existing?.isLocked) {
    return NextResponse.json({ error: "Record terkunci (payroll sudah disetujui)" }, { status: 400 });
  }

  const now = new Date();
  // Hadir with no arrival time yet gets the work start, so it never reads as late.
  const checkInTime =
    status === "PRESENT" && !existing?.checkInTime
      ? defaultCheckIn(date, clock.workStartTime, clock.timezone)
      : undefined;
  const common = {
    status,
    source: "ADMIN",
    recordedBy: session.id,
    approvalStatus: "APPROVED",
    isManualOverride: true,
    overrideReason: "Absensi Staf Harian",
    overriddenBy: session.id,
    overriddenAt: now,
  };

  const record = await prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: { ...common, ...(checkInTime ? { checkInTime } : {}) },
    create: { employeeId, date, ...common, ...(checkInTime ? { checkInTime } : {}) },
    select: {
      id: true,
      status: true,
      checkInTime: true,
      source: true,
      approvalStatus: true,
      isLocked: true,
    },
  });

  return NextResponse.json({
    id: record.id,
    status: record.status,
    checkInTime: record.checkInTime?.toISOString() ?? null,
    source: record.source,
    approvalStatus: record.approvalStatus,
    isLocked: record.isLocked,
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const raw: unknown = await req.json().catch(() => null);
  if (raw === null) return NextResponse.json({ error: "Body harus JSON valid" }, { status: 400 });
  const parsed = await validateBody(attendanceDailyUndoSchema, raw);
  if (parsed.error) return parsed.error;

  // Only what a bulk creates: admin-recorded, not an override, not locked.
  const result = await prisma.attendanceRecord.deleteMany({
    where: {
      id: { in: parsed.data.ids },
      source: "ADMIN",
      isManualOverride: false,
      isLocked: false,
      employee: { tenantId: session.tenantId! },
    },
  });

  return NextResponse.json({ count: result.count });
}
