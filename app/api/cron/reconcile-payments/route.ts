// @public — Vercel Cron endpoint, gated by CRON_SECRET bearer token (not user session).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { limit } from "@/lib/finance/concurrency-limit";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { reconcileEnrollmentFee, reconcileInvoicePayment } from "@/lib/payments/reconcile";

/**
 * Daily payment reconciliation sweep — the safety net for a gateway
 * notification that never arrives.
 *
 * ### Schedule, and why it is not hourly
 *
 * Runs at 00:30 UTC (07:30 WIB), deliberately **before**
 * `/api/cron/finance-maintenance` at 01:00 UTC: reconcile first, so an
 * invoice a parent actually paid is not then promoted to OVERDUE and chased.
 *
 * Hourly would be better — worst-case credit delay would be an hour instead
 * of a day — but Vercel's Hobby plan permits cron jobs *once per day* and at
 * most two per project, and a deployment carrying `0 * * * *` is rejected
 * outright (verified: PR #420 build failed on exactly that). Moving to Pro
 * would allow the tighter schedule. Until then the admin "Perbarui
 * pembayaran" button remains the way to credit a payment immediately.
 *
 * ### Why this exists
 *
 * Under DOKU Virtual Account the notification is the only *push* signal that a
 * parent paid: they get a VA number and pay at an ATM hours later, with no
 * redirect back. If that notification is lost, the money is collected by the
 * gateway and Talib shows nothing — the invoice sits at SENT, the parent
 * believes they have paid, and the admin has no error to react to. Silent, and
 * the worst possible failure mode for a billing system.
 *
 * That is not hypothetical. As of cycle 2026-07-29-doku-all-va-channels, a
 * `WebhookEvent` audit showed **zero** DOKU notifications had ever verified —
 * every DOKU payment on staging was credited by an admin manually pressing
 * "Perbarui pembayaran". A live sandbox payment reproduced it: DOKU recorded
 * the settlement (the status poll found it) but no notification was delivered.
 * The Xendit route, by contrast, has real webhook rows. So the push path is
 * unreliable in practice while the pull path works.
 *
 * This route makes the pull path automatic instead of depending on an admin
 * noticing. It does not replace the webhook — when a notification does arrive
 * it still credits immediately, and this sweep then no-ops on the dedup.
 *
 * ### Why it is safe to run repeatedly
 *
 * It performs no state transitions of its own. `reconcileInvoicePayment` polls
 * the gateway read-only and hands the result to the same `processPaymentEvent`
 * the webhook uses, so every guard applies verbatim: the durable WebhookEvent
 * receipt, the deterministic `eventId` → P2002 dedup, the per-invoice advisory
 * lock, the amount/currency checks, the overpayment tolerance, and the
 * PAID/CANCELLED short-circuits. Re-running is a no-op by construction.
 *
 * Auth mirrors `/api/cron/finance-maintenance`: `Authorization: Bearer
 * ${CRON_SECRET}` plus a `vercel-cron/` User-Agent, both fail-closed.
 */

/**
 * Cap per run. Each candidate costs one outbound gateway call, and Vercel
 * caps function duration — an unbounded sweep over a full billing cycle's
 * invoices would time out and reconcile nothing at all. At the pilot's ~179
 * students one daily run covers the whole outstanding set several times over.
 *
 * Ordering is `dueDate asc` (indexed, and the most-overdue invoice is the one
 * whose missing payment hurts most). Note this is a *priority* order, not a
 * rotation: if outstanding invoices ever exceed this cap for a sustained
 * period, the newest-due tail would never be polled. `cappedAtLimit` in the
 * response exists to make that visible before it becomes a problem.
 */
const MAX_PER_RUN = 200;

/** Concurrent gateway polls. Matches the bulk link-generation limiter. */
const CONCURRENCY = 5;

/**
 * Cap for pendaftaran fees per run. Far fewer than invoices (one per applicant,
 * only while UNPAID and holding a link), least recently checked first.
 */
const MAX_FEES_PER_RUN = 100;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[CRON] CRON_SECRET not set — refusing to run.");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userAgent = req.headers.get("user-agent") ?? "";
  if (!userAgent.startsWith("vercel-cron/")) {
    console.warn(`[CRON] Suspicious UA: ${userAgent}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Candidates: outstanding invoices that actually have a gateway session.
  // Without a payment URL no checkout was ever started, so the gateway has
  // nothing to report and the poll would burn a request to learn nothing.
  const candidates = await prisma.invoice.findMany({
    where: {
      status: { in: [...UNPAID_INVOICE_STATUSES] },
      xenditPaymentUrl: { not: null },
    },
    select: { id: true },
    orderBy: { dueDate: "asc" },
    take: MAX_PER_RUN,
  });

  const run = limit(CONCURRENCY);
  const results = await Promise.all(
    candidates.map((invoice) =>
      run(async () => {
        try {
          const result = await reconcileInvoicePayment(invoice.id);
          return result.code;
        } catch (err) {
          // One invoice must never abort the sweep — a single gateway hiccup
          // would otherwise strand every later candidate until the next run.
          console.error("[CRON RECONCILE] Invoice failed", {
            invoiceId: invoice.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return "GATEWAY_ERROR" as const;
        }
      }),
    ),
  );

  // Pendaftaran fees (cycle 2026-10-10-pendaftaran-fee-payment): a parent pays
  // with no login, so nobody presses "Perbarui pembayaran" for them. Same
  // read-only poll through the shared processor, own cap, own tally.
  const feeCandidates = await prisma.enrollmentFee.findMany({
    where: { status: "UNPAID", paymentUrl: { not: null } },
    select: { id: true },
    // Least recently checked first (never-checked leading), so a fee that stays
    // unresolved cannot crowd newer ones out of the cap run after run.
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: MAX_FEES_PER_RUN,
  });
  const feeResults = await Promise.all(
    feeCandidates.map((fee) =>
      run(async () => {
        try {
          const result = await reconcileEnrollmentFee(fee.id);
          return result.code;
        } catch (err) {
          console.error("[CRON RECONCILE] Enrollment fee failed", {
            feeId: fee.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return "GATEWAY_ERROR" as const;
        }
      }),
    ),
  );

  const tally = results.reduce<Record<string, number>>((acc, code) => {
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});
  const feeTally = feeResults.reduce<Record<string, number>>((acc, code) => {
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});

  // `updated` is the number that matters: each one is a payment the gateway
  // had taken and Talib did not know about.
  const updated = tally.UPDATED ?? 0;
  const feesUpdated = feeTally.UPDATED ?? 0;
  if (updated > 0 || feesUpdated > 0) {
    console.warn("[CRON RECONCILE] Credited payments the webhook never delivered", {
      updated,
      feesUpdated,
      scanned: candidates.length,
      feesScanned: feeCandidates.length,
    });
  }

  // Surfaced so an operator can tell "nothing to do" from "hit the cap and
  // there is more waiting" — a run that is always at MAX_PER_RUN means the
  // schedule is too slow for the volume.
  return NextResponse.json({
    scanned: candidates.length,
    cappedAtLimit: candidates.length === MAX_PER_RUN,
    updated,
    tally,
    enrollmentFees: {
      scanned: feeCandidates.length,
      cappedAtLimit: feeCandidates.length === MAX_FEES_PER_RUN,
      updated: feesUpdated,
      tally: feeTally,
    },
    ranAt: new Date().toISOString(),
  });
}
