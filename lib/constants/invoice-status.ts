/**
 * Bahasa labels for `Invoice.status`, for server-built messages (an API error
 * must never show a raw enum such as PENDING_PAYMENT_LINK — FIN-10). Mirrors
 * `STATUS_MAP` in components/ui/status-badge.tsx (a lib module must not import
 * a React component module); voice.md glossary is the source of truth.
 */
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Link Dibuat",
  PAID: "Lunas",
  OVERDUE: "Lewat Tempo",
  PARTIALLY_PAID: "Dibayar Sebagian",
  PENDING_PAYMENT_LINK: "Link Gagal",
  CANCELLED: "Dibatalkan",
};

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status] ?? "status ini";
}

/**
 * Statuses an invoice can be cancelled from — provided it has no active
 * (non-reversed) payment. PARTIALLY_PAID is included for the case where every
 * payment was reversed but the status was not yet recomputed; the void route
 * checks the actual payment rows, not just the label.
 */
export const VOIDABLE_INVOICE_STATUSES = [
  "DRAFT",
  "SENT",
  "PENDING_PAYMENT_LINK",
  "OVERDUE",
] as const;

/** Every stored `Invoice.status`. */
export const INVOICE_STATUS_VALUES = [
  "DRAFT",
  "PENDING_PAYMENT_LINK",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
] as const;

/**
 * Derived `?status=` values for the invoice list, not stored statuses
 * (cycle 2026-10-20-payment-link-expiry-display, D12).
 * `UNPAID` = "Belum lunas"; `NEEDS_LINK` = "Perlu link".
 */
export const INVOICE_DERIVED_FILTERS = ["UNPAID", "NEEDS_LINK"] as const;

/** Everything `GET /api/invoices?status=` accepts besides `all`. */
export const INVOICE_LIST_STATUS_VALUES = [...INVOICE_STATUS_VALUES, ...INVOICE_DERIVED_FILTERS] as const;
