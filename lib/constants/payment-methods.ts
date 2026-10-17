/**
 * Payment method enum ↔ Bahasa labels. Single source of truth — was inlined
 * in app/admin/invoices/[id]/page.tsx; lifted here so the invoice detail and
 * the payments ledger render identical labels.
 */
import { paymentChannelLabel } from "@/lib/constants/payment-channels";

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "XENDIT", "DOKU", "OTHER"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods the payment gateways write; an admin never records these by hand. */
export const GATEWAY_PAYMENT_METHODS = ["XENDIT", "DOKU"] as const;

/**
 * Methods an admin may pick when recording a payment by hand. Gateway rails
 * are excluded: a hand-typed "Virtual Account" row would sit in reconciliation
 * as if the gateway had delivered it (FIN-23).
 */
export const MANUAL_PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "OTHER"] as const;

/** True for a payment the gateway created (cannot be reversed from the app). */
export function isGatewayPayment(p: { method: string; xenditPaymentId?: string | null }): boolean {
  return (
    (GATEWAY_PAYMENT_METHODS as readonly string[]).includes(p.method) || !!p.xenditPaymentId
  );
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Tunai",
  BANK_TRANSFER: "Transfer Bank",
  // Both gateways route through a bank Virtual Account, but they are two
  // different gateways — an identical label made the ledger and the manual
  // payment-method picker unable to tell them apart. voice.md.
  XENDIT: "Virtual Account (Xendit)",
  DOKU: "Virtual Account (DOKU)",
  OTHER: "Lainnya",
};

/**
 * Label for a payment. A gateway payment that stored the rail it came in on
 * reads as that rail ("Virtual Account BCA"); everything else — manual
 * payments, and gateway payments from before the channel was kept — reads as
 * its method.
 */
export function paymentMethodLabel(method: string, channelCode?: string | null): string {
  if (channelCode && (GATEWAY_PAYMENT_METHODS as readonly string[]).includes(method)) {
    return paymentChannelLabel(channelCode);
  }
  return PAYMENT_METHOD_LABELS[method] ?? method;
}
