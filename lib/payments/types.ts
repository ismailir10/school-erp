/**
 * Gateway-agnostic payment port.
 *
 * Introduced in cycle 2026-07-27-doku-payment-gateway T1 to seat a second
 * gateway (DOKU) behind the same interface Xendit already implements. Moved
 * verbatim from `lib/xendit/client.ts` — see that file's history for prior
 * provenance. Zero behaviour change in this task: `lib/xendit/client.ts` now
 * re-exports `GatewayApiError` as `XenditApiError` and `GatewayErrorCode` as
 * `XenditErrorCode` so existing consumers/tests are unaffected.
 */

/**
 * Classification codes for `GatewayApiError`. Callers (e.g. `withRetry`,
 * `prefixForError`) branch on this string-literal union.
 */
export type GatewayErrorCode =
  | "5xx"
  | "429"
  | "408"
  | "network"
  | "401"
  | "403"
  | "422"
  | "4xx"
  | "unknown";

/**
 * Typed error thrown by a `PaymentGateway` implementation so callers can
 * branch on `retriable` instead of regex-matching the error message.
 * `status` is null for network errors (fetch threw before getting a
 * response).
 */
export class GatewayApiError extends Error {
  readonly status: number | null;
  readonly code: GatewayErrorCode;
  readonly retriable: boolean;
  readonly retryAfterMs?: number;

  constructor(opts: {
    status: number | null;
    code: GatewayErrorCode;
    retriable: boolean;
    message: string;
    retryAfterMs?: number;
  }) {
    super(opts.message);
    this.name = "GatewayApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.retriable = opts.retriable;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export type CreateSessionParams = {
  referenceId: string;
  amount: number;
  description: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  successReturnUrl: string;
  cancelReturnUrl: string;
  /**
   * Absolute instant the payment session should stop accepting payment.
   * Defaults to 7 days from now when omitted.
   *
   * This is an instant, not a day-count, because a day-count cannot express
   * "expires at the end of the 10th" from an arbitrary creation instant. That
   * limitation was a real bug: before cycle 2026-08-20-invoice-due-date-to-gateway
   * this field was `expiryDays?: number` and `createPaymentSessionForInvoice`
   * passed a hardcoded `7` — so every Virtual Account expired 7 days after it
   * was issued regardless of the due date the admin had set on the invoice.
   * An invoice raised on the 1st with a month-end due date handed the parent a
   * VA that stopped working on the 8th.
   *
   * Each adapter converts as its API requires: Xendit takes the ISO instant
   * directly (`expires_at`), DOKU takes minutes-from-now (`payment_due_date`).
   *
   * The 7-day default survives for callers that have no invoice and therefore
   * no due date (the DOKU probe route, the reseed and finish-xendit scripts).
   * The invoice path must never reach it — `lib/payments/__tests__/session-expiry.test.ts`
   * asserts that.
   */
  expiresAt?: Date;
  items?: { name: string; quantity: number; price: number }[];
  /**
   * Absolute URL this deploy wants gateway notifications delivered to.
   *
   * DOKU maps it onto `additional_info.override_notification_url`, which wins
   * over the per-channel "Payment Notification URL" configured in Back Office
   * — so a channel whose Back Office field was never filled in still notifies
   * us, and a preview deploy receives its own notifications instead of
   * staging's. Xendit ignores it (its callback URL is account-global).
   *
   * Belt-and-braces, not a replacement: the Back Office values stay
   * configured, because if DOKU ever ignores the override the BO value is the
   * only thing standing between a settled payment and a silently stalled
   * invoice. Added cycle 2026-07-29-doku-all-va-channels.
   */
  notificationUrl?: string;
};

/** Gateway-neutral session shape returned by every `PaymentGateway.createSession`. */
export interface GatewaySession {
  id: string | null;
  paymentUrl: string;
  status: string;
  expiresAt: string;
}

/**
 * What a gateway needs in order to look a payment up. Both keys are supplied;
 * each adapter picks whichever its status endpoint is keyed on — Xendit needs
 * `sessionId` (`GET /sessions/{id}`), DOKU needs `invoiceId` (its
 * `invoice_number`, `GET /orders/v1/status/{invoice_number}`).
 */
export type GatewayStatusRef = {
  invoiceId: string;
  sessionId: string | null;
};

/**
 * Gateway-neutral lifecycle state, normalized from each provider's own status
 * vocabulary. Deliberately mirrors the `kind` values
 * `NormalizedPaymentEvent` already carries, so `lib/payments/reconcile.ts` can
 * map one onto the other without inventing new transitions:
 *
 *   COMPLETED   → kind "PAYMENT_COMPLETED"  (credit the invoice)
 *   EXPIRED     → kind "SESSION_EXPIRED"    (clear the dead link; past due: OVERDUE)
 *   REFUNDED    → kind "UNHANDLED" + REFUND_UNHANDLED (surface to admin)
 *   PENDING     → no transition (nobody has paid yet)
 *   FAILED      → no transition (a failed/voided attempt is not an expiry;
 *                 the payment link may still be usable for a retry)
 *   UNAVAILABLE → the gateway could not be queried at all — see
 *                 `unavailableReason`. No audit row is written for this.
 */
export type GatewayPaymentState =
  | "COMPLETED"
  | "PENDING"
  | "EXPIRED"
  | "FAILED"
  | "REFUNDED"
  | "UNAVAILABLE";

/**
 * Result of a read-only status poll. Field names match
 * `NormalizedPaymentEvent` so the reconciler is a straight field copy.
 *
 * `paymentId` is the inner idempotency key that lands in
 * `Payment.xenditPaymentId`. Each adapter MUST derive it with the same
 * fallback chain its webhook route uses, otherwise a manual refresh and a
 * later real webhook would produce two different keys for one settlement.
 */
export type GatewayPaymentStatus = {
  state: GatewayPaymentState;
  /** Provider's own status string, verbatim — shown to the admin for triage. */
  rawStatus: string | null;
  paymentId: string | null;
  amount: number | null;
  currency: string | null;
  channelCode: string | null;
  /** Provider response, stored verbatim in `WebhookEvent.payload`. */
  raw: unknown;
  /** Only set when `state === "UNAVAILABLE"`. */
  unavailableReason?: string;
};

/** Port implemented by each concrete payment gateway (Xendit, DOKU, ...). */
export interface PaymentGateway {
  readonly id: "xendit" | "doku";
  createSession(params: CreateSessionParams): Promise<GatewaySession>;
  ping(timeoutMs?: number): Promise<void>;
  /**
   * Read-only poll of the gateway's authoritative payment state. Added in
   * cycle 2026-07-28-manual-payment-refresh so an admin can reconcile an
   * invoice when the webhook never fired. MUST NOT mutate anything on the
   * gateway side — no capture, no void, no session re-creation.
   */
  fetchPaymentStatus(ref: GatewayStatusRef): Promise<GatewayPaymentStatus>;
}
