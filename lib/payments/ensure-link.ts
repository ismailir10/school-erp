import { prisma } from "@/lib/db";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { createPaymentSessionForInvoice } from "@/lib/payments/session";

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
