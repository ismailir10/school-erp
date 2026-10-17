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
 * gateway call: a conditional `updateMany` stamps `paymentCheckedAt` only if the
 * invoice still has no link and was not claimed in the last 30 s. One caller wins
 * (count 1) and creates the session; the others see count 0 and wait briefly for
 * the winner's link to appear. It holds across serverless instances because the
 * state is in the database, and it needs no schema change: `paymentCheckedAt`
 * already means "a payment-status action touched this invoice just now".
 */

const UNPAID: ReadonlySet<string> = new Set(UNPAID_INVOICE_STATUSES);

/** A claim older than this is abandoned (the winner crashed) and can be taken again. */
const CLAIM_TTL_MS = 30_000;
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

  const claim = await prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      xenditPaymentUrl: null,
      OR: [
        { paymentCheckedAt: null },
        { paymentCheckedAt: { lt: new Date(now.getTime() - CLAIM_TTL_MS) } },
      ],
    },
    data: { paymentCheckedAt: now },
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

  // The failed attempt gives the claim back so the next caller is not held off for 30 s.
  const release = () =>
    prisma.invoice
      .updateMany({
        where: { id: invoiceId, xenditPaymentUrl: null },
        data: { paymentCheckedAt: invoice.paymentCheckedAt },
      })
      .catch(() => undefined);

  try {
    const session = await createPaymentSessionForInvoice(invoiceId, tenantId, requestOrigin);
    if (!session) {
      await release();
      return { kind: "NOT_PAYABLE" };
    }
    return { kind: "READY", paymentUrl: session.paymentUrl, created: true };
  } catch (err) {
    await release();
    console.error("[ENSURE LINK] session creation failed", {
      invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: "FAILED" };
  }
}
