import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";

/**
 * How an invoice's current payment link should read on screen (cycle
 * 2026-10-20-payment-link-expiry-display, D3/D4/D5). Shared by the admin detail
 * page and the invoice list column so the two never disagree.
 *
 *   - `null`         nothing to say: no link, or the invoice is settled/cancelled/not billed
 *   - `"active"`     the link works until `paymentLinkExpiresAt`
 *   - `"expired"`    the date has passed on an unpaid invoice (display only — the nightly
 *                    sweep may not have cleared the link yet)
 *   - `"unrecorded"` a link made before the date was stored (D4): we do not guess
 *
 * A link must exist: a stale date left behind after the link was cleared never shows (D3).
 * PAID / CANCELLED never show "expired" whatever the stored date (D5); they return `null`.
 */
export type PaymentLinkExpiryState = "active" | "expired" | "unrecorded";

export type PaymentLinkExpiryInput = {
  status: string;
  xenditPaymentUrl: string | null;
  /** ISO string over the wire, `Date` server-side. */
  paymentLinkExpiresAt: string | Date | null;
};

const BILLED_SET: ReadonlySet<string> = new Set(UNPAID_INVOICE_STATUSES);

export function paymentLinkExpiryState(
  invoice: PaymentLinkExpiryInput,
  now: Date = new Date(),
): PaymentLinkExpiryState | null {
  if (!invoice.xenditPaymentUrl) return null;
  if (invoice.status === "PAID" || invoice.status === "CANCELLED") return null;

  const raw = invoice.paymentLinkExpiresAt;
  const expiresAt = raw == null ? null : new Date(raw);
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return "unrecorded";

  if (expiresAt.getTime() > now.getTime()) return "active";
  return BILLED_SET.has(invoice.status) ? "expired" : null;
}
