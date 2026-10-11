/**
 * Gateway checkout link for a pendaftaran fee (cycle 2026-10-10-pendaftaran-fee-payment).
 *
 * The parent has no login and no Student/Invoice yet, so the fee is paid
 * through its own `EnrollmentFee` row. It reuses the same `PaymentGateway` port
 * invoices use; the gateway `referenceId` is the EnrollmentFee id, which the
 * shared webhook processor resolves after Invoice (see webhook-processor.ts).
 *
 * Server-only. Called from the public `/pay` route and (re-issuing a link)
 * from staff actions. Pay-first: the fee exists from the moment staff send the
 * formulir, so a link can be minted while the application is still INVITED.
 */

import { prisma } from "@/lib/db";
import { formatPaymentLinkError } from "@/lib/payments/error-prefix";
import { defaultExpiresAt } from "@/lib/payments/expiry";
import { getGateway } from "@/lib/payments/registry";
import { resolveAppOrigin } from "@/lib/payments/session";
import { withRetry } from "@/lib/payments/with-retry";
import { isFeeClosed } from "./fee-closed";

/** A stored link with less than this left is replaced, not handed to a parent about to pay. */
const REUSE_MARGIN_MS = 10 * 60 * 1000;

export type FeePaymentLink =
  | { kind: "LINK"; paymentUrl: string; reused: boolean }
  | { kind: "SETTLED"; status: "PAID" | "WAIVED" }
  /** Staff rejected the application or cancelled the lead: the fee is no longer collected online. */
  | { kind: "CLOSED" }
  | { kind: "NO_FEE" }
  | { kind: "FAILED" };

/** Parent-facing, fixed text. Raw gateway errors are logged, never rendered. */
export const FEE_LINK_FAILED_MESSAGE = "Tautan pembayaran belum bisa dibuat. Coba lagi sebentar.";

/**
 * Hand back a payable link for the application's fee: the stored one while it
 * has time left, otherwise a fresh gateway session. `tenantId` comes from the
 * caller's own resolved credential (token row / staff session) and must match
 * the fee, so a mismatched pair reads as "no fee" rather than leaking a link.
 *
 * Concurrency: the gateway call happens outside any DB lock, so two requests
 * can each mint a session. Only ONE is stored — the write is a compare-and-set
 * that applies only while the fee is still UNPAID, still the amount the session
 * was priced at, and still without a usable link. The loser re-reads and hands
 * back the winner's link, so a parent is only ever given one live order; the
 * orphan is never reachable. (A staff discount change mid-flight changes the
 * amount, so the stale session is dropped the same way.)
 */
export async function getOrCreateFeePaymentLink(opts: {
  applicationId: string;
  tenantId: string;
  token: string;
  requestOrigin?: string;
  now?: Date;
}): Promise<FeePaymentLink> {
  return resolveLink(opts, 0);
}

