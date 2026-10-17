import { prisma } from "@/lib/db";
import { resolveSessionExpiry } from "@/lib/payments/expiry";
import { getGateway } from "@/lib/payments/registry";
import { withRetry } from "@/lib/payments/with-retry";
import { stripQuery } from "@/lib/payments/xendit/client";

/**
 * Gateway-agnostic session creation. Ported from `lib/xendit/helpers.ts` in
 * cycle 2026-07-27-doku-payment-gateway T3 — resolves the active
 * `PaymentGateway` via `getGateway()` instead of calling the Xendit client
 * concretely. `lib/xendit/helpers.ts` is now a thin re-export shim so no
 * consumer import path had to change in this task.
 */

/**
 * Resolve the origin for payment gateway success/cancel return URLs.
 *
 * Priority:
 *   1. `requestOrigin` (passed by route handlers from `new URL(req.url).origin`) —
 *      ensures preview/staging/prod each redirect to their own origin, not a
 *      hardcoded prod URL.
 *   2. `NEXT_PUBLIC_APP_URL` env var — fallback for script callers and
 *      contexts without a request scope.
 *   3. Throw — no silent prod fallback. Misconfigured deploys must fail
 *      loudly at session-creation time, not at the parent's confused-by-
 *      cross-origin-redirect time.
 *
 * Trailing slashes are stripped from both inputs because Vercel's env value
 * was previously configured with a "/" suffix, which produced
 * "https://host//payment/success?invoice=..." (double slash) and broke the
 * auto-redirect from Xendit's hosted checkout back to the parent portal.
 */
export function resolveAppOrigin(requestOrigin?: string): string {
  if (requestOrigin) return requestOrigin.replace(/\/+$/, "");
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/+$/, "");
  throw new Error(
    "No app origin available — pass requestOrigin or set NEXT_PUBLIC_APP_URL",
  );
}

/**
 * One link per invoice, however many callers ask at once.
 *
 * Every path that makes a payment link crosses `createPaymentSessionForInvoice`: the
 * admin's "Buat Link Pembayaran", the billing run, the retry queue, a new invoice, the
 * parent's "Buat link pembayaran" and the admin's "Buat link baru (N)" (cycle
 * 2026-10-17-payment-link-on-demand). Coordinating at this one boundary is what makes
 * them exclude each other, so no caller can skip the check.
 *
 * The coordination is a database claim, not a lock held across the gateway call. A
 * conditional `updateMany` stamps `paymentCheckedAt` with a time **in the future**
 * (now + `CLAIM_MS`), and only while the invoice has no link and no active claim. One
 * caller wins (count 1) and creates the session; the others find a link already stored,
 * or wait briefly for the winner's. A future stamp is what marks a claim: every
 * payment check stamps "now", which is never in the future, and `reconcileInvoicePayment`
 * leaves an active claim alone. The link is persisted only while the claim is still the
 * winner's, so a slow or stale creator can never overwrite a newer link.
 */
const CLAIM_MS = 45_000;
/** How long a caller that lost the claim waits for the winner's link. */
const WAIT_FOR_WINNER_MS = 6_000;
const POLL_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type CreateSessionOptions = {
  /** How long to wait for another caller's link when this one loses the claim. */
  waitForWinnerMs?: number;
  /**
   * Keep the claim after a failed create, so the invoice rests for `CLAIM_MS`. The parent
   * and the bulk button set it: a failing invoice then costs one gateway attempt per
   * claim window across every instance, not one per press. The admin's own actions leave
   * it off so a retry right after a fix is not held back.
   */
  holdClaimOnFailure?: boolean;
  now?: Date;
};

export type CreatedSession = {
  paymentUrl: string;
  /** False when the invoice already had a link, or another caller made it while we waited. */
  created: boolean;
};

/**
 * Create a payment gateway checkout session for a single invoice and update
 * the DB. Returns the payment URL on success, null on failure. Resolves the
 * active gateway via `getGateway()` — Xendit or DOKU, selected by
 * `PAYMENT_GATEWAY` — so this function's body does not change per gateway.
 *
 * `requestOrigin` should be `new URL(req.url).origin` from the calling
 * route handler so preview/staging/prod each get their own return URL host.
 */
