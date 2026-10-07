import { z } from "zod";
import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { parseWorkingDays } from "@/lib/payroll/working-days";
import { validateBody } from "@/lib/api/validate";
import { balancePeriodStart, isBalancedLeaveType, leaveTypeLabel, sumLeaveDays } from "@/lib/leave/balance";

// Body is `{ note? }` — the note is optional, but the body itself must be JSON
// (an empty/garbled body used to throw out of `req.json()` as a raw 500).
const approveBodySchema = z.object({ note: z.string().trim().max(500).nullish() });

const ALREADY_PROCESSED = "Pengajuan ini sudah diproses.";

const DAY_MAP: Record<number, string> = {
  0: "SUN", 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("leave.approve");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!hasPermission(session, "hr.view")) return NextResponse.json({ error: "forbidden", missing: "hr.view" }, { status: 403 });

  const { id } = await params;
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  }
  const parsed = await validateBody(approveBodySchema, rawBody);
  if (parsed.error) return parsed.error;
  const note = parsed.data.note || null;

  const request = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: { select: { tenantId: true } } },
  });

  if (!request || request.employee.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (request.status !== "PENDING") {
    return NextResponse.json({ error: "Hanya pengajuan PENDING yang bisa disetujui" }, { status: 400 });
  }

  // F-08: holiday-aware attendance creation. Previous loop skipped weekends
  // only — approved leave that spanned a public holiday wrote a LEAVE row
  // for the holiday, double-counting against payroll's holiday-aware day
  // arithmetic.
  const [orgConfig, holidays] = await Promise.all([
    prisma.orgConfig.findUnique({
      where: { tenantId: session.tenantId! },
      select: { workingDays: true },
    }),
    prisma.holiday.findMany({
      where: {
        tenantId: session.tenantId!,
        date: { gte: request.startDate, lte: request.endDate },
      },
      select: { date: true },
    }),
  ]);
  const workingDayCodes = parseWorkingDays(orgConfig?.workingDays);
  const effectiveWorkingDays =
    workingDayCodes.length > 0 ? workingDayCodes : ["MON", "TUE", "WED", "THU", "FRI"];
  // Normalise to YYYY-MM-DD to defend against any historical row that wasn't
  // inserted via the API's Zod path (e.g. direct SQL imports). Set lookup
  // would silently miss a non-truncated value otherwise.
  const holidaySet = new Set(holidays.map((h) => h.date.slice(0, 10)));

  // Atomic: re-check balance + claim the request + create attendance records.
  const outcome = await prisma.$transaction(async (tx) => {
    // STR-5: serialise approvals per employee so two requests approved at once
    // cannot both pass the balance check below (default isolation would let
    // each see the other as still PENDING).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"leave_approve_" + request.employeeId}))`;

    // Approve must not drive the balance negative: approved days (excluding
    // this request) + this request ≤ allowance. Same period/aggregate as
    // GET /api/leave/balance. Requests starting before this balance year are
    // not counted there, so they are not gated here either.
    if (isBalancedLeaveType(request.leaveType) && request.startDate >= balancePeriodStart()) {
      const employee = await tx.employee.findFirst({
        where: { id: request.employeeId, tenantId: session.tenantId! },
        select: { leaveBalanceAnnual: true, leaveBalanceSick: true },
      });
      if (employee) {
        const approvedOthers = await sumLeaveDays(tx, {
          employeeId: request.employeeId,
          leaveType: request.leaveType,
          statuses: ["APPROVED"],
          excludeId: id,
        });
        const total = request.leaveType === "ANNUAL" ? employee.leaveBalanceAnnual : employee.leaveBalanceSick;
        if (approvedOthers + request.days > total) {
          return {
            kind: "insufficient" as const,
            message: `Sisa cuti ${leaveTypeLabel(request.leaveType)} karyawan ini hanya ${Math.max(0, total - approvedOthers)} hari, sedangkan pengajuan ini ${request.days} hari. Tolak pengajuan ini atau sesuaikan saldo cutinya dulu.`,
          };
        }
      }
    }

    // Conditional update: only a still-PENDING row moves. A concurrent
    // approve/reject/cancel that got there first leaves count 0 → 409.
    const claimed = await tx.leaveRequest.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "APPROVED",
        reviewedBy: session.id,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });
    if (claimed.count === 0) return { kind: "processed" as const };

    const approved = await tx.leaveRequest.findUnique({ where: { id } });

    // Create LEAVE attendance records for each working, non-holiday day in
    // the leave period. Weekends and holidays are skipped to stay aligned
    // with `calculateWorkingDays`.
    const start = new Date(request.startDate + "T00:00:00");
    const end = new Date(request.endDate + "T00:00:00");
    const current = new Date(start);

    while (current <= end) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, "0");
      const d = String(current.getDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;
      const dayName = DAY_MAP[current.getDay()];

      const isWorkingDay = effectiveWorkingDays.includes(dayName);
      const isHoliday = holidaySet.has(dateStr);

      if (isWorkingDay && !isHoliday) {
        // Skip days already locked by approved payroll — overwriting would
        // desync the run from attendance and corrupt historical slips.
        const existing = await tx.attendanceRecord.findUnique({
          where: { employeeId_date: { employeeId: request.employeeId, date: dateStr } },
          select: { isLocked: true },
        });
        if (!existing?.isLocked) {
          await tx.attendanceRecord.upsert({
            where: { employeeId_date: { employeeId: request.employeeId, date: dateStr } },
            update: { status: "LEAVE", isManualOverride: true, overrideReason: `Cuti: ${request.reason}`, overriddenBy: session.id, overriddenAt: new Date() },
            create: { employeeId: request.employeeId, date: dateStr, status: "LEAVE", isManualOverride: true, overrideReason: `Cuti: ${request.reason}`, overriddenBy: session.id, overriddenAt: new Date() },
          });
        }
      }
      current.setDate(current.getDate() + 1);
    }

    return { kind: "ok" as const, row: approved };
  });

  if (outcome.kind === "processed") {
    return NextResponse.json({ error: ALREADY_PROCESSED }, { status: 409 });
  }
  if (outcome.kind === "insufficient") {
    return NextResponse.json({ error: outcome.message }, { status: 409 });
  }
  return NextResponse.json(outcome.row);
}
