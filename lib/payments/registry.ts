import { dokuGateway } from "./doku/client";
import { xenditGateway } from "./xendit/client";
import type { PaymentGateway } from "./types";
import { paymentLinkProvider } from "./link-provider";

/**
 * Resolve the active `PaymentGateway`, or the owner of a stored checkout URL for polling.
 *
 * `"xendit"` or unset → Xendit (keeps un-migrated environments working, per
 * AC-2). `"doku"` → DOKU Checkout (T2). Anything else throws with the
 * offending value in the message so a typo fails loud at call time rather
 * than silently falling back to Xendit.
 * Passing a recognized payment URL selects its original gateway; creation callers
 * omit that argument and always use the active environment setting.
 */
export function getGateway(paymentUrl?: string | null): PaymentGateway {
  // Existing links remain owned by their issuing gateway after an environment switch.
  // Creation callers pass no URL and continue to use PAYMENT_GATEWAY.
  const owner = paymentLinkProvider(paymentUrl);
  if (owner === "xendit" || owner === "demo-xendit") return xenditGateway;
  if (owner === "doku" || owner === "demo-doku") return dokuGateway;
  const value = process.env.PAYMENT_GATEWAY;

  if (value === undefined || value === "xendit") {
    return xenditGateway;
  }

  if (value === "doku") {
    return dokuGateway;
  }

  throw new Error(`Unrecognized PAYMENT_GATEWAY value: "${value}"`);
}