async function resolveLink(
  opts: { applicationId: string; tenantId: string; token: string; requestOrigin?: string; now?: Date },
  attempt: number,
): Promise<FeePaymentLink> {
  const now = opts.now ?? new Date();
  const reuseCutoff = new Date(now.getTime() + REUSE_MARGIN_MS);
  const fee = await prisma.enrollmentFee.findUnique({
    where: { applicationId: opts.applicationId },
    include: {
      application: {
        select: {
          status: true,
          childName: true,
          parentEmail: true,
          admission: { select: { status: true, parentName: true, parentEmail: true, parentPhone: true, parentWhatsapp: true } },
        },
      },
    },
  });
  if (!fee || fee.tenantId !== opts.tenantId) return { kind: "NO_FEE" };
  if (fee.status === "PAID" || fee.status === "WAIVED") return { kind: "SETTLED", status: fee.status };
  // Works while the form is still INVITED (pay-first) as well as after submit.
  // A rejected application or a cancelled lead is closed: no link is handed out.
  if (isFeeClosed(fee.application)) return { kind: "CLOSED" };

  const amount = Number(fee.amount);
  if (!(amount > 0)) return { kind: "NO_FEE" };

  if (fee.paymentUrl && fee.sessionExpiresAt && fee.sessionExpiresAt.getTime() > reuseCutoff.getTime()) {
    return { kind: "LINK", paymentUrl: fee.paymentUrl, reused: true };
  }

  // Exactly the rows whose stored link is NOT usable. Used for both writes below.
  const noUsableLink = {
    OR: [{ paymentUrl: null }, { sessionExpiresAt: null }, { sessionExpiresAt: { lte: reuseCutoff } }],
  };

  const admission = fee.application.admission;
  const origin = resolveAppOrigin(opts.requestOrigin);
  const returnBase = `${origin}/pendaftaran/${encodeURIComponent(opts.token)}/pembayaran`;
  const expiresAt = defaultExpiresAt(now);

  try {
    const session = await withRetry(
      () =>
        getGateway().createSession({
          referenceId: fee.id,
          amount,
          // Pay-first: the fee is paid before the child is named, so the name may be blank.
          description: fee.application.childName.trim() ? `Biaya pendaftaran — ${fee.application.childName}` : "Biaya pendaftaran",
          customerName: admission?.parentName || fee.application.childName,
          customerEmail: admission?.parentEmail ?? fee.application.parentEmail ?? undefined,
          customerPhone: admission?.parentWhatsapp ?? admission?.parentPhone ?? undefined,
          successReturnUrl: `${returnBase}?status=paid`,
          cancelReturnUrl: `${returnBase}?status=cancel`,
          // Same origin the parent is browsing, so preview/staging/prod each
          // get their own notifications (see CreateSessionParams.notificationUrl).
          notificationUrl: `${origin}/api/doku/webhook`,
          expiresAt,
          items: [{ name: "Biaya pendaftaran", quantity: 1, price: amount }],
        }),
      // The retry helper's log context is invoice-shaped; the fee id is the reference.
      { invoiceId: fee.id, tenantId: fee.tenantId },
    );

    const stored = await prisma.enrollmentFee.updateMany({
      where: {
        id: fee.id,
        status: "UNPAID",
        amount: fee.amount,
        ...noUsableLink,
        // A reject or cancel landing between the CLOSED check above and this write
        // must not leave a payable link stored (the same rule as `isFeeClosed`).
        application: { status: { not: "REJECTED" }, admission: { status: { not: "CANCELLED" } } },
      },
      data: {
        gatewaySessionId: session.id,
        paymentUrl: session.paymentUrl,
        sessionExpiresAt: expiresAt,
        linkError: null,
      },
    });
    if (stored.count === 1) {
      console.info("[ENROLLMENT FEE SESSION CREATED]", { gateway: getGateway().id, feeId: fee.id, sessionId: session.id });
      return { kind: "LINK", paymentUrl: session.paymentUrl, reused: false };
    }

    // Lost the race (another request stored a link, staff changed the amount,
    // or the fee was settled meanwhile): the session just minted is dropped
    // unseen. Re-read once and answer from the current state.
    console.warn("[ENROLLMENT FEE SESSION DISCARDED]", { feeId: fee.id, sessionId: session.id, attempt });
    return attempt === 0 ? resolveLink(opts, 1) : { kind: "FAILED" };
  } catch (err) {
    // Prefixed like invoices' paymentLinkError so the same triage reads it.
    const linkError = formatPaymentLinkError(err);
    console.error("[ENROLLMENT FEE SESSION FAILED]", { feeId: fee.id, linkError });
    // Only when there is no working link: a failure here must not paint an
    // error over a fee that another request just gave a good one.
    await prisma.enrollmentFee
      .updateMany({ where: { id: fee.id, ...noUsableLink }, data: { linkError } })
      .catch(() => undefined);
    return { kind: "FAILED" };
  }
}
