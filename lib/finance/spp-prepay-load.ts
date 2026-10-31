import { createHash } from "node:crypto";
import { Prisma } from "@/lib/generated/prisma/client";
import { formatMonthLabel } from "@/lib/format";
import { BILLABLE_FEE_COMPONENT_WHERE } from "@/lib/finance/billable-fees";
import { loadBundleFees } from "@/lib/finance/bundle-fees";
import {
  buildBillingRunRows,
  type BuildEnrollment,
  type FeeStructureLine,
} from "@/lib/finance/build-billing-run";
import type { AdjustmentInput } from "@/lib/finance/apply-adjustments";
import { sumDecimals } from "@/lib/finance/invoice-numbers";
import { lastDayOfMonth, parsePeriodMonth } from "@/lib/finance/period-label";
import { academicYearBillingWindow } from "@/lib/enrollment-leave/window";
import {
  planOtherFees,
  planSppPrepay,
  type MonthPrice,
  type OneTimeComponent,
  type OtherFeesInput,
  type OtherFeesPlan,
  type PlanInvoice,
  type PlanIssue,
  type PlanRow,
  type YearMonth,
} from "@/lib/finance/spp-prepay-plan";

/**
 * Data side of "Catat pembayaran di muka" (docs/cycles/2026-10-27-paid-invoice-spp-prepay.md,
 * extended with one-time fees by docs/cycles/2026-10-30-prepay-other-fees.md).
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

/** Message when the school has no ACTIVE academic year: only the SPP part is blocked (D5), one-time fees still work. */
export const NO_ACADEMIC_YEAR_MESSAGE =
  "Belum ada tahun ajaran aktif, jadi SPP belum bisa dihitung. Aktifkan tahun ajaran lebih dulu.";

export type SppPrepayFailureCode = "STUDENT_NOT_FOUND" | "RANGE_INVALID" | "RANGE_OUTSIDE_YEAR";

export type SppPrepayLoadFailure = { ok: false; code: SppPrepayFailureCode; message: string };

export type SppPrepayContext = {
  ok: true;
  student: { id: string; name: string };
  /** The ACTIVE academic year; null when the school has none (SPP is then unavailable). */
  academicYear: { id: string; name: string; from: string; to: string } | null; // from/to: "YYYY-MM"
  /** True when the request asked for SPP months (from + to given). False = "Tanpa SPP" or a student-only preview. */
  sppChosen: boolean;
  /** The SPP months to plan; null when SPP is not chosen or there is no academic year. */
  range: { from: string; to: string } | null; // "YYYY-MM"
  rangeYm: { from: YearMonth; to: YearMonth } | null;
  /** The academic year's own first to last month (at most 12), to prefill the range; null without a year. */
  defaultRange: { from: string; to: string } | null;
  /** Distinct program names of the student's ACTIVE enrollments in the year, or null. */
  program: string | null;
  /** True when the student has no ACTIVE enrollment in the academic year (or there is no year): SPP cannot be priced. */
  noProgram: boolean;
  /** Primary ACTIVE guardian, for Invoice.parentId. */
  parentId: string | null;
  /** All of the student's invoices, ascending by id. */
  invoices: PlanInvoice[];
  /** Earliest month the school ever billed SPP (non-cancelled invoice with a recurring line), or null. */
  firstInvoicedMonth: YearMonth | null;
  /** Price of one month as the Billing Run would bill it; null = cannot be priced. */
  priceFor: (ym: YearMonth) => MonthPrice;
  /** The tenant's enabled, ACTIVE, non-recurring fee components, in display order, with the student's prefill. */
  oneTimeComponents: OneTimeComponent[];
};

export type SppPrepayIssue = Omit<PlanIssue, "code"> & {
  code: PlanIssue["code"] | "NO_PROGRAM" | "NO_ACADEMIC_YEAR";
};

export type SppPrepayPlan = {
  rows: PlanRow[];
  /** Sum of the SPP rows (0 when SPP is not chosen). */
  sppTotal: Prisma.Decimal;
  /** The new invoice for the one-time lines, or null (none given, or a component is invalid: see `issues`). */
  otherFees: OtherFeesPlan | null;
  /** Grand total: SPP rows + one-time lines. */
  total: Prisma.Decimal;
  issues: SppPrepayIssue[];
  blocked: boolean;
};

