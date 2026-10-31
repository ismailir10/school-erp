import type { Prisma } from "@/lib/generated/prisma/client";
import { VOIDABLE_INVOICE_STATUSES } from "@/lib/constants/invoice-status";
import { ACTIVE_PAYMENT_FILTER } from "@/lib/finance/invoice-payment-state";
import { parsePeriodMonth } from "@/lib/finance/period-label";
import { leaveCoversMonth, monthIndex, parseYearMonth } from "./months";

export const OPEN_INVOICES_NOTE = "Tagihan dengan label periode lain tidak ditampilkan.";

export type OpenInvoiceLine = { label: string; finalAmount: number; isRecurring: boolean };

export type OpenInvoice = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  status: string;
  totalDue: number;
  dueDate: string;
  lines: OpenInvoiceLine[];
  /** At least one line is a non-recurring fee (a uniform, say) that would be cancelled with the invoice. */
  hasOneOffLines: boolean;
};

/**
 * The student's invoices that can still be cancelled and whose period label
 * names a single month inside the leave (`startMonth`..`endMonth`, `YYYY-MM`).
 *
 * "Cancellable" mirrors POST /api/invoices/[id]/void: a voidable status (or
 * PARTIALLY_PAID with every payment reversed) and no money booked. Anything that
 * took payment is left out. Invoices carry no enrollment link, so they match by
 * the free-text period label only; labels that are not a single month never match.
 * Read-only: nothing is cancelled here.
 */
export async function findOpenInvoicesForLeave(
  db: Pick<Prisma.TransactionClient, "invoice">,
  input: { tenantId: string; studentId: string; startMonth: string; endMonth: string },
): Promise<OpenInvoice[]> {
  const start = parseYearMonth(input.startMonth);
  const end = parseYearMonth(input.endMonth);
  if (!start || !end) return [];

  const invoices = await db.invoice.findMany({
    where: {
      tenantId: input.tenantId,
      studentId: input.studentId,
      status: { in: [...VOIDABLE_INVOICE_STATUSES, "PARTIALLY_PAID"] },
      totalPaid: { lte: 0 },
      payments: { none: { ...ACTIVE_PAYMENT_FILTER, amount: { gt: 0 } } },
    },
    select: {
      id: true,
      invoiceNumber: true,
      periodLabel: true,
      status: true,
      totalDue: true,
      dueDate: true,
      lines: {
        select: {
          labelSnapshot: true,
          finalAmount: true,
          feeComponent: { select: { isRecurring: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  return invoices
    .map((inv) => ({ inv, period: parsePeriodMonth(inv.periodLabel) }))
    .filter(
      (x): x is { inv: (typeof invoices)[number]; period: { year: number; month: number } } =>
        x.period !== null && leaveCoversMonth({ start, end }, x.period),
    )
    .sort(
      (a, b) =>
        monthIndex(a.period) - monthIndex(b.period) ||
        a.inv.invoiceNumber.localeCompare(b.inv.invoiceNumber),
    )
    .map(({ inv }) => {
      const lines = inv.lines.map((l) => ({
        label: l.labelSnapshot,
        finalAmount: Number(l.finalAmount),
        isRecurring: l.feeComponent.isRecurring,
      }));
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        periodLabel: inv.periodLabel,
        status: inv.status,
        totalDue: Number(inv.totalDue),
        dueDate: inv.dueDate,
        lines,
        hasOneOffLines: lines.some((l) => !l.isRecurring),
      };
    });
}

/**
 * True when the student holds another ACTIVE enrollment in the same academic
 * year as the leave's enrollment. Billing merges a student's enrollments into one
 * invoice, so cancelling an invoice for leave also cancels the other
 * placement's fees; the UI warns about it.
 */
export async function hasOtherActiveEnrollments(
  db: Pick<Prisma.TransactionClient, "studentEnrollment">,
  input: { tenantId: string; studentId: string; enrollmentId: string; academicYearId: string },
): Promise<boolean> {
  const count = await db.studentEnrollment.count({
    where: {
      studentId: input.studentId,
      status: "ACTIVE",
      id: { not: input.enrollmentId },
      classSection: { tenantId: input.tenantId, academicYearId: input.academicYearId },
    },
  });
  return count > 0;
}
