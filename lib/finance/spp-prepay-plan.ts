import { Prisma } from "@/lib/generated/prisma/client";
import { formatMonthLabel, formatRupiah } from "@/lib/format";
import type { ResolvedLine } from "./apply-adjustments";
import { sumDecimals } from "./invoice-numbers";
import { lastDayOfMonth, parsePeriodMonth } from "./period-label";

/**
 * Pure planner for "Catat pembayaran di muka" (docs/cycles/2026-10-27-paid-invoice-spp-prepay.md,
 * D5-D12; the one-time fees part is docs/cycles/2026-10-30-prepay-other-fees.md, D1-D7).
 * No Prisma queries and no I/O: the caller loads the student's
 * invoices, prices each month the way the Billing Run would, and hands both in.
 */

export type YearMonth = { year: number; month: number }; // month 1-12

/** An existing invoice of the student, already loaded by the caller. */
export type PlanInvoice = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  status: string; // DRAFT | SENT | PARTIALLY_PAID | PAID | OVERDUE | CANCELLED | PENDING_PAYMENT_LINK
  totalDue: Prisma.Decimal;
  totalPaid: Prisma.Decimal;
  hasMonthlyLine: boolean; // true when the invoice has a line for a billable recurring fee component (SPP)
  monthlyAmount: Prisma.Decimal; // sum of finalAmount over its recurring (SPP) lines
  hasOtherLine: boolean; // true when it also carries a one-time fee line (uang pangkal, seragam, ...)
  feeComponentIds: string[]; // every fee component on its lines (the one-time caution matches on these)
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
export type PlanIssueCode =
  | "NO_PRICE"
  | "UNPARSABLE_LABEL"
  | "MULTIPLE_MONTHLY_INVOICES"
  | "SETTLES_OTHER_LINES"
  | "RANGE_INVALID"
  | "INVALID_COMPONENT"
  | "UNPAID_SAME_COMPONENT";
/** The one invoice a caution points at, so the admin can find it (plain numbers: it goes into the preview JSON). */
export type PlanInvoiceRef = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  status: string;
  totalDue: number;
  monthlyAmount: number;
};
export type PlanIssue = {
  code: PlanIssueCode;
  blocking: boolean;
  message: string;
  year?: number;
  month?: number;
  invoiceId?: string;
  invoice?: PlanInvoiceRef;
};

/** A fee component the one-time part may bill: enabled, ACTIVE, not recurring, this tenant's. */
export type OneTimeComponent = {
  id: string;
  label: string;
  sortOrder: number;
  /** The student's program fee-structure amount for the year, or null (no program / no year / no row). */
  prefillAmount: number | null;
};

/** What the admin typed for the one-time part (already validated and trimmed by the schema). */
export type OtherFeesInput = {
  label: string;
  lines: Array<{ feeComponentId: string; amount: number }>;
};

/** The one new invoice the one-time part creates. */
export type OtherFeesPlan = {
  label: string; // the invoice's periodLabel
  lines: Array<{ feeComponentId: string; label: string; amount: Prisma.Decimal }>;
  total: Prisma.Decimal;
};

const MAX_MONTHS = 12;

const monthIndex = (ym: YearMonth) => ym.year * 12 + (ym.month - 1);

function isValidYearMonth(ym: YearMonth): boolean {
  return Number.isInteger(ym.year) && Number.isInteger(ym.month) && ym.month >= 1 && ym.month <= 12;
}

function refOf(inv: PlanInvoice): PlanInvoiceRef {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    periodLabel: inv.periodLabel,
    status: inv.status,
    totalDue: Number(inv.totalDue),
    monthlyAmount: Number(inv.monthlyAmount),
  };
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
        invoice: refOf(inv),
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
          invoice: refOf(inv),
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

export const INVALID_COMPONENT_MESSAGE =
  "Ada komponen biaya yang tidak ditemukan, tidak aktif, atau bukan biaya sekali bayar. Muat ulang halaman lalu pilih lagi.";

/**
 * The one-time part (cycle 2026-10-30-prepay-other-fees). `components` is the
 * tenant's enabled, ACTIVE, non-recurring list, so a line whose component is not
 * in it is blocking (foreign tenant, disabled, inactive, recurring). An unpaid
 * (not PAID, not CANCELLED) invoice of the student that already carries a chosen
 * component only draws a caution (D7): a second instalment of the same component
 * is legitimate, recording the same uang pangkal twice is not.
 */
export function planOtherFees(args: {
  input: OtherFeesInput | null | undefined;
  components: Array<Pick<OneTimeComponent, "id" | "label">>;
  invoices: PlanInvoice[];
}): { plan: OtherFeesPlan | null; issues: PlanIssue[] } {
  const { input, components, invoices } = args;
  if (!input) return { plan: null, issues: [] };

  const byId = new Map(components.map((c) => [c.id, c]));
  const lines: OtherFeesPlan["lines"] = [];
  for (const line of input.lines) {
    const component = byId.get(line.feeComponentId);
    if (!component) {
      return {
        plan: null,
        issues: [{ code: "INVALID_COMPONENT", blocking: true, message: INVALID_COMPONENT_MESSAGE }],
      };
    }
    lines.push({ feeComponentId: component.id, label: component.label, amount: new Prisma.Decimal(line.amount) });
  }

  const chosen = new Set(lines.map((l) => l.feeComponentId));
  const labelOf = new Map(lines.map((l) => [l.feeComponentId, l.label]));
  const issues: PlanIssue[] = [];
  for (const inv of invoices) {
    if (inv.status === "PAID" || inv.status === "CANCELLED") continue;
    const matched = [...new Set(inv.feeComponentIds.filter((id) => chosen.has(id)))];
    if (matched.length === 0) continue;
    issues.push({
      code: "UNPAID_SAME_COMPONENT",
      blocking: false,
      message: `Siswa ini sudah punya tagihan belum lunas yang memuat ${matched.map((id) => labelOf.get(id)).join(", ")}. Jika wali membayar tagihan itu, gunakan Catat Pembayaran di tagihan tersebut.`,
      invoiceId: inv.id,
      invoice: refOf(inv),
    });
  }

  return { plan: { label: input.label, lines, total: sumDecimals(lines.map((l) => l.amount)) }, issues };
}
