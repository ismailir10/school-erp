import { createHash } from "node:crypto";
import { Prisma } from "@/lib/generated/prisma/client";
import { formatMonthLabel } from "@/lib/format";
import { BILLABLE_FEE_COMPONENT_WHERE } from "@/lib/finance/billable-fees";
import {
  buildBillingRunRows,
  type BuildEnrollment,
  type FeeStructureLine,
} from "@/lib/finance/build-billing-run";
import type { AdjustmentInput } from "@/lib/finance/apply-adjustments";
import { lastDayOfMonth, parsePeriodMonth } from "@/lib/finance/period-label";
import { academicYearBillingWindow } from "@/lib/enrollment-leave/window";
import {
  planSppPrepay,
  type MonthPrice,
  type PlanInvoice,
  type PlanIssue,
  type PlanRow,
  type YearMonth,
} from "@/lib/finance/spp-prepay-plan";

/**
 * Data side of "Catat SPP di muka" (docs/cycles/2026-10-27-paid-invoice-spp-prepay.md).
 *
 * `loadSppPrepayContext` reads everything the pure planner (`planSppPrepay`)
 * needs and builds `priceFor`, which prices a month exactly the way the Billing
 * Run would (`buildBillingRunRows`, with that month's due date so a keringanan
 * is judged against its own validity window). `db` is transaction-client
 * compatible: the preview route passes `prisma`, the confirm route reloads
 * inside its transaction.
 */

/** Message for a student the school cannot price (no class in the year's program). */
export const NO_PROGRAM_MESSAGE =
  "Siswa belum punya kelas di tahun ajaran ini, jadi SPP belum bisa dihitung. Daftarkan ke kelas lebih dulu.";

/** Upper bound on distinct period labels read to find the school's first billed month. */
const FIRST_MONTH_LABEL_CAP = 2000;

export type SppPrepayFailureCode =
  | "STUDENT_NOT_FOUND"
  | "NO_ACADEMIC_YEAR"
  | "RANGE_INVALID"
  | "RANGE_OUTSIDE_YEAR";

export type SppPrepayLoadFailure = { ok: false; code: SppPrepayFailureCode; message: string };

export type SppPrepayContext = {
  ok: true;
  student: { id: string; name: string };
  academicYear: { id: string; name: string; from: string; to: string }; // from/to: "YYYY-MM"
  range: { from: string; to: string }; // "YYYY-MM"
  rangeYm: { from: YearMonth; to: YearMonth };
  /** Distinct program names of the student's ACTIVE enrollments in the year, or null. */
  program: string | null;
  /** True when the student has no ACTIVE enrollment in the academic year: nothing to price. */
  noProgram: boolean;
  /** Primary ACTIVE guardian, for Invoice.parentId. */
  parentId: string | null;
  /** All of the student's invoices, ascending by id. */
  invoices: PlanInvoice[];
  /** Earliest month the school ever billed SPP (non-cancelled invoice with a recurring line), or null. */
  firstInvoicedMonth: YearMonth | null;
  /** Price of one month as the Billing Run would bill it; null = cannot be priced. */
  priceFor: (ym: YearMonth) => MonthPrice;
};

export type SppPrepayIssue = Omit<PlanIssue, "code"> & { code: PlanIssue["code"] | "NO_PROGRAM" };

export type SppPrepayPlan = {
  rows: PlanRow[];
  total: Prisma.Decimal;
  issues: SppPrepayIssue[];
  blocked: boolean;
};

