import { PAYMENT_METHOD_LABELS } from "@/lib/constants/payment-methods";

/**
 * What a wali sees for a payment's method — the app's invoice sheet and the
 * kuitansi PDF share this so a printed receipt never says "CASH" where the app
 * says "Tunai" (PARX-9).
 *
 * Built on the admin ledger's labels, except the two gateways: admin tells
 * "Virtual Account (Xendit)" from "(DOKU)", a parent only needs to know it was
 * a Virtual Account. An unknown or future enum value reads "Lainnya" rather
 * than leaking the raw name.
 */
export function parentPaymentMethodLabel(method: string): string {
  if (method === "XENDIT" || method === "DOKU") return "Virtual Account";
  return PAYMENT_METHOD_LABELS[method] ?? "Lainnya";
}
