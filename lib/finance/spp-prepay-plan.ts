import { Prisma } from "@/lib/generated/prisma/client";
import { formatMonthLabel, formatRupiah } from "@/lib/format";
import type { ResolvedLine } from "./apply-adjustments";
import { sumDecimals } from "./invoice-numbers";
import { lastDayOfMonth, parsePeriodMonth } from "./period-label";

/**
 * Pure planner for "Catat SPP di muka" (docs/cycles/2026-10-27-paid-invoice-spp-prepay.md,
 * D5-D12). No Prisma queries and no I/O: the caller loads the student's
 * invoices, prices each month the way the Billing Run would, and hands both in.
 */

export type YearMonth = { year: number; month: number }; // month 1-12

/** An existing invoice of the student, already loaded by the caller. */
export type PlanInvoice = {
  id: string;
  periodLabel: string;
  status: string; // DRAFT | SENT | PARTIALLY_PAID | PAID | OVERDUE | CANCELLED | PENDING_PAYMENT_LINK
  totalDue: Prisma.Decimal;
  totalPaid: Prisma.Decimal;
  hasMonthlyLine: boolean; // true when the invoice has a line for a billable recurring fee component (SPP)
  hasOtherLine: boolean; // true when it also carries a one-time fee line (uang pangkal, seragam, ...)
  hasLink: boolean; // xenditPaymentUrl != null
  paymentLinkExpiresAt: Date | null;
};

/** Price of one month: the lines the Billing Run would bill, waivers already applied for that month's due date. null = cannot be priced (no program / no fee structure). */
export type MonthPrice = { lines: ResolvedLine[]; total: Prisma.Decimal } | null;

export type PlanAction = "CREATE" | "SETTLE" | "SKIP_PAID";
export type PlanRow = {
  year: number;
  month: number;
  periodLabel: string; // via formatMonthLabel, e.g. "Oktober 2026"
  dueDate: string; // last day of that month, YYYY-MM-DD
  action: PlanAction;
  amount: Prisma.Decimal; // CREATE: price.total; SETTLE: remaining balance summed over the unpaid invoices; SKIP_PAID: 0
  lines: ResolvedLine[]; // CREATE only, else []
  invoiceIds: string[]; // SETTLE: unpaid invoice(s) (ascending as given); SKIP_PAID: the paid one(s); CREATE: []
  hadLink: boolean; // SETTLE only: any settled invoice currently has a payment link
  linkExpiresAt: Date | null; // SETTLE only: latest paymentLinkExpiresAt among settled invoices that have a link
  beforeFirstBilling: boolean; // month is earlier than firstInvoicedMonth
};
export type PlanIssueCode = "NO_PRICE" | "UNPARSABLE_LABEL" | "MULTIPLE_MONTHLY_INVOICES" | "SETTLES_OTHER_LINES" | "RANGE_INVALID";
export type PlanIssue = {
  code: PlanIssueCode;
  blocking: boolean;
  message: string;
  year?: number;
  month?: number;
  invoiceId?: string;
};

const MAX_MONTHS = 12;

const monthIndex = (ym: YearMonth) => ym.year * 12 + (ym.month - 1);

function isValidYearMonth(ym: YearMonth): boolean {
  return Number.isInteger(ym.year) && Number.isInteger(ym.month) && ym.month >= 1 && ym.month <= 12;
}

function remainingOf(inv: PlanInvoice): Prisma.Decimal {
  return new Prisma.Decimal(inv.totalDue).sub(new Prisma.Decimal(inv.totalPaid));
}

