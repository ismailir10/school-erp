import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { verifyTenantOwnership } from "@/lib/auth-guard";
import { calculateEmployeePayroll, SalaryComponent } from "@/lib/payroll/engine";
import { countAttendanceDays } from "@/lib/payroll/working-days";
import { applyLineAdjustments } from "@/lib/payroll/adjustments";
import { validateBody } from "@/lib/api/validate";
import { calendarDaysInPeriod, payrollVariablesSchema } from "@/lib/validations/payroll";

/**
 * F-15: unlike `calculatePayroll`, `calculateEmployeePayroll` (the
 * per-employee function this route calls directly for a variables recalc)
 * does not run `assertGajiPokokSortOrder` itself — so a misordered
 * PCT_OF_BASE component here silently computed against 0 instead of
 * failing loud. Mirrors that assertion's selection (find `gaji_pokok` by
 * code among the already-`isEnabled: true`-filtered components) and names
 * the offending component(s).
 */
function describeMisorderedComponents(components: SalaryComponent[]): string {
  const gajiPokok = components.find((c) => c.code === "gaji_pokok");
  const misordered = gajiPokok
    ? components.filter((c) => c.calcType === "PCT_OF_BASE" && c.sortOrder <= gajiPokok.sortOrder)
    : [];
  const names = misordered.length > 0 ? misordered.map((c) => c.label).join(", ") : "Komponen % Gaji Pokok";
  return `Urutan komponen tidak valid: ${names} harus diurutkan setelah Gaji Pokok. Perbaiki Urutan di Komponen Gaji sebelum menghitung ulang.`;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const auth = await requirePermission("payroll.create");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id: payrollRunId, itemId } = await params;

  // #8 fix: authorize BEFORE mutating
  const payrollRun = await prisma.payrollRun.findUnique({ where: { id: payrollRunId } });
  if (!payrollRun || payrollRun.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // #9 fix: only allow editing DRAFT payrolls (409 matches peer payroll routes).
  if (payrollRun.status !== "DRAFT") {
    return NextResponse.json({ error: "Hanya draf yang bisa diedit" }, { status: 409 });
  }
  if (!(await verifyTenantOwnership("payrollItem", itemId, session.tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }
  const result = await validateBody(payrollVariablesSchema, json);
  if (result.error) return result.error;
  const body = result.data;

  // HRX-4: day counts can't exceed the days in the run's period (Hari Outdoor
  // 99 / Hari DC 31 in a 30-day period used to be accepted and paid out).
  const daysInPeriod = calendarDaysInPeriod(payrollRun.periodStart, payrollRun.periodEnd);
  const dayFields = [
    { field: "outdoorDays", label: "Hari outdoor", value: body.outdoorDays },
    { field: "holidayWorkedDays", label: "Hari libur kerja", value: body.holidayWorkedDays },
    { field: "dcDays", label: "Hari DC", value: body.dcDays },
  ] as const;
  const outOfRange = dayFields
    .filter((f) => f.value > daysInPeriod)
    .map((f) => ({ field: f.field, message: `${f.label} harus antara 0 dan ${daysInPeriod} hari.` }));
  if (outOfRange.length > 0) {
    return NextResponse.json({ error: outOfRange[0].message, errors: outOfRange }, { status: 400 });
  }

  // Reads that can safely live outside the tx (no mutation, no ordering risk).
  const componentDefs = await prisma.salaryComponentDef.findMany({
    where: { tenantId: session.tenantId, isEnabled: true },
    orderBy: { sortOrder: "asc" },
  });

  const components: SalaryComponent[] = componentDefs.map((c) => ({
    id: c.id, code: c.code, label: c.label,
    category: c.category as "INCOME" | "DEDUCTION",
    calcType: c.calcType as "FIXED" | "PCT_OF_BASE" | "ATTENDANCE_BASED",
    isProRated: c.isProRated, sortOrder: c.sortOrder,
  }));

  const gajiPokok = components.find((c) => c.code === "gaji_pokok");
  const isMisordered = gajiPokok
    ? components.some((c) => c.calcType === "PCT_OF_BASE" && c.sortOrder <= gajiPokok.sortOrder)
    : false;
  if (isMisordered) {
    return NextResponse.json({ error: describeMisorderedComponents(components) }, { status: 400 });
  }

  // Atomic: variables update + line rebuild + totals update must commit
  // together, else PayrollItem totals desync from its lines on any mid-
  // sequence failure.
  await prisma.$transaction(async (tx) => {
    const item = await tx.payrollItem.update({
      where: { id: itemId },
      data: {
        overtimeHours: body.overtimeHours ?? 0,
        outdoorDays: body.outdoorDays ?? 0,
        holidayWorkedDays: body.holidayWorkedDays ?? 0,
        dcDays: body.dcDays ?? 0,
      },
    });

    const salaryValues = await tx.employeeSalaryValue.findMany({
      where: { employeeId: item.employeeId },
    });

    const attendance = await tx.attendanceRecord.findMany({
      where: {
        employeeId: item.employeeId,
        date: { gte: payrollRun.periodStart, lte: payrollRun.periodEnd },
      },
    });

    const { daysPresent, daysLeave } = countAttendanceDays(attendance);

    const result = calculateEmployeePayroll(
      components,
      salaryValues.map((sv) => ({ componentDefId: sv.componentDefId, value: Number(sv.value) })),
      daysPresent, daysLeave, payrollRun.actualWorkDays,
      {
        overtimeHours: Number(item.overtimeHours),
        outdoorDays: item.outdoorDays,
        holidayWorkedDays: item.holidayWorkedDays,
        dcDays: item.dcDays,
      }
    );

    // HR-2: the engine only knows calculated amounts. Read the admin's manual
    // adjustments before the lines are rebuilt and layer them back on, or every
    // "Simpan & Hitung Ulang" silently zeroes them.
    const existingLines = await tx.payrollItemLine.findMany({
      where: { payrollItemId: itemId },
      select: { componentDefId: true, adjustmentAmount: true, adjustmentNote: true },
    });
    const recomputed = applyLineAdjustments(result.lines, existingLines);

    await tx.payrollItemLine.deleteMany({ where: { payrollItemId: itemId } });

    await tx.payrollItemLine.createMany({
      data: recomputed.lines.map((line) => ({
        payrollItemId: itemId,
        componentDefId: line.componentDefId,
        labelSnapshot: line.labelSnapshot,
        categorySnapshot: line.categorySnapshot,
        calculatedAmount: line.calculatedAmount,
        adjustmentAmount: line.adjustmentAmount,
        adjustmentNote: line.adjustmentNote,
        finalAmount: line.finalAmount,
      })),
    });

    await tx.payrollItem.update({
      where: { id: itemId },
      data: {
        grossAmount: recomputed.grossAmount,
        deductions: recomputed.deductions,
        netAmount: recomputed.netAmount,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
