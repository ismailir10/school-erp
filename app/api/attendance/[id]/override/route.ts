import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { verifyTenantOwnership } from "@/lib/auth-guard";
import { validateBody } from "@/lib/api/validate";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import {
  attendanceOverrideSchema,
  attendanceOverrideUpdateSchema,
} from "@/lib/validations/attendance";
import { localTimeExists, zonedDateTimeToUtc } from "@/lib/attendance/timezone";

const NONEXISTENT_TIME_ERROR =
  "Jam itu tidak ada pada tanggal tersebut di zona waktu sekolah. Pilih jam lain.";

// The school's configured timezone for this tenant (same fallback as check-in).
async function getTenantTimezone(tenantId: string): Promise<string> {
  const orgConfig = await prisma.orgConfig.findUnique({ where: { tenantId } });
  return orgConfig?.timezone ?? "Asia/Jakarta";
}

// PUT updates an existing record by id; date is immutable.
// checkInTime is `HH:MM` school-local (modal) or, for legacy callers, a full
// datetime with or without offset — see attendanceOverrideUpdateSchema.

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`attendance-override-put:${getClientIp(req)}`, 30, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id } = await params;

  if (!(await verifyTenantOwnership("attendanceRecord", id, session.tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON valid" }, { status: 400 });
  }

  const result = await validateBody(attendanceOverrideUpdateSchema, rawBody);
  if (result.error) return result.error;
  const { status, checkInTime, checkOutTime, reason } = result.data;

  const existing = await prisma.attendanceRecord.findUnique({ where: { id } });
  if (existing?.isLocked) {
    return NextResponse.json(
      { error: "Record terkunci (payroll sudah disetujui)" },
      { status: 400 }
    );
  }

  let checkInAt: Date | undefined;
  if (checkInTime) {
    if (/^\d{2}:\d{2}$/.test(checkInTime)) {
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const timezone = await getTenantTimezone(session.tenantId!);
      if (!localTimeExists(existing.date, checkInTime, timezone)) {
        return NextResponse.json({ error: NONEXISTENT_TIME_ERROR }, { status: 400 });
      }
      checkInAt = zonedDateTimeToUtc(existing.date, checkInTime, timezone);
    } else {
      checkInAt = new Date(checkInTime);
    }
  }

  const record = await prisma.attendanceRecord.update({
    where: { id },
    data: {
      status,
      checkInTime: checkInAt,
      checkOutTime: checkOutTime ? new Date(checkOutTime) : undefined,
      isManualOverride: true,
      overrideReason: reason,
      overriddenBy: session.id,
      overriddenAt: new Date(),
    },
  });

  return NextResponse.json(record);
}

// Create/update attendance record (for days with no record) — id = employeeId
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`attendance-override-post:${getClientIp(req)}`, 30, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const auth = await requirePermission("attendance.override");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id: employeeId } = await params;

  if (!(await verifyTenantOwnership("employee", employeeId, session.tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON valid" }, { status: 400 });
  }

  const result = await validateBody(attendanceOverrideSchema, rawBody);
  if (result.error) return result.error;
  const { date, status, checkInTime, reason } = result.data;

  // Mirror the PUT guard at line 58: a payroll-locked record cannot be
  // overwritten by re-hitting POST on the same {employeeId, date} composite key.
  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date } },
  });
  if (existing?.isLocked) {
    return NextResponse.json(
      { error: "Record terkunci (payroll sudah disetujui)" },
      { status: 400 }
    );
  }

  let checkInAt: Date | undefined;
  if (checkInTime) {
    const timezone = await getTenantTimezone(session.tenantId!);
    if (!localTimeExists(date, checkInTime, timezone)) {
      return NextResponse.json({ error: NONEXISTENT_TIME_ERROR }, { status: 400 });
    }
    checkInAt = zonedDateTimeToUtc(date, checkInTime, timezone);
  }

  const record = await prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: {
      status,
      checkInTime: checkInAt,
      isManualOverride: true,
      overrideReason: reason,
      overriddenBy: session.id,
      overriddenAt: new Date(),
    },
    create: {
      employeeId,
      date,
      status,
      checkInTime: checkInAt,
      isManualOverride: true,
      overrideReason: reason,
      overriddenBy: session.id,
      overriddenAt: new Date(),
    },
  });

  return NextResponse.json(record);
}
