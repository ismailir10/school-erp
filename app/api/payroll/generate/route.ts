import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { calculateWorkingDays, parseWorkingDays } from "@/lib/payroll/working-days";
import { calculatePayroll, SalaryComponent } from "@/lib/payroll/engine";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { generatePayrollSchema } from "@/lib/validations/payroll";
import { findNegativeNet, isFuturePayrollPeriod } from "@/lib/payroll/generation-guards";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

/**
 * F-15: mirrors `assertGajiPokokSortOrder`'s selection (find the tenant's
 * `gaji_pokok` by code among the already-`isEnabled: true`-filtered
 * components) but names the offending component(s) for the 400 message,
 * which the thrown Error alone does not carry.
 */
function describeMisorderedComponents(components: SalaryComponent[]): string {
  const gajiPokok = components.find((c) => c.code === "gaji_pokok");
  const misordered = gajiPokok
    ? components.filter((c) => c.calcType === "PCT_OF_BASE" && c.sortOrder <= gajiPokok.sortOrder)
    : [];
  const names = misordered.length > 0 ? misordered.map((c) => c.label).join(", ") : "Komponen % Gaji Pokok";
  return `Urutan komponen tidak valid: ${names} harus diurutkan setelah Gaji Pokok. Perbaiki Urutan di Komponen Gaji sebelum membuat penggajian.`;
}

