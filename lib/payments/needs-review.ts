/** A second, different payment landed on an invoice that is already Lunas. Not credited. */
export const DUPLICATE_PAYMENT_AFTER_PAID = "DUPLICATE_PAYMENT_AFTER_PAID";

/** A payment landed on an invoice that was voided (Dibatalkan). Not credited. */
export const PAID_ON_CANCELLED_INVOICE = "PAID_ON_CANCELLED_INVOICE";

/** A payment larger than the invoice's remaining balance. Credited, but flagged. */
export const OVERPAYMENT_FLAGGED = "OVERPAYMENT_FLAGGED";

/**
 * Invoice webhook ERROR codes (`WebhookEvent.errorMessage`) that mean money is at the gateway and
 * a person must reconcile it. Shown to staff as "Perlu dicek".
 */
export const NEEDS_REVIEW_ERROR_CODES = [
  DUPLICATE_PAYMENT_AFTER_PAID,
  PAID_ON_CANCELLED_INVOICE,
  OVERPAYMENT_FLAGGED,
] as const;
