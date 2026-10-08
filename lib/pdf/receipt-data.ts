import type { Prisma } from "@/lib/generated/prisma/client";
import { ACTIVE_PAYMENT_FILTER } from "@/lib/finance/invoice-payment-state";
import { pickPrimaryEnrollment } from "@/lib/enrollment/active";
import { parentPaymentMethodLabel } from "@/lib/parent-payment-method";
import type { InvoiceReceiptData } from "@/lib/pdf/invoice-receipt";

/**
 * Shared by the guardian and admin kuitansi routes so both print the same
 * receipt: one `select` to load the invoice, one builder to turn it into the
 * PDF's props. Callers add their own tenant / ownership / status guards.
 */
export const RECEIPT_INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  periodLabel: true,
  dueDate: true,
  totalDue: true,
  totalPaid: true,
  status: true,
  paidAt: true,
  tenantId: true,
  studentId: true,
  lines: {
    select: {
      id: true,
      labelSnapshot: true,
      amount: true,
      finalAmount: true,
    },
    orderBy: { feeComponent: { sortOrder: "asc" } },
  },
  payments: {
    // A reversed manual payment is not money received — keep it out of the
    // parent's history and the receipt, consistent with totalPaid.
    where: ACTIVE_PAYMENT_FILTER,
    select: {
      id: true,
      amount: true,
      method: true,
      reference: true,
      paidAt: true,
    },
    orderBy: { paidAt: "desc" },
  },
  student: {
    select: {
      name: true,
      nickname: true,
      enrollments: {
        where: {
          status: "ACTIVE",
          // Exclude ARCHIVED-year rows. Un-closed prior-year ACTIVE
          // enrollments (bulk-import artifact — see T9 regression,
          // docs/cycles/2026-08-21-enrollment-flexibility.md) would
          // otherwise sit in `pickPrimaryEnrollment`'s pool alongside
          // the real current-year row and can win its earliest-
          // enrollDate tiebreak, naming last year's class + program on
          // the receipt header.
          classSection: { academicYear: { NOT: { status: "ARCHIVED" } } },
        },
        // No `take: 1` — a dual-enrolled student (sekolah + daycare)
        // needs every ACTIVE row so `pickPrimaryEnrollment` below can
        // pick the SEMESTER one. A receipt header must be singular.
        select: {
          id: true,
          enrollDate: true,
          classSection: {
            select: {
              name: true,
              program: { select: { name: true, type: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.InvoiceSelect;

export type ReceiptInvoice = Prisma.InvoiceGetPayload<{ select: typeof RECEIPT_INVOICE_SELECT }>;

const fmtIdDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
const fmtIdDateShort = (d: Date | string) =>
  new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

/** Payment methods whose `reference` is a gateway id a wali can quote to the bank. */
const GATEWAY_METHODS = new Set(["XENDIT", "DOKU"]);

/** Map a loaded invoice (see {@link RECEIPT_INVOICE_SELECT}) to the kuitansi PDF's props. */
export function buildReceiptData(invoice: ReceiptInvoice, tenantName: string | null | undefined): InvoiceReceiptData {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://talib.annisaasekolahku.com";

  const totalDue = Number(invoice.totalDue);
  const totalPaid = Number(invoice.totalPaid);

  const primaryEnrollment =
    invoice.student.enrollments.length <= 1
      ? (invoice.student.enrollments[0] ?? null)
      : pickPrimaryEnrollment(invoice.student.enrollments);

  return {
    schoolName: tenantName ?? "School",
    logoUrl: `${appUrl}/logo.png`,
    invoiceNumber: invoice.invoiceNumber,
    periodLabel: invoice.periodLabel,
    dueDate: fmtIdDate(invoice.dueDate),
    paidAt: invoice.paidAt ? fmtIdDate(invoice.paidAt) : null,
    studentName: invoice.student.name,
    studentNickname: invoice.student.nickname,
    className: primaryEnrollment?.classSection?.name ?? null,
    programName: primaryEnrollment?.classSection?.program.name ?? null,
    lines: invoice.lines.map((l) => ({
      label: l.labelSnapshot,
      amount: Number(l.finalAmount ?? l.amount),
    })),
    totalDue,
    totalPaid,
    remaining: Math.max(0, totalDue - totalPaid),
    payments: invoice.payments.map((p) => ({
      paidAt: fmtIdDateShort(p.paidAt),
      method: parentPaymentMethodLabel(p.method),
      // A manual payment's reference ("TT-Bulan-1", transfer no.) is the
      // admin's own bookkeeping, not something a wali needs on a receipt.
      reference: GATEWAY_METHODS.has(p.method) ? p.reference : null,
      amount: Number(p.amount),
    })),
    generatedDate: fmtIdDate(new Date()),
  };
}