export async function POST(req: NextRequest) {
  // Rate limit: 2 payroll generations per minute
  const { success } = rateLimit(`payroll:${getClientIp(req)}`, 2, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429 });
  }

  const auth = await requirePermission("payroll.create");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON valid" }, { status: 400 });
  }

  const result = await validateBody(generatePayrollSchema, rawBody);
  if (result.error) return result.error;
  const { periodStart, periodEnd } = result.data;

  // HR-12: a period that has not started yet has no attendance — generating it
  // produced pro-rata Rp 0 income with fixed deductions (net < 0).
  if (isFuturePayrollPeriod(periodStart, getTodayInTimezone("Asia/Jakarta"))) {
    return NextResponse.json(
      {
        error: "Validasi gagal",
        errors: [{ field: "periodStart", message: "Periode penggajian belum dimulai. Pilih periode yang sudah berjalan atau sudah selesai." }],
      },
      { status: 400 },
    );
  }

  // Parallelise the 4 independent setup queries — none depend on each other
  // (overlap + duplicate check happen atomically inside the $transaction below)
  const [orgConfig, holidays, componentDefs, employees] = await Promise.all([
    prisma.orgConfig.findUnique({ where: { tenantId: session.tenantId } }),
    prisma.holiday.findMany({
      where: {
        tenantId: session.tenantId,
        date: { gte: periodStart, lte: periodEnd },
      },
    }),
    prisma.salaryComponentDef.findMany({
      where: { tenantId: session.tenantId, isEnabled: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.employee.findMany({
      where: { tenantId: session.tenantId, status: "ACTIVE" },
      select: {
        id: true,
        kode: true,
        nama: true,
        bankName: true,
        bankAccountNo: true,
        salaryValues: { select: { componentDefId: true, value: true } },
        attendanceRecords: {
          where: { date: { gte: periodStart, lte: periodEnd } },
          select: { status: true, approvalStatus: true },
        },
      },
    }),
  ]);

  if (!orgConfig) {
    return NextResponse.json({ error: "Org config not set" }, { status: 400 });
  }

  // F-10 (cycle 2026-05-13 staging-sweep-majors-cycle1) — pre-flight refuse
  // payroll runs that would include any employee with bankName set but
  // bankAccountNo blank, because that row would be emitted into the BSI
  // bulk-export with an invalid/empty rekening. T5 stops new authoring at
  // the form layer; this guard catches anyone already in that state from a
  // pre-T5 record. Returns the offenders so the admin form can render an
  // inline list with a CTA to fix each Karyawan.
  const missingRekening = employees.filter(
    (e) => typeof e.bankName === "string" && e.bankName.trim().length > 0 &&
           (e.bankAccountNo === null || e.bankAccountNo.trim().length === 0),
  );
  if (missingRekening.length > 0) {
    return NextResponse.json(
      {
        error: "Beberapa karyawan belum memiliki No. Rekening lengkap",
        employees: missingRekening.map((e) => ({
          id: e.id,
          kode: e.kode,
          nama: e.nama,
          reason: "rekening missing",
        })),
      },
      { status: 422 },
    );
  }

  // FIND-019: refuse payroll generation when any included employee has no
  // EmployeeSalaryValue rows — otherwise the engine silently produces Rp 0
  // and the admin can ship empty slips by accident.
  const missingSalary = employees.filter((e) => e.salaryValues.length === 0);
  if (missingSalary.length > 0) {
    return NextResponse.json(
      {
        error: "Beberapa karyawan belum memiliki struktur gaji",
        employees: missingSalary.map((e) => ({
          id: e.id,
          kode: e.kode,
          nama: e.nama,
          reason: "salary structure missing",
        })),
      },
      { status: 422 },
    );
  }

  const workingDays = parseWorkingDays(orgConfig.workingDays);
  const actualWorkDays = calculateWorkingDays(periodStart, periodEnd, workingDays, holidays);

  const components: SalaryComponent[] = componentDefs.map((c) => ({
    id: c.id,
    code: c.code,
    label: c.label,
    category: c.category as "INCOME" | "DEDUCTION",
    calcType: c.calcType as "FIXED" | "PCT_OF_BASE" | "ATTENDANCE_BASED",
    isProRated: c.isProRated,
    sortOrder: c.sortOrder,
  }));

  // Calculate payroll. F-14: propagate the org-level lemburCompliant flag so
  // tenants that opt in get UU 13/2003 §78(4) tiered overtime rates; everyone
  // else stays on the historical flat formula.
  // F-15: a component misordered against `gaji_pokok` makes
  // `calculatePayroll` throw (`assertGajiPokokSortOrder`) rather than
  // silently compute PCT_OF_BASE against 0 — catch that specific error and
  // return a 400 naming the offending component(s) instead of a 500.
  let results;
  try {
    results = calculatePayroll(
      employees.map((e) => ({
        id: e.id,
        salaryValues: e.salaryValues.map((sv) => ({
          componentDefId: sv.componentDefId,
          value: Number(sv.value),
        })),
        attendanceRecords: e.attendanceRecords.map((r) => ({ status: r.status, approvalStatus: r.approvalStatus })),
      })),
      components,
      actualWorkDays,
      { lemburCompliant: orgConfig.lemburCompliant }
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("PCT_OF_BASE")) {
      return NextResponse.json({ error: describeMisorderedComponents(components) }, { status: 400 });
    }
    throw e;
  }

  // HR-12: never write a run that pays someone a negative net amount without
  // the admin knowing — block and name the employees so the salary structure
  // (or the period) can be fixed first.
  const negativeNet = findNegativeNet(
    employees.map((e) => ({
      id: e.id,
      kode: e.kode,
      nama: e.nama,
      netAmount: results.get(e.id)?.netAmount ?? 0,
    })),
  );
  if (negativeNet.length > 0) {
    return NextResponse.json(
      {
        error: "Gaji bersih negatif untuk beberapa karyawan. Periksa struktur gaji atau periode sebelum membuat penggajian",
        employees: negativeNet.map((e) => ({
          id: e.id,
          kode: e.kode,
          nama: e.nama,
          reason: "negative net pay",
        })),
      },
      { status: 422 },
    );
  }

  // Pre-generate item IDs so PayrollItemLines can reference them without an
  // extra round trip. Replaces 1 + N + N×M individual INSERTs with 3 bulk
  // statements inside an interactive transaction:
  //   - 1 INSERT into PayrollRun
  //   - 1 INSERT ... VALUES (...) × N into PayrollItem (createMany)
  //   - 1 INSERT ... VALUES (...) × N×M into PayrollItemLine (createMany)
  const itemData = employees.map((emp) => {
    const result = results.get(emp.id)!;
    return {
      id: crypto.randomUUID(),
      employeeId: emp.id,
      grossAmount: result.grossAmount,
      deductions: result.deductions,
      netAmount: result.netAmount,
    };
  });

  const lineData = employees.flatMap((emp, i) => {
    const result = results.get(emp.id)!;
    return result.lines.map((line) => ({
      payrollItemId: itemData[i].id,
      componentDefId: line.componentDefId,
      labelSnapshot: line.labelSnapshot,
      categorySnapshot: line.categorySnapshot,
      calculatedAmount: line.calculatedAmount,
      finalAmount: line.finalAmount,
    }));
  });

  // Serializable: duplicate/overlap check + create commit atomically. Prevents
  // two concurrent POSTs from both passing the guard and inserting duplicate runs.
  let payrollRun: { id: string };
  try {
    payrollRun = await prisma.$transaction(
      async (tx) => {
        const existingRun = await tx.payrollRun.findFirst({
          where: { tenantId: session.tenantId!, periodStart, periodEnd },
          select: { id: true },
        });
        if (existingRun) {
          throw Object.assign(new Error("DUPLICATE"), { existingId: existingRun.id });
        }

        const overlapping = await tx.payrollRun.findFirst({
          where: {
            tenantId: session.tenantId!,
            status: { not: "CANCELLED" },
            periodStart: { lte: periodEnd },
            periodEnd: { gte: periodStart },
          },
          select: { periodStart: true, periodEnd: true },
        });
        if (overlapping) {
          throw Object.assign(new Error("OVERLAP"), {
            msg: `Periode tumpang tindih dengan penggajian ${overlapping.periodStart} - ${overlapping.periodEnd}`,
          });
        }

        const run = await tx.payrollRun.create({
          data: {
            tenantId: session.tenantId!, // non-null confirmed by auth check at line 16
            periodStart,
            periodEnd,
            actualWorkDays,
            createdBy: session.id,
          },
          select: { id: true },
        });

        await tx.payrollItem.createMany({
          data: itemData.map((item) => ({ ...item, payrollRunId: run.id })),
        });

        await tx.payrollItemLine.createMany({ data: lineData });

        return run;
      },
      { isolationLevel: "Serializable" }
    );
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "DUPLICATE") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ error: "Penggajian untuk periode ini sudah ada", id: (e as any).existingId }, { status: 409 });
      }
      if (e.message === "OVERLAP") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ error: (e as any).msg }, { status: 400 });
      }
    }
    throw e;
  }

  return NextResponse.json({ id: payrollRun.id }, { status: 201 });
}
