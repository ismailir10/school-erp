// @public — bearer-gated diagnostic, auth via CRON_SECRET (no user session).
import { NextRequest, NextResponse } from "next/server";

import { createDokuSession, getDokuOrderStatus } from "@/lib/payments/doku/client";
import { GatewayApiError } from "@/lib/payments/types";
import { bearerMatches } from "@/lib/security/bearer";

/**
 * DOKU Checkout endpoint-version probe.
 *
 * ### Why a route and not a script
 *
 * `scripts/doku-probe-checkout.mjs` does the same experiment from a laptop —
 * but it needs `DOKU_CLIENT_ID` and `DOKU_SECRET_KEY` in the local
 * environment, and both are marked **Sensitive** in Vercel: `vercel env pull`
 * returns them as empty strings and there is no read-back API. Running the
 * probe from inside a deployment is the only way to sign a real request
 * without first copying a live secret onto a developer machine. The script
 * stays for anyone who does hold the credentials out-of-band.
 *
 * ### What it answers
 *
 * This merchant has never received a DOKU notification — two settled sandbox
 * VA payments, zero delivery attempts in DOKU's own Notification Center
 * (cycle 2026-07-29-doku-all-va-channels). DOKU support (ticket
 * 1115484:1806761, 2026-07-30) replied that
 * `additional_info.override_notification_url` "is supported for the API V2
 * Checkout", and `/checkout/v2/payment` is genuinely routed even though only
 * v1 is documented. So: create one session on each version, settle both VAs
 * in the sandbox simulator, and see which — if either — produces a
 * notification.
 *
 * The session is built by `createDokuSession`, the same function that serves
 * real parents, so a difference in outcome is attributable to the endpoint
 * version and nothing else. It writes nothing to the database: no Invoice, no
 * Payment. The only durable trace is the `WebhookEvent` receipt that DOKU's
 * notification would create if one ever arrives — which is precisely the
 * signal being hunted, and which survives long after Vercel's runtime logs
 * have rolled off. `referenceId` is a synthetic `PROBE-…` string, so that
 * receipt lands as an unmatched-invoice event and can never credit anything.
 *
 * ### Guards
 *
 * - `Authorization: Bearer ${CRON_SECRET}` — same fail-closed shape as
 *   `/api/cron/reconcile-payments`. No `vercel-cron/` User-Agent check: this
 *   is invoked by a human or an agent, not by the scheduler.
 * - Refuses outright when `DOKU_ENV=production`. The probe mints a real
 *   Checkout session; against the live merchant that is a real payable VA
 *   number attached to no invoice, and it would burn one of the five
 *   transactions the not-yet-fully-verified production account is capped at.
 * - Refuses under `DEMO_MODE`, where `createDokuSession` short-circuits to a
 *   synthetic session and the run would prove nothing while looking like it
 *   had.
 *
 * Delete this route once DOKU notifications are confirmed working end to end.
 */

/** Nominal — small enough to be obviously non-real in DOKU's dashboard. */
const PROBE_AMOUNT = 10_000;

/**
 * Synthetic customer. No real guardian PII is sent: `notificationUrl` is
 * caller-supplied and may point at a third-party request bin.
 */
const PROBE_CUSTOMER = {
  customerName: "Probe Wali Murid",
  customerEmail: "doku-probe@example.test",
  customerPhone: "6281277226711",
} as const;