export async function createPaymentSessionForInvoice(
  invoiceId: string,
  tenantId: string,
  requestOrigin?: string,
  opts: CreateSessionOptions = {},
): Promise<CreatedSession | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      student: {
        include: {
          guardians: { where: { isPrimary: true, status: "ACTIVE" }, take: 1, include: { parent: true } },
        },
      },
      lines: true,
    },
  });

  if (!invoice || invoice.tenantId !== tenantId) return null;
  if (invoice.status === "PAID" || invoice.status === "CANCELLED") return null;

  const remaining = Number(invoice.totalDue) - Number(invoice.totalPaid);
  if (remaining <= 0) return null;

  // Claim the invoice before any gateway work (see the note above `CLAIM_MS`).
  const now = opts.now ?? new Date();
  const claimedUntil = new Date(now.getTime() + CLAIM_MS);
  const claim = await prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      xenditPaymentUrl: null,
      OR: [{ paymentCheckedAt: null }, { paymentCheckedAt: { lt: now } }],
    },
    data: { paymentCheckedAt: claimedUntil },
  });
  if (claim.count === 0) {
    // Not ours: the invoice already has a link, or someone else is creating one.
    const deadline = Date.now() + (opts.waitForWinnerMs ?? WAIT_FOR_WINNER_MS);
    for (;;) {
      const again = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { xenditPaymentUrl: true },
      });
      if (again?.xenditPaymentUrl) return { paymentUrl: again.xenditPaymentUrl, created: false };
      if (Date.now() >= deadline) return null;
      await sleep(POLL_MS);
    }
  }

  const guardianParent = invoice.student.guardians[0]?.parent;
  const appOrigin = resolveAppOrigin(requestOrigin);
  const successReturnUrl = `${appOrigin}/parent/invoices?invoice=${invoice.id}&paymentStatus=paid`;
  const cancelReturnUrl = `${appOrigin}/parent/invoices?invoice=${invoice.id}&paymentStatus=cancel`;

  const gateway = getGateway();

  // Wrap the gateway call in withRetry so transient 5xx/408/429/network
  // errors retry up to 3 attempts before surfacing. The typed `GatewayApiError`
  // bubbles up on terminal failure so route-handler callers can prefix-tag
  // `paymentLinkError` (Task 4). TOCTOU guard, params build, and DB persist
  // remain outside the retry — only the network call itself is retried.
  let session: Awaited<ReturnType<typeof gateway.createSession>>;
  try {
    session = await withRetry(
      () =>
        gateway.createSession({
          referenceId: invoice.id,
          amount: remaining,
          description: `${invoice.invoiceNumber} — ${invoice.student.name} — ${invoice.periodLabel}`,
          customerName: guardianParent?.name ?? invoice.student.name,
          customerEmail: guardianParent?.email ?? undefined,
          customerPhone: guardianParent?.whatsapp ?? guardianParent?.phone ?? undefined,
          successReturnUrl,
          cancelReturnUrl,
          // Same origin the parent is browsing, so a preview/staging/prod
          // deploy each receive their own notifications. DOKU maps this onto
          // `additional_info.override_notification_url`, which outranks the
          // per-channel Back Office setting — the one place a missing Back
          // Office value would otherwise mean a paid invoice never credits.
          notificationUrl: `${appOrigin}/api/doku/webhook`,
          // The invoice's own due date, as the admin entered it — NOT a
          // constant. This line was `expiryDays: 7` until cycle
          // 2026-08-20-invoice-due-date-to-gateway, which meant every Virtual
          // Account expired seven days after issue no matter what "Tanggal Jatuh
          // Tempo" said, and an invoice raised early in the month died before its
          // own collection window closed. `invoice.dueDate` was already loaded
          // forty lines above; it was simply never told to the gateway.
          expiresAt: resolveSessionExpiry(invoice.dueDate),
          items: invoice.lines.map((line) => ({
            name: line.labelSnapshot,
            quantity: 1,
            price: Number(line.finalAmount),
          })),
        }),
      { invoiceId, tenantId },
    );
  } catch (err) {
    // Give the claim back so a retry is not held off, unless the caller wants the rest.
    if (!opts.holdClaimOnFailure) {
      await prisma.invoice
        .updateMany({
          where: { id: invoiceId, paymentCheckedAt: claimedUntil },
          data: { paymentCheckedAt: invoice.paymentCheckedAt },
        })
        .catch(() => undefined);
    }
    throw err;
  }

  // Persist only while our claim still stands and the invoice is still payable. If the claim
  // was lost the session we just made is dropped (it expires unused at the gateway) and the
  // link that won is returned instead; the stored link and session id always belong together.
  const persist = (where: Record<string, unknown>) =>
    prisma.invoice.updateMany({
      where: { id: invoiceId, status: { notIn: ["PAID", "CANCELLED"] }, ...where },
      data: {
        xenditSessionId: session.id,
        xenditPaymentUrl: session.paymentUrl,
        paymentCheckedAt: new Date(),
      },
    });
  let stored = await persist({ paymentCheckedAt: claimedUntil });
  if (stored.count === 0) stored = await persist({ xenditPaymentUrl: null });
  if (stored.count === 0) {
    const winner = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { xenditPaymentUrl: true },
    });
    console.warn("[PAYMENT SESSION NOT STORED]", { gateway: gateway.id, invoiceId, sessionId: session.id });
    return winner?.xenditPaymentUrl ? { paymentUrl: winner.xenditPaymentUrl, created: false } : null;
  }

  // Operator triage: emit one structured line per session so an operator
  // can grep by sessionId and match against the webhook PROCESSED line.
  // Stripped URLs leave `?invoice=` ids out of logs while preserving the
  // origin (preview/staging/prod) — the field operators need to verify.
  //
  // `customerEmailPresent` is a boolean, never the address itself — the
  // address is PII and `lib/webhook/redact-payload.ts` strips it everywhere
  // else, so logging it here would defeat that. Under DOKU the gateway emails
  // the Virtual Account number to `customer.email`; when the primary guardian
  // has no address on file the parent is never told which VA to pay and the
  // invoice silently stalls at SENT. That is invisible without this flag —
  // the session still succeeds and still returns a payment URL.
  const customerEmailPresent = Boolean(guardianParent?.email);
  console.info("[PAYMENT SESSION CREATED]", {
    gateway: gateway.id,
    invoiceId,
    sessionId: session.id,
    customerEmailPresent,
    successOrigin: stripQuery(successReturnUrl),
    cancelOrigin: stripQuery(cancelReturnUrl),
  });
  if (!customerEmailPresent) {
    console.warn("[PAYMENT SESSION NO CUSTOMER EMAIL]", {
      gateway: gateway.id,
      invoiceId,
      hasPrimaryGuardian: Boolean(guardianParent),
    });
  }

  return { paymentUrl: session.paymentUrl, created: true };
}