export function planSppPrepay(args: {
  range: { from: YearMonth; to: YearMonth }; // inclusive
  invoices: PlanInvoice[];
  priceFor: (ym: YearMonth) => MonthPrice; // called once per month that needs a price (CREATE months)
  firstInvoicedMonth: YearMonth | null; // earliest month this school ever invoiced, or null
}): { rows: PlanRow[]; total: Prisma.Decimal; issues: PlanIssue[]; blocked: boolean } {
  const { range, invoices, priceFor, firstInvoicedMonth } = args;
  const zero = new Prisma.Decimal(0);

  // Rule 1: the range must be sane and at most 12 months.
  const { from, to } = range;
  const span = isValidYearMonth(from) && isValidYearMonth(to) ? monthIndex(to) - monthIndex(from) + 1 : 0;
  if (span < 1 || span > MAX_MONTHS) {
    return {
      rows: [],
      total: zero,
      issues: [
        {
          code: "RANGE_INVALID",
          blocking: true,
          message:
            span > MAX_MONTHS
              ? `Rentang paling banyak ${MAX_MONTHS} bulan.`
              : "Rentang bulan tidak valid: bulan awal harus sebelum atau sama dengan bulan akhir.",
        },
      ],
      blocked: true,
    };
  }

  const issues: PlanIssue[] = [];

  // Rules 2 and 5: only non-cancelled invoices with a monthly (SPP) line count,
  // and they are bucketed by the month their label names.
  const byMonth = new Map<number, PlanInvoice[]>();
  for (const inv of invoices) {
    if (!inv.hasMonthlyLine || inv.status === "CANCELLED") continue;
    const parsed = parsePeriodMonth(inv.periodLabel);
    if (!parsed) {
      // A fully paid invoice still matters: a family that paid one "SPP TA 2026/2027" invoice
      // up front would otherwise be prepaid a second time, month by month.
      const owes = remainingOf(inv).gt(0);
      issues.push({
        code: "UNPARSABLE_LABEL",
        blocking: false,
        message: owes
          ? `Tagihan dengan label "${inv.periodLabel}" memuat SPP tetapi tidak menyebut satu bulan; tidak ikut dihitung.`
          : `Tagihan lunas dengan label "${inv.periodLabel}" memuat SPP tetapi tidak menyebut satu bulan, jadi bulan-bulannya tidak terbaca. Pastikan SPP bulan-bulan itu belum dibayar sebelum mencatat.`,
        invoiceId: inv.id,
      });
      continue;
    }
    const key = monthIndex(parsed);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(inv);
    else byMonth.set(key, [inv]);
  }

  const firstIdx = firstInvoicedMonth ? monthIndex(firstInvoicedMonth) : null;
  const rows: PlanRow[] = [];

  for (let idx = monthIndex(from); idx <= monthIndex(to); idx++) {
    const ym: YearMonth = { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
    const base = {
      year: ym.year,
      month: ym.month,
      periodLabel: formatMonthLabel(ym.year, ym.month),
      dueDate: lastDayOfMonth(ym.year, ym.month),
      beforeFirstBilling: firstIdx !== null && idx < firstIdx,
    };
    const candidates = byMonth.get(idx) ?? [];

    if (candidates.length === 0) {
      // Rule 3
      const price = priceFor(ym);
      if (!price) {
        issues.push({
          code: "NO_PRICE",
          blocking: true,
          message: `SPP ${base.periodLabel} tidak bisa dihitung: siswa belum punya program atau struktur biaya.`,
          year: ym.year,
          month: ym.month,
        });
      }
      rows.push({
        ...base,
        action: "CREATE",
        amount: price ? new Prisma.Decimal(price.total) : zero,
        lines: price ? price.lines : [],
        invoiceIds: [],
        hadLink: false,
        linkExpiresAt: null,
      });
      continue;
    }

    // Rule 4
    if (candidates.length > 1) {
      issues.push({
        code: "MULTIPLE_MONTHLY_INVOICES",
        blocking: false,
        message: `Ada ${candidates.length} tagihan SPP untuk ${base.periodLabel}; semua yang belum lunas ikut dilunasi.`,
        year: ym.year,
        month: ym.month,
      });
    }
    const unpaid = candidates.filter((inv) => remainingOf(inv).gt(0));
    if (unpaid.length === 0) {
      rows.push({
        ...base,
        action: "SKIP_PAID",
        amount: zero,
        lines: [],
        invoiceIds: candidates.map((inv) => inv.id),
        hadLink: false,
        linkExpiresAt: null,
      });
      continue;
    }
    for (const inv of unpaid) {
      if (inv.hasOtherLine) {
        issues.push({
          code: "SETTLES_OTHER_LINES",
          blocking: false,
          message: `Tagihan ${base.periodLabel} juga memuat biaya sekali bayar; seluruh sisanya (${formatRupiah(remainingOf(inv).toString())}) akan dicatat lunas, bukan hanya SPP.`,
          year: ym.year,
          month: ym.month,
          invoiceId: inv.id,
        });
      }
    }
    const withLink = unpaid.filter((inv) => inv.hasLink);
    const expiries = withLink
      .map((inv) => inv.paymentLinkExpiresAt)
      .filter((d): d is Date => d !== null);
    rows.push({
      ...base,
      action: "SETTLE",
      amount: sumDecimals(unpaid.map(remainingOf)),
      lines: [],
      invoiceIds: unpaid.map((inv) => inv.id),
      hadLink: withLink.length > 0,
      linkExpiresAt: expiries.length > 0 ? new Date(Math.max(...expiries.map((d) => d.getTime()))) : null,
    });
  }

  return {
    rows,
    total: sumDecimals(rows.map((r) => r.amount)),
    issues,
    blocked: issues.some((i) => i.blocking),
  };
}