const PROBE_RETURN_URL = "https://example.test/parent/invoices";

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[DOKU PROBE] CRON_SECRET not set — refusing to run.");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (!bearerMatches(req.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.DOKU_ENV === "production") {
    return NextResponse.json(
      {
        error:
          "Refusing to probe the live DOKU merchant — this mints a real, payable VA number.",
      },
      { status: 403 },
    );
  }
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json(
      {
        error:
          "DEMO_MODE short-circuits createDokuSession; the probe would return a synthetic session and prove nothing.",
      },
      { status: 409 },
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const input = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;

  // ── Status mode. `{"checkReference":"PROBE-V2-…"}` polls DOKU's own
  // `GET /orders/v1/status/{invoice_number}` for a reference this route minted
  // earlier, instead of creating a new session.
  //
  // This is the control that turns "no notification arrived" into evidence. A
  // settled VA that DOKU reports as SUCCESS while our webhook logged no
  // inbound request at all can only mean DOKU never dispatched — it rules out
  // a failed payment, a signature rejection, and a wrong URL in one call.
  // Without it the ticket is "we didn't get anything", which their first reply
  // already deflected.
  const checkReference =
    typeof input.checkReference === "string" && input.checkReference.length > 0
      ? input.checkReference
      : null;
  if (checkReference) {
    try {
      const status = await getDokuOrderStatus({
        invoiceId: checkReference,
        sessionId: null,
      });
      return NextResponse.json({ ok: true, checkReference, status });
    } catch (err) {
      if (err instanceof GatewayApiError) {
        return NextResponse.json(
          {
            ok: false,
            checkReference,
            gatewayStatus: err.status,
            code: err.code,
            message: err.message,
          },
          { status: 502 },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, checkReference, message },
        { status: 500 },
      );
    }
  }

  // `resolveCheckoutTarget` throws on anything but v1/v2 — let it, and report
  // the message. A typo must not silently run the version it was meant to be
  // compared against.
  const version =
    typeof input.version === "string" ? input.version : undefined;
  const notificationUrl =
    typeof input.notificationUrl === "string" && input.notificationUrl.length > 0
      ? input.notificationUrl
      : `${new URL(req.url).origin}/api/doku/webhook`;

  // Version goes in the reference so DOKU's own dashboard, the checkout page
  // and any notification that arrives all name the arm of the experiment.
  const referenceId = `PROBE-${(version ?? "env").toUpperCase()}-${Date.now()}`;

  // Captured out here so a failed distillation still reports what DOKU
  // actually answered — the whole point of the v2 arm, whose response contract
  // is undocumented.
  let raw: unknown = null;

  try {
    const session = await createDokuSession(
      {
        referenceId,
        amount: PROBE_AMOUNT,
        description: `DOKU endpoint probe ${referenceId}`,
        ...PROBE_CUSTOMER,
        successReturnUrl: PROBE_RETURN_URL,
        cancelReturnUrl: PROBE_RETURN_URL,
        notificationUrl,
        // One day. A real invoice derives its expiry from its own due date; a
        // probe has no invoice, and a probe VA should not linger in the
        // merchant's outstanding list.
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      {
        checkoutVersion: version,
        captureRaw: (envelope) => {
          raw = envelope;
        },
      },
    );

    console.info("[DOKU PROBE] session created", {
      referenceId,
      version: version ?? process.env.DOKU_CHECKOUT_VERSION ?? "v1 (default)",
      notificationUrl,
    });

    return NextResponse.json({
      ok: true,
      referenceId,
      version: version ?? process.env.DOKU_CHECKOUT_VERSION ?? "v1",
      notificationUrl,
      session,
      raw,
      next: [
        "Open session.paymentUrl, pick a VA channel, copy the VA number.",
        "Settle it at https://sandbox.doku.com/integration/simulator/ (NON-SNAP row — Checkout mints non-SNAP VAs).",
        "Then check, in order: WebhookEvent rows for a doku.* eventType; Vercel runtime logs for [DOKU WEBHOOK]; Back Office → Settings → Notification → HTTP Notifications → Notifikasi.",
      ],
    });
  } catch (err) {
    if (err instanceof GatewayApiError) {
      // DOKU's own rejection text (e.g. "PAYMENT CHANNEL IS INACTIVE") is the
      // most informative part of a failed run — surface it rather than a
      // generic 502.
      return NextResponse.json(
        {
          ok: false,
          referenceId,
          gatewayStatus: err.status,
          code: err.code,
          message: err.message,
          raw,
        },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DOKU PROBE] failed", { referenceId, message });
    return NextResponse.json(
      { ok: false, referenceId, message, raw },
      { status: 500 },
    );
  }
}