type Db = Prisma.TransactionClient;

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseYearMonth(value: string): YearMonth | null {
  const m = YEAR_MONTH.exec(value);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

export function formatYearMonth(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

const monthIndex = (ym: YearMonth) => ym.year * 12 + (ym.month - 1);

/** What an invoice still owes. */
export function remainingOfInvoice(inv: Pick<PlanInvoice, "totalDue" | "totalPaid">): Prisma.Decimal {
  return new Prisma.Decimal(inv.totalDue).sub(new Prisma.Decimal(inv.totalPaid));
}

function fail(code: SppPrepayFailureCode, message: string): SppPrepayLoadFailure {
  return { ok: false, code, message };
}

export async function loadSppPrepayContext(
  db: Db,
  input: { tenantId: string; studentId: string; from?: string; to?: string },
): Promise<SppPrepayContext | SppPrepayLoadFailure> {
  const { tenantId, studentId } = input;

  const student = await db.student.findFirst({
    where: { id: studentId, tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!student) return fail("STUDENT_NOT_FOUND", "Siswa tidak ditemukan atau tidak aktif.");

  const year = await db.academicYear.findFirst({
    where: { tenantId, status: "ACTIVE" },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  // The year's billing window (first month through eleven months later at most) is shared with
  // the student-leave rules: lib/enrollment-leave/window.ts. A second Juli of a 13-month year
  // belongs to the next year (a Juli 2027 invoice made at this year's price would make next
  // year's Billing Run skip it).
  const window = year ? academicYearBillingWindow(year) : null;
  if (!year || !window) {
    return fail("NO_ACADEMIC_YEAR", "Belum ada tahun ajaran aktif. Aktifkan tahun ajaran lebih dulu.");
  }
  const { from: yearFrom, to: yearTo } = window;

  const from = input.from ? parseYearMonth(input.from) : yearFrom;
  const to = input.to ? parseYearMonth(input.to) : yearTo;
  if (!from || !to || monthIndex(from) > monthIndex(to)) {
    return fail("RANGE_INVALID", "Rentang bulan tidak valid: bulan awal harus sebelum atau sama dengan bulan akhir.");
  }
  if (monthIndex(from) < monthIndex(yearFrom) || monthIndex(to) > monthIndex(yearTo)) {
    return fail(
      "RANGE_OUTSIDE_YEAR",
      `Rentang bulan harus berada di dalam tahun ajaran ${year.name} (${formatMonthLabel(yearFrom.year, yearFrom.month)} sampai ${formatMonthLabel(yearTo.year, yearTo.month)}).`,
    );
  }

  const base = {
    ok: true as const,
    student: { id: student.id, name: student.name },
    academicYear: { id: year.id, name: year.name, from: formatYearMonth(yearFrom), to: formatYearMonth(yearTo) },
    range: { from: formatYearMonth(from), to: formatYearMonth(to) },
    rangeYm: { from, to },
  };

  // Same enrollment filter as `materializeBillingRun`: ACTIVE, in a class of THIS academic year.
  const enrollments = await db.studentEnrollment.findMany({
    where: {
      studentId,
      status: "ACTIVE",
      student: { status: "ACTIVE" },
      classSection: { tenantId, academicYearId: year.id },
    },
    select: {
      id: true,
      studentId: true,
      classSectionId: true,
      student: { select: { id: true, name: true } },
      classSection: { select: { name: true, programId: true, program: { select: { name: true } } } },
    },
  });

  if (enrollments.length === 0) {
    return {
      ...base,
      program: null,
      noProgram: true,
      parentId: null,
      invoices: [],
      firstInvoicedMonth: null,
      priceFor: () => null,
    };
  }

  const buildEnrollments: BuildEnrollment[] = enrollments.map((e) => ({
    enrollmentId: e.id,
    studentId: e.studentId,
    studentName: e.student.name,
    classLabel: e.classSection.name,
    programId: e.classSection.programId,
    programName: e.classSection.program.name,
    classSectionId: e.classSectionId,
  }));
  const programIds = [...new Set(enrollments.map((e) => e.classSection.programId))];
  const programNames = [...new Set(enrollments.map((e) => e.classSection.program.name))].sort();

  const [feeStructures, adjustments, guardian, invoiceRows, labelRows] = await Promise.all([
    db.programFeeStructure.findMany({
      where: { programId: { in: programIds }, academicYearId: year.id, feeComponent: BILLABLE_FEE_COMPONENT_WHERE },
      include: { feeComponent: true },
    }),
    db.studentFeeAdjustment.findMany({
      where: { tenantId, studentId, academicYearId: year.id, status: "ACTIVE" },
    }),
    db.studentGuardian.findFirst({
      where: { studentId, isPrimary: true, status: "ACTIVE" },
      select: { parentId: true },
    }),
    db.invoice.findMany({
      where: { tenantId, studentId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        periodLabel: true,
        status: true,
        totalDue: true,
        totalPaid: true,
        xenditPaymentUrl: true,
        paymentLinkExpiresAt: true,
        lines: { select: { feeComponent: { select: { isRecurring: true } } } },
      },
    }),
    // Distinct labels only: the earliest billed month needs no more than that.
    db.invoice.findMany({
      where: {
        tenantId,
        status: { not: "CANCELLED" },
        lines: { some: { feeComponent: { isRecurring: true } } },
      },
      distinct: ["periodLabel"],
      select: { periodLabel: true },
      take: FIRST_MONTH_LABEL_CAP,
    }),
  ]);

  const feesByProgram = new Map<string, FeeStructureLine[]>();
  for (const fs of feeStructures) {
    const list = feesByProgram.get(fs.programId) ?? [];
    list.push({ feeComponentId: fs.feeComponentId, label: fs.feeComponent.label, amount: fs.amount });
    feesByProgram.set(fs.programId, list);
  }

  const adjustmentInputs: AdjustmentInput[] = adjustments.map((adj) => ({
    id: adj.id,
    academicYearId: adj.academicYearId,
    feeComponentId: adj.feeComponentId,
    type: adj.type as AdjustmentInput["type"],
    mode: adj.mode as AdjustmentInput["mode"],
    value: adj.value,
    reason: adj.reason,
    status: adj.status,
    validFrom: adj.validFrom,
    validTo: adj.validTo,
  }));

  const parentId = guardian?.parentId ?? null;

  const invoices: PlanInvoice[] = invoiceRows.map((inv) => ({
    id: inv.id,
    periodLabel: inv.periodLabel,
    status: inv.status,
    totalDue: new Prisma.Decimal(inv.totalDue),
    totalPaid: new Prisma.Decimal(inv.totalPaid),
    hasMonthlyLine: inv.lines.some((l) => l.feeComponent.isRecurring),
    hasOtherLine: inv.lines.some((l) => !l.feeComponent.isRecurring),
    hasLink: inv.xenditPaymentUrl !== null,
    paymentLinkExpiresAt: inv.paymentLinkExpiresAt,
  }));

  let firstInvoicedMonth: YearMonth | null = null;
  for (const { periodLabel } of labelRows) {
    const parsed = parsePeriodMonth(periodLabel);
    if (parsed && (!firstInvoicedMonth || monthIndex(parsed) < monthIndex(firstInvoicedMonth))) {
      firstInvoicedMonth = parsed;
    }
  }

  // Price one month as the Billing Run would: the month's own due date (last
  // day), so a waiver is applied only in months inside its validity window.
  // `alreadyInvoicedStudentIds` stays empty: month status is the planner's job.
  const priceCache = new Map<number, MonthPrice>();
  const priceFor = (ym: YearMonth): MonthPrice => {
    const key = monthIndex(ym);
    if (priceCache.has(key)) return priceCache.get(key) ?? null;
    const { rows } = buildBillingRunRows({
      enrollments: buildEnrollments,
      scope: { classSectionIds: [], includeStudentIds: [studentId], excludeStudentIds: [] },
      feesByProgram,
      adjustmentsByStudent: new Map([[studentId, adjustmentInputs]]),
      alreadyInvoicedStudentIds: new Set(),
      parentByStudent: new Map([[studentId, parentId]]),
      academicYearId: year.id,
      dueDate: lastDayOfMonth(ym.year, ym.month),
    });
    const row = rows.find((r) => r.studentId === studentId);
    // A Rp 0 month (waiver >= SPP) has nothing to bill and nothing to pay: the
    // Billing Run leaves such rows out too, so it counts as "cannot be priced".
    const price: MonthPrice =
      row && row.status === "PENDING" && row.totalDue.gt(0)
        ? {
            lines: row.lines.map((l) => ({
              feeComponentId: l.feeComponentId,
              labelSnapshot: l.labelSnapshot,
              amount: l.amount,
              adjustmentAmount: l.adjustmentAmount,
              adjustmentNote: l.adjustmentNote,
              finalAmount: l.finalAmount,
            })),
            total: row.totalDue,
          }
        : null;
    priceCache.set(key, price);
    return price;
  };

  return {
    ...base,
    program: programNames.join(", "),
    noProgram: false,
    parentId,
    invoices,
    firstInvoicedMonth,
    priceFor,
  };
}

/** The plan for a loaded context. No enrollment is a blocking `NO_PROGRAM` plan with no rows. */
export function planForContext(ctx: SppPrepayContext): SppPrepayPlan {
  if (ctx.noProgram) {
    return {
      rows: [],
      total: new Prisma.Decimal(0),
      issues: [{ code: "NO_PROGRAM", blocking: true, message: NO_PROGRAM_MESSAGE }],
      blocked: true,
    };
  }
  return planSppPrepay({
    range: ctx.rangeYm,
    invoices: ctx.invoices,
    priceFor: ctx.priceFor,
    firstInvoicedMonth: ctx.firstInvoicedMonth,
  });
}

/**
 * Stable digest of what a plan will do: per month the year, month, action,
 * amount, the sorted invoice ids and each invoice's remaining balance. The
 * preview hands it to the client and the confirm route compares it against a
 * fresh plan computed under lock, so any payment, reversal, cancellation or
 * price change between the two flips it. `invoices` supplies the per-invoice
 * balances (the plan rows only carry ids and the summed amount).
 */
export function fingerprintPlan(
  plan: { rows: PlanRow[] },
  invoices: Array<Pick<PlanInvoice, "id" | "totalDue" | "totalPaid"> & Partial<Pick<PlanInvoice, "hasLink" | "paymentLinkExpiresAt">> > = [],
): string {
  // A payment link made (or replaced) between preview and confirm flips the digest too:
  // the preview warned about the old link, and the admin must see the new one before it is cleared.
  const stateById = new Map(
    invoices.map((inv) => [
      inv.id,
      [remainingOfInvoice(inv).toString(), inv.hasLink ?? false, inv.paymentLinkExpiresAt?.getTime() ?? null],
    ]),
  );
  const material = plan.rows.map((r) => {
    const ids = [...r.invoiceIds].sort();
    return [r.year, r.month, r.action, r.amount.toString(), ids, ids.map((id) => stateById.get(id) ?? null)];
  });
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}
