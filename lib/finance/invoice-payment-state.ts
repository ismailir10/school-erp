import { Prisma } from "@/lib/generated/prisma/client";
import { sumDecimals } from "@/lib/finance/invoice-numbers";

/**
 * Single owner of "what does this invoice look like after its payments
 * changed". Used by the manual-record route AND the manual-reversal route so a
 * reversal can never disagree with what recording would have produced.
 * (The webhook processor keeps its own transitions but filters REVERSED rows
 * with the same `ACTIVE_PAYMENT_FILTER`.)
 *
 * A payment counts toward the invoice unless it is `REVERSED`.
 */
export const ACTIVE_PAYMENT_FILTER = { status: { not: "REVERSED" } } as const;

type InvoiceForState = {
  status: string;
  /**
   * Existing settlement stamp. Kept when a PAID invoice stays PAID (reversing
   * one payment of an overpaid invoice), so the parent's "Dibayar <date>" and
   * the receipt keep the real settlement date.
   */
  paidAt?: Date | null;
  totalDue: Prisma.Decimal | number | string;
  dueDate: string; // YYYY-MM-DD (Jakarta calendar day)
  sentAt: Date | null;
  xenditPaymentUrl: string | null;
  paymentLinkError: string | null;
};

/**
 * Status once no money is left on the invoice. Reversal is the only path
 * that gets here from PAID / PARTIALLY_PAID, and the row does not remember
 * what it was before the first payment, so derive the most faithful unpaid
 * state: ever sent (or has a link) -> SENT, or OVERDUE past its due date;
 * link creation failed -> PENDING_PAYMENT_LINK; otherwise DRAFT.
 */
export function unpaidStatusFor(
  invoice: Pick<InvoiceForState, "dueDate" | "sentAt" | "xenditPaymentUrl" | "paymentLinkError">,
  todayYmd: string,
): "SENT" | "OVERDUE" | "PENDING_PAYMENT_LINK" | "DRAFT" {
  if (invoice.sentAt || invoice.xenditPaymentUrl) {
    return invoice.dueDate < todayYmd ? "OVERDUE" : "SENT";
  }
  if (invoice.paymentLinkError) return "PENDING_PAYMENT_LINK";
  return "DRAFT";
}

/**
 * Pure status/paidAt derivation from a paid total.
 *
 * Money still owed after the due date is OVERDUE whether or not part of it
 * was paid, so the overdue figures count the families the school chases
 * (cycle 2026-10-17-payment-link-reminders D3). The paid amount lives in
 * `totalPaid`, not in the status; PARTIALLY_PAID is only "paid some, not yet
 * due". `todayYmd` is today's Jakarta calendar day, like `dueDate`.
 */
export function deriveInvoicePaymentState(
  invoice: InvoiceForState,
  totalPaid: Prisma.Decimal,
  todayYmd: string,
): { status: string; paidAt: Date | null } {
  const totalDue = new Prisma.Decimal(invoice.totalDue.toString());
  let status = invoice.status;
  if (totalPaid.gte(totalDue) && totalDue.gt(0)) status = "PAID";
  else if (totalPaid.gt(0)) status = invoice.dueDate < todayYmd ? "OVERDUE" : "PARTIALLY_PAID";
  else if (status === "PAID" || status === "PARTIALLY_PAID") {
    status = unpaidStatusFor(invoice, todayYmd);
  }
  if (status !== "PAID") return { status, paidAt: null };
  const keep = invoice.status === "PAID" && invoice.paidAt ? invoice.paidAt : null;
  return { status, paidAt: keep ?? new Date() };
}

/**
 * Re-read the invoice's non-reversed payments, then write totalPaid / status /
 * paidAt. Call inside the invoice advisory-lock transaction, after the payment
 * row was created or reversed.
 */
export async function recomputeInvoiceFromPayments(
  tx: Prisma.TransactionClient,
  invoice: InvoiceForState & { id: string },
  todayYmd: string,
): Promise<{ totalPaid: Prisma.Decimal; status: string }> {
  const payments = await tx.payment.findMany({
    where: { invoiceId: invoice.id, ...ACTIVE_PAYMENT_FILTER },
    select: { amount: true },
  });
  const totalPaid = sumDecimals(payments.map((p) => p.amount));
  const { status, paidAt } = deriveInvoicePaymentState(invoice, totalPaid, todayYmd);
  await tx.invoice.update({
    where: { id: invoice.id },
    data: { totalPaid, status, paidAt },
  });
  return { totalPaid, status };
}
