// `after` runs work once the response is out; callers also have locals of that name.
import { after as afterResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { createPaymentSessionForInvoice } from "@/lib/payments/session";
import { LINK_CLEARED } from "@/lib/payments/link-cleared";

/**
 * Give an unpaid invoice a working payment link, creating one only if it has none.
 *
 * Cycle 2026-10-17-payment-link-on-demand. A link dies at the end of the due date and the
 * reconcile sweep then clears it, so an expired invoice has no link until someone makes
 * one. The parent's page and the admin's bulk button both do, through here.
 *
 * This is deliberately thin. The one-link-per-invoice guarantee lives in
 * `createPaymentSessionForInvoice`, the boundary every creation path crosses (the admin's
 * own action, the billing run and the retry queue included), so this wrapper only decides
 * who is allowed to ask (an unpaid invoice of the right school) and how the answer is
 * reported. It asks the helper to keep its claim after a failure: a failing invoice then
 * rests for the claim window instead of being retried on every press.
 */

const UNPAID: ReadonlySet<string> = new Set(UNPAID_INVOICE_STATUSES);

export type EnsureLinkResult =
  | { kind: "READY"; paymentUrl: string; created: boolean }
  | { kind: "NOT_PAYABLE" }
  | { kind: "FAILED" };

export async function ensurePaymentLink(
  invoiceId: string,
  tenantId: string,
  requestOrigin: string,
  opts: { now?: Date; waitForWinnerMs?: number } = {},
): Promise<EnsureLinkResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { tenantId: true, status: true, xenditPaymentUrl: true },
  });
  if (!invoice || invoice.tenantId !== tenantId || !UNPAID.has(invoice.status)) {
    return { kind: "NOT_PAYABLE" };
  }
  if (invoice.xenditPaymentUrl) {
    return { kind: "READY", paymentUrl: invoice.xenditPaymentUrl, created: false };
  }

  try {
    const session = await createPaymentSessionForInvoice(invoiceId, tenantId, requestOrigin, {
      holdClaimOnFailure: true,
      waitForWinnerMs: opts.waitForWinnerMs,
      now: opts.now,
    });
    if (session) return { kind: "READY", paymentUrl: session.paymentUrl, created: session.created };

    // The helper declined: either the invoice stopped being payable meanwhile, or another
    // caller held the claim and never produced a link. The row says which.
    const after = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } });
    return after && UNPAID.has(after.status) ? { kind: "FAILED" } : { kind: "NOT_PAYABLE" };
  } catch (err) {
    console.error("[ENSURE LINK] session creation failed", {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "FAILED" };
  }
}

/**
 * What a payment write sets on the invoice when it drops the link that charges the old
 * balance (cycle 2026-10-17-payment-link-reminders). Apply it in the same transaction as
 * the payment, and only when `scheduleRelink` will follow.
 *
 * `paymentCheckedAt: now` is the point: a link creator that read the balance before this
 * payment holds a claim stamp in the future and persists only while that stamp is
 * unchanged. Overwriting it makes that creator's write miss, so a link for the old balance
 * is never stored. "Now", not null, keeps the reconcile rotation honest, and the relink
 * below can still claim because a claim needs the stamp null or at most the current time.
 */
export const staleLinkCleared = (now: Date) => ({
  ...LINK_CLEARED,
  paymentLinkError: null,
  paymentCheckedAt: now,
});

/**
 * Make the replacement link once the response is out, so the admin does not wait on the
 * gateway. A failure leaves the invoice without a link; the nightly heal picks it up.
 * `origin` is the raw request origin: the session helper resolves it against the app URL.
 */
export function scheduleRelink(invoiceId: string, tenantId: string, origin: string, logTag: string): void {
  try {
    afterResponse(async () => {
      try {
        const link = await ensurePaymentLink(invoiceId, tenantId, origin, { waitForWinnerMs: 0 });
        if (link.kind === "READY" && link.created) {
          revalidateTag("parent-invoice-list", { expire: 0 });
          revalidateTag("student-invoices", { expire: 0 });
        }
      } catch (err) {
        console.error(`[${logTag}] relink failed`, {
          invoiceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  } catch (err) {
    console.error(`[${logTag}] could not schedule relink`, {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
