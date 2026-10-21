/**
 * The invoice columns that describe the current payment link, cleared together.
 *
 * Every write that drops a link (expiry, replacement, void, a payment that makes the
 * link charge the wrong balance) must spread this, so the stored expiry date can never
 * outlive the link it described (cycle 2026-10-20-payment-link-expiry-display, D3).
 * A clear site that sets the url/session to null by hand can forget the date; this
 * cannot. Kept free of imports so the webhook processor and routes can share it.
 */
export const LINK_CLEARED = {
  xenditSessionId: null,
  xenditPaymentUrl: null,
  paymentLinkExpiresAt: null,
} as const;