export type SppAvailability = {
  available: boolean;
  /** Why SPP cannot be chosen; null when it can. */
  reason: { code: "NO_ACADEMIC_YEAR" | "NO_PROGRAM"; message: string } | null;
  /** The academic year's own range, to prefill the picker; null without a year. */
  defaultRange: { from: string; to: string } | null;
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

  // The SPP part is chosen by giving a range. No academic year only makes SPP unavailable
  // (D5): the one-time part needs neither a year nor a program.
  const sppChosen = Boolean(input.from || input.to);
  let range: { from: YearMonth; to: YearMonth } | null = null;
  if (sppChosen && window) {
    const from = input.from ? parseYearMonth(input.from) : window.from;
    const to = input.to ? parseYearMonth(input.to) : window.to;
    if (!from || !to || monthIndex(from) > monthIndex(to)) {
      return fail("RANGE_INVALID", "Rentang bulan tidak valid: bulan awal harus sebelum atau sama dengan bulan akhir.");
    }
    if (monthIndex(from) < monthIndex(window.from) || monthIndex(to) > monthIndex(window.to)) {
      return fail(
        "RANGE_OUTSIDE_YEAR",
        `Rentang bulan harus berada di dalam tahun ajaran ${year!.name} (${formatMonthLabel(window.from.year, window.from.month)} sampai ${formatMonthLabel(window.to.year, window.to.month)}).`,
      );
    }
    range = { from, to };
  }

  const base = {
    ok: true as const,
    student: { id: student.id, name: student.name },
    academicYear:
      year && window
        ? { id: year.id, name: year.name, from: formatYearMonth(window.from), to: formatYearMonth(window.to) }
        : null,
    sppChosen,
    range: range ? { from: formatYearMonth(range.from), to: formatYearMonth(range.to) } : null,
    rangeYm: range,
    defaultRange: window ? { from: formatYearMonth(window.from), to: formatYearMonth(window.to) } : null,
  };

  // Same enrollment filter as `materializeBillingRun`: ACTIVE, in a class of THIS academic year.
  const enrollments = year
    ? await db.studentEnrollment.findMany({
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
      })
    : [];

  const programIds = [...new Set(enrollments.map((e) => e.classSection.programId))];
  const programNames = [...new Set(enrollments.map((e) => e.classSection.program.name))].sort();
  const priced = year !== null && enrollments.length > 0;

  // The one-time part and the caution read these whether or not the student can be priced for SPP.
  const [componentRows, oneTimeFees, invoiceRows, guardian] = await Promise.all([
    db.feeComponentDef.findMany({
      where: { tenantId, isEnabled: true, isRecurring: false, status: "ACTIVE" },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, sortOrder: true },
    }),
    // Prefill: the student's program fee table for the resolved year (none without a program).
    priced && year
      ? db.programFeeStructure.findMany({
          where: {
            programId: { in: programIds },
            academicYearId: year.id,
            status: "ACTIVE",
            feeComponent: { tenantId, isEnabled: true, isRecurring: false, status: "ACTIVE" },
          },
          select: { feeComponentId: true, amount: true },
        })
      : Promise.resolve([]),
    db.invoice.findMany({
      where: { tenantId, studentId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        invoiceNumber: true,
        periodLabel: true,
        status: true,
        totalDue: true,
        totalPaid: true,
        xenditPaymentUrl: true,
        paymentLinkExpiresAt: true,
        lines: { select: { feeComponentId: true, finalAmount: true, feeComponent: { select: { isRecurring: true } } } },
      },
    }),
    db.studentGuardian.findFirst({
      where: { studentId, isPrimary: true, status: "ACTIVE" },
      select: { parentId: true },
    }),
  ]);

  // A student in two programs pays each program's fee, as the Billing Run bills them: prefill sums.
  const prefillById = new Map<string, Prisma.Decimal>();
  for (const fs of oneTimeFees) {
    prefillById.set(
      fs.feeComponentId,
      (prefillById.get(fs.feeComponentId) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(fs.amount)),
    );
  }
  const oneTimeComponents: OneTimeComponent[] = componentRows.map((c) => {
    const prefill = prefillById.get(c.id);
    return { id: c.id, label: c.label, sortOrder: c.sortOrder, prefillAmount: prefill ? Number(prefill) : null };
  });

  const parentId = guardian?.parentId ?? null;

  const invoices: PlanInvoice[] = invoiceRows.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    periodLabel: inv.periodLabel,
    status: inv.status,
    totalDue: new Prisma.Decimal(inv.totalDue),
    totalPaid: new Prisma.Decimal(inv.totalPaid),
    hasMonthlyLine: inv.lines.some((l) => l.feeComponent.isRecurring),
    monthlyAmount: sumDecimals(inv.lines.filter((l) => l.feeComponent.isRecurring).map((l) => new Prisma.Decimal(l.finalAmount))),
    hasOtherLine: inv.lines.some((l) => !l.feeComponent.isRecurring),
    feeComponentIds: inv.lines.map((l) => l.feeComponentId),
    hasLink: inv.xenditPaymentUrl !== null,
    paymentLinkExpiresAt: inv.paymentLinkExpiresAt,
  }));

  if (!priced || !year) {
    return {
      ...base,
      program: null,
      noProgram: true,
      parentId,
      invoices,
      firstInvoicedMonth: null,
      priceFor: () => null,
      oneTimeComponents,
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

  // SPP pricing inputs are only needed when the SPP part is chosen.
  const [feeStructures, bundleFees, adjustments, labelRows] = await Promise.all([
    db.programFeeStructure.findMany({
      where: { programId: { in: programIds }, academicYearId: year.id, feeComponent: BILLABLE_FEE_COMPONENT_WHERE },
      include: { feeComponent: true },
    }),
    // Harga paket sekolah + daycare: priced exactly as the Billing Run does (none when < 2 programs).
    loadBundleFees(db, { tenantId, academicYearId: year.id, programIds }),
    db.studentFeeAdjustment.findMany({
      where: { tenantId, studentId, academicYearId: year.id, status: "ACTIVE" },
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
      bundleFees,
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
    oneTimeComponents,
  };
}

/** Whether the SPP part can be chosen for this context, and why not. */
export function sppAvailability(ctx: Pick<SppPrepayContext, "academicYear" | "noProgram" | "defaultRange">): SppAvailability {
  if (!ctx.academicYear) {
    return {
      available: false,
      reason: { code: "NO_ACADEMIC_YEAR", message: NO_ACADEMIC_YEAR_MESSAGE },
      defaultRange: null,
    };
  }
  if (ctx.noProgram) {
    return {
      available: false,
      reason: { code: "NO_PROGRAM", message: NO_PROGRAM_MESSAGE },
      defaultRange: ctx.defaultRange,
    };
  }
  return { available: true, reason: null, defaultRange: ctx.defaultRange };
}

/**
 * The plan for a loaded context. The SPP part is planned only when it was chosen:
 * chosen but unavailable (no academic year, or no class in it) is one blocking
 * issue and no rows. The one-time part is planned from `otherFees` (the request's
 * payload) against the context's component list and the student's invoices.
 */
export function planForContext(ctx: SppPrepayContext, otherFeesInput?: OtherFeesInput | null): SppPrepayPlan {
  const zero = new Prisma.Decimal(0);
  const issues: SppPrepayIssue[] = [];
  let rows: PlanRow[] = [];
  let sppTotal = zero;

  if (ctx.sppChosen) {
    const availability = sppAvailability(ctx);
    if (availability.reason) {
      issues.push({ code: availability.reason.code, blocking: true, message: availability.reason.message });
    } else if (ctx.rangeYm) {
      const spp = planSppPrepay({
        range: ctx.rangeYm,
        invoices: ctx.invoices,
        priceFor: ctx.priceFor,
        firstInvoicedMonth: ctx.firstInvoicedMonth,
      });
      rows = spp.rows;
      sppTotal = spp.total;
      issues.push(...spp.issues);
    }
  }

  const other = planOtherFees({ input: otherFeesInput, components: ctx.oneTimeComponents, invoices: ctx.invoices });
  issues.push(...other.issues);

  return {
    rows,
    sppTotal,
    otherFees: other.plan,
    total: sppTotal.add(other.plan?.total ?? zero),
    issues,
    blocked: issues.some((i) => i.blocking),
  };
}

/**
 * Stable digest of what a plan will do: per month the year, month, action,
 * amount, the sorted invoice ids and each invoice's remaining balance, plus the
 * one-time invoice's label and lines (so confirming a different payload than the
 * one previewed is stale). The preview hands it to the client and the confirm
 * route compares it against a fresh plan computed under lock, so any payment,
 * reversal, cancellation or price change between the two flips it. `invoices`
 * supplies the per-invoice balances (the plan rows only carry ids and the summed amount).
 */
export function fingerprintPlan(
  plan: { rows: PlanRow[]; otherFees?: OtherFeesPlan | null },
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
  const other = plan.otherFees
    ? [
        plan.otherFees.label,
        plan.otherFees.lines
          .map((l) => [l.feeComponentId, l.amount.toString()])
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      ]
    : null;
  return createHash("sha256").update(JSON.stringify(plan.otherFees ? [material, other] : material)).digest("hex");
}
