import { prisma } from "@/lib/db";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { createPaymentSessionForInvoice } from "@/lib/payments/session";

/**
 * Give an unpaid invoice a working payment link, creating one only if it has
 * none — and creating it exactly once, however many callers ask at the same time.
 *
 * Cycle 2026-10-17-payment-link-on-demand. A link dies at the end of the due
 * date and the reconcile sweep then clears it, so an expired invoice has no link
 * until someone makes one. The parent's page and the admin's bulk button both do,
 * and a parent and an admin (or two tabs) can ask for the same invoice at once.
 *
 * The one-at-a-time guarantee is a database claim, not a lock held across the
 * gateway call: a conditional `updateMany` stamps `paymentCheckedAt` with a time
 * **in the future** (now + the claim window), and only if the invoice still has
 * no link and its stamp is not itself in the future. One caller wins (count 1) and
 * creates the session; the others see count 0 and wait briefly for the winner's
 * link to appear. It holds across serverless instances because the state is in
 * the database, and it needs no schema change.
 *
 * Why a future stamp: every payment check (`reconcileInvoicePayment`) also stamps
 * `paymentCheckedAt`, with the time it ran, which is never in the future. A past
 * stamp is therefore a harmless "checked a moment ago" (the parent route does one
 * just before this) and only a future one means "someone is creating the link".
 * A claim also keeps the sweep and the throttled checks off the invoice while it
 * is held.
 *
 * After a failed create the claim is deliberately NOT given back: it expires on
 * its own, so a failing invoice (a gateway outage, a request the gateway rejects)
 * costs at most one attempt per claim window across every instance, instead of a
 * retry per press. A create the session helper declines (the invoice was paid
 * meanwhile) is released, guarded by the claim time so it never touches a newer stamp.
 */

const UNPAID: ReadonlySet<string> = new Set(UNPAID_INVOICE_STATUSES);

/**
 * How long a claim lasts. Longer than a session create can take (10 s timeout x 3
 * tries plus backoff), so a slow winner is not overtaken, and short enough that a
 * crashed one frees the invoice quickly.
 */
const CLAIM_MS = 45_000;
/** How long a loser waits for the winner's link before giving up. */
const WAIT_FOR_WINNER_MS = 6_000;
const POLL_MS = 500;

export type EnsureLinkResult =
  | { kind: "READY"; paymentUrl: string; created: boolean }
  | { kind: "NOT_PAYABLE" }
  | { kind: "FAILED" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function ensurePaymentLink(
  invoiceId: string,
  tenantId: string,
  requestOrigin: string,
  opts: { now?: Date; waitForWinnerMs?: number } = {},
): Promise<EnsureLinkResult> {
  const now = opts.now ?? new Date();
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { tenantId: true, status: true, xenditPaymentUrl: true, paymentCheckedAt: true },
  });
  if (!invoice || invoice.tenantId !== tenantId || !UNPAID.has(invoice.status)) {
    return { kind: "NOT_PAYABLE" };
  }
  if (invoice.xenditPaymentUrl) {
    return { kind: "READY", paymentUrl: invoice.xenditPaymentUrl, created: false };
  }

  const claimedUntil = new Date(now.getTime() + CLAIM_MS);
  const claim = await prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      xenditPaymentUrl: null,
      // Not already claimed: a claim is a stamp in the future, a check is a stamp in the past.
      OR: [{ paymentCheckedAt: null }, { paymentCheckedAt: { lt: now } }],
    },
    data: { paymentCheckedAt: claimedUntil },
  });

  if (claim.count === 0) {
    // Someone else is creating it. Wait for their link rather than make a second one.
    const deadline = Date.now() + (opts.waitForWinnerMs ?? WAIT_FOR_WINNER_MS);
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const again = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { xenditPaymentUrl: true },
      });
      if (again?.xenditPaymentUrl) {
        return { kind: "READY", paymentUrl: again.xenditPaymentUrl, created: false };
      }
    }
    return { kind: "FAILED" };
  }

  // Only our own claim is touched, so a stamp someone else wrote meanwhile survives.
  const finish = (paymentCheckedAt: Date | null) =>
    prisma.invoice
      .updateMany({
        where: { id: invoiceId, paymentCheckedAt: claimedUntil },
        data: { paymentCheckedAt },
      })
      .catch(() => undefined);

  try {
    const session = await createPaymentSessionForInvoice(invoiceId, tenantId, requestOrigin);
    if (!session) {
      await finish(invoice.paymentCheckedAt);
      return { kind: "NOT_PAYABLE" };
    }
    // Done: the claim has served its purpose; record this as an ordinary check from now.
    await finish(new Date());
    return { kind: "READY", paymentUrl: session.paymentUrl, created: true };
  } catch (err) {
    console.error("[ENSURE LINK] session creation failed", {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "FAILED" };
  }
}
