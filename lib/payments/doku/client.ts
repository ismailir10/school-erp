/**
 * DOKU Checkout API client.
 * Docs: https://developers.doku.com (Checkout API, non-SNAP symmetric HMAC).
 *
 * Added in cycle 2026-07-27-doku-payment-gateway T2 — implements the
 * `PaymentGateway` port introduced in T1 alongside `../xendit/client.ts`.
 * Mirrors that file's structure: a classifier function, a plain async
 * create-session function, a ping/health function, a `DEMO_MODE`
 * short-circuit, and a `PaymentGateway`-shaped export at the bottom.
 */
import { randomUUID } from "crypto";

import {
  GatewayApiError,
  type CreateSessionParams,
  type GatewayPaymentState,
  type GatewayPaymentStatus,
  type GatewaySession,
  type GatewayStatusRef,
  type PaymentGateway,
} from "../types";
import { defaultExpiresAt } from "../expiry";
import { parseRetryAfter } from "../xendit/client";
import { buildDigest, buildSignature } from "./signature";

const DOKU_SANDBOX_API_URL = "https://api-sandbox.doku.com";
const DOKU_PRODUCTION_API_URL = "https://api.doku.com";

/**
 * Resolve the Checkout endpoint path from `DOKU_CHECKOUT_VERSION`.
 *
 * DOKU's published docs expose only `/checkout/v1/payment`, but a `/checkout/v2/payment`
 * path is really routed on both hosts — an unauthenticated probe (2026-07-30)
 * showed `/checkout/v9/payment` returning `404 {"message":"No static resource …"}`
 * while `/checkout/v2/payment` returned DOKU's real header validation
 * (`request_time_out_of_range`, then `invalid_signature`), i.e. the same
 * two-stage check as v1 and therefore the same non-SNAP HMAC scheme.
 *
 * Why this is a flag and not a switch: DOKU support (ticket 1115484:1806761,
 * 2026-07-30) stated `additional_info.override_notification_url` "is supported
 * for the API V2 Checkout" — which may explain why this merchant has NEVER
 * received a notification (cycle 2026-07-29-doku-all-va-channels: two settled
 * payments, zero delivery attempts in DOKU's own log). But v2's request-body
 * contract is undocumented and untested. Defaulting to `v1` keeps today's
 * behaviour; flipping the env var runs the experiment. Getting it wrong on v2
 * means every session creation 400s and no parent can obtain a payment link,
 * which is strictly worse than the delayed-but-working reconcile sweep we have.
 *
 * Throws on an unrecognised value rather than falling back. A typo'd flag that
 * silently kept v1 would present as "we switched to v2 and the notification
 * still did not arrive" — corrupting the only experiment that distinguishes
 * these two endpoints.
 *
 * Exported for unit testing.
 */
export function resolveCheckoutTarget(
  raw: string | undefined = process.env.DOKU_CHECKOUT_VERSION,
): string {
  const version = (raw ?? "v1").trim().toLowerCase();
  if (version !== "v1" && version !== "v2") {
    throw new Error(
      `DOKU_CHECKOUT_VERSION must be "v1" or "v2", got "${raw}"`,
    );
  }
  return `/checkout/${version}/payment`;
}

function baseUrl(): string {
  return process.env.DOKU_ENV === "production"
    ? DOKU_PRODUCTION_API_URL
    : DOKU_SANDBOX_API_URL;
}

function getClientId(): string {
  const clientId = process.env.DOKU_CLIENT_ID;
  if (!clientId) throw new Error("DOKU_CLIENT_ID not configured");
  return clientId;
}

function getSecretKey(): string {
  const secretKey = process.env.DOKU_SECRET_KEY;
  if (!secretKey) throw new Error("DOKU_SECRET_KEY not configured");
  return secretKey;
}

/**
 * UTC ISO8601 at SECOND precision, no milliseconds — `YYYY-MM-DDTHH:mm:ssZ`.
 * `Date.prototype.toISOString()` always emits `.SSSZ`; strip the fractional
 * part DOKU's `Request-Timestamp` header does not expect.
 */
export function formatDokuTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Normalise an Indonesian phone number into the form DOKU's `customer.phone`
 * expects: digits only, with the 62 calling code, max 16 characters.
 *
 * Guardian numbers in Talib are entered by hand and arrive in every local
 * shape — `081234567890`, `+62 812-3456-7890`, `0812 3456 7890`. DOKU
 * documents the field as "phone with calling code" and caps it at 16, and a
 * field that violates the contract can fail the WHOLE session — which would
 * cost the parent their payment link over a cosmetic formatting difference.
 *
 * Returns `undefined` rather than a guess whenever the input cannot be
 * normalised confidently (too short, too long, or non-Indonesian), because
 * `customer.phone` is optional for Virtual Account: omitting it is always
 * safe, sending a malformed one is not.
 *
 * Exported for unit testing.
 */
export function normalizePhoneForDoku(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return undefined;

  let national: string;
  if (digits.startsWith("62")) {
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.replace(/^0+/, "");
  } else {
    // No recognisable Indonesian prefix — could be a foreign number or a
    // typo. Don't invent a country code.
    return undefined;
  }

  // Indonesian subscriber numbers run ~9-12 digits after the 62. Outside that
  // band the value is junk (a NIK pasted into the phone column, a 4-digit
  // extension), so omit rather than send it.
  if (national.length < 8 || national.length > 13) return undefined;

  const normalized = `62${national}`;
  return normalized.length <= 16 ? normalized : undefined;
}

/**
 * Client-side expiry used only when DOKU's response carries neither
 * `expired_datetime` nor `expired_date`. `GatewaySession.expiresAt` is a
 * non-optional string; without this the field would silently become
 * `undefined` and surface as a type lie to every consumer.
 */
function fallbackExpiresAt(expiresAt: Date): string {
  return expiresAt.toISOString();
}

/**
 * Convert an absolute expiry instant into DOKU's `payment_due_date`, which is
 * expressed in MINUTES FROM NOW rather than as a timestamp.
 *
 * Rounded up so a due date never lands the parent short of the minute they
 * were promised, and floored at 1 because a zero or negative `payment_due_date`
 * is not a short window — it is a session DOKU rejects or expires on arrival,
 * which costs the parent their payment link entirely. Callers are expected to
 * apply the business floor (see `resolveSessionExpiry`); this is the transport
 * guard for an already-stale instant arriving from anywhere else.
 *
 * Exported for unit testing.
 */
export function toDokuPaymentDueDateMinutes(expiresAt: Date, now: Date = new Date()): number {
  const minutes = Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000);
  return Math.max(1, minutes);
}

/**
 * Map an HTTP response (already known to be non-OK) to a typed
 * `GatewayApiError`. Body is the parsed JSON (may be `null` if parse failed).
 *
 * DOKU's 400 body shape is `{ "error_messages": ["…", "…"] }` — the messages
 * are joined with `"; "` so the combined string lands in the `4xx:` pending-
 * link breakdown bucket rather than `unknown:`.
 *
 * `message` here is the raw, possibly Indonesian-but-vendor-authored DOKU
 * text — it is LOG-ONLY (voice.md "Never render a caught error"), never a
 * user-facing sentence. `code` is what a caller renders from:
 * `lib/payments/error-prefix.ts#paymentLinkErrorMessage` maps every `code` to
 * a sentence Talib authored for admins.
 */
export function classifyDokuResponse(
  response: Response,
  body: unknown,
): GatewayApiError {
  const status = response.status;
  const errorMessages =
    body && typeof body === "object" && "error_messages" in body &&
      Array.isArray((body as { error_messages?: unknown }).error_messages)
      ? (body as { error_messages: unknown[] }).error_messages.filter(
          (m): m is string => typeof m === "string",
        )
      : null;
  const message =
    errorMessages && errorMessages.length > 0
      ? errorMessages.join("; ")
      : `DOKU API error: ${status}`;

  if (status >= 500 && status <= 599) {
    return new GatewayApiError({ status, code: "5xx", retriable: true, message });
  }
  if (status === 408) {
    return new GatewayApiError({ status, code: "408", retriable: true, message });
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
    return new GatewayApiError({
      status,
      code: "429",
      retriable: true,
      message,
      retryAfterMs,
    });
  }
  if (status === 401) {
    return new GatewayApiError({ status, code: "401", retriable: false, message });
  }
  if (status === 403) {
    return new GatewayApiError({ status, code: "403", retriable: false, message });
  }
  if (status === 422) {
    return new GatewayApiError({ status, code: "422", retriable: false, message });
  }
  if (status >= 400 && status <= 499) {
    return new GatewayApiError({ status, code: "4xx", retriable: false, message });
  }
  // Last-resort default: response was non-OK but not in any known band.
  return new GatewayApiError({
    status,
    code: "unknown",
    retriable: false,
    message,
  });
}

export type { CreateSessionParams };

/**
 * Per-call escape hatches. Deliberately NOT part of `CreateSessionParams` and
 * therefore invisible to the `PaymentGateway` port — the gateway wrapper at the
 * bottom of this file never passes them, so every production call behaves
 * exactly as it did before this argument existed.
 *
 * `checkoutVersion` exists solely for `POST /api/doku/probe`, which has to run
 * v1 and v2 back-to-back inside one deployment to attribute a difference to the
 * endpoint. Doing that through `DOKU_CHECKOUT_VERSION` would mean mutating
 * `process.env` mid-request, which in a warm serverless container leaks into
 * whatever concurrent request is creating a real parent's payment link.
 */
export interface CreateDokuSessionOverrides {
  /** `"v1"` | `"v2"`; falls through to `DOKU_CHECKOUT_VERSION` when absent. */
  checkoutVersion?: string;
  /**
   * Invoked with the parsed success envelope before it is distilled into a
   * `GatewaySession`, and therefore before the `missing payment.url` throw.
   *
   * v2's response contract is undocumented; the first signed call to it
   * returned 2xx and then failed that throw, which tells us the endpoint
   * accepts our body but says nothing about what it answered with. A callback
   * rather than a `console.log` because the envelope may carry a VA number,
   * and rather than widening the thrown error because that error is on the
   * real parent-facing path.
   */
  captureRaw?: (envelope: unknown) => void;
}

/**
 * Create a DOKU Checkout session for an invoice.
 * Returns the gateway-neutral `GatewaySession` shape.
 *
 * DEMO_MODE short-circuit: when `process.env.DEMO_MODE === "true"` (CI
 * Playwright runs, demo deploys), skip the real DOKU API call and return a
 * synthetic session, mirroring the Xendit client's same-named short-circuit.
 */
export async function createDokuSession(
  params: CreateSessionParams,
  overrides?: CreateDokuSessionOverrides,
): Promise<GatewaySession> {
  // The 7-day fallback applies only to callers with no invoice to derive a due
  // date from — see `CreateSessionParams.expiresAt`.
  const expiresAt = params.expiresAt ?? defaultExpiresAt();

  if (process.env.DEMO_MODE === "true") {
    return {
      id: `demo_session_${params.referenceId}`,
      paymentUrl: `https://demo.doku.local/checkout/${params.referenceId}`,
      status: "PENDING",
      expiresAt: expiresAt.toISOString(),
    };
  }

  const clientId = getClientId();
  const secretKey = getSecretKey();

  const order: Record<string, unknown> = {
    amount: Math.round(params.amount),
    invoice_number: params.referenceId,
    currency: "IDR",
    // `callback_url` powers the "Back to Merchant" button ON the checkout /
    // VA-instructions page; `callback_url_result` powers it on the result
    // page; `callback_url_cancel` is where DOKU sends a cancelled order.
    // Only the middle one was set before this cycle, so a parent staring at a
    // VA number had no way back to the portal, and `cancelReturnUrl` — which
    // the caller has always computed and passed — was silently dropped on the
    // floor by this adapter (the Xendit adapter has always honoured it).
    callback_url: params.cancelReturnUrl,
    callback_url_result: params.successReturnUrl,
    callback_url_cancel: params.cancelReturnUrl,
    // Checkout page renders in Bahasa Indonesia. Every parent-facing surface
    // in Talib is Bahasa (.claude/standards/voice.md); an English DOKU page
    // mid-flow is a needless comprehension cliff for the Ibu Nur persona.
    language: "ID",
    auto_redirect: false,
  };
  if (params.items?.length) {
    order.line_items = params.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
    }));
  }

  const customerPhone = normalizePhoneForDoku(params.customerPhone);
  const customer: Record<string, unknown> = {
    // DOKU caps name at 255 and email at 128; a value over the cap is
    // rejected for the WHOLE session, so truncate rather than lose the
    // payment link over a long name.
    name: params.customerName.slice(0, 255),
    ...(params.customerEmail && { email: params.customerEmail.slice(0, 128) }),
    ...(customerPhone && { phone: customerPhone }),
  };

  // `override_notification_url` beats the per-channel Back Office setting, so
  // a channel whose "Payment Notification URL" was never filled in still
  // reaches us. See CreateSessionParams.notificationUrl.
  const additionalInfo = params.notificationUrl
    ? { override_notification_url: params.notificationUrl }
    : undefined;

  const payload = {
    order,
    ...(additionalInfo && { additional_info: additionalInfo }),
    payment: {
      payment_due_date: toDokuPaymentDueDateMinutes(expiresAt),
      // Explicit rather than relying on DOKU's default. "SALE" = capture
      // immediately; the alternatives (INSTALLMENT / AUTHORIZE) are credit
      // card only and would be wrong for a school VA collection.
      type: "SALE",
      // `payment_method_types` is deliberately ABSENT. DOKU support confirmed
      // (2026-07-30) that naming a channel which is not active on the merchant
      // account rejects the WHOLE session with
      // `{"message":["PAYMENT CHANNEL IS INACTIVE"]}` — it does not filter the
      // channel out. Production (BRN-0223-1785136973187) has neither BCA nor
      // Mandiri active, so the previously hardcoded eleven-channel list would
      // have 400'd every single session on the prod cutover: no payment links
      // for anybody. Omitting the field is DOKU's own recommendation and makes
      // Checkout render whatever is active on the account, so a channel
      // activation needs no deploy and no enum guessing (Maybank, Sinarmas,
      // BJB and Sahabat Sampoerna were never addressable by name).
      //
      // TRADE-OFF, accepted knowingly (CTO, 2026-07-30): the
      // Virtual-Account-only guarantee of cycle 2026-07-27 now lives in DOKU
      // Back Office, not here. If a card / QRIS / e-money / paylater channel is
      // ever activated on either account, parents will see it and the school
      // pays card MDR. The Back Office VA-only audit in that cycle's Ship Notes
      // is the only remaining control.
    },
    customer,
  };

  // Serialise ONCE. The digest is computed over this exact string, and the
  // same string is sent as fetch's body — never re-serialise the object
  // after this point (AC-6).
  const rawBody = JSON.stringify(payload);
  // ONE evaluation, feeding both the `Request-Target` signature component and
  // the fetch URL below. Signing over one path and posting to another fails as
  // `invalid_signature`, which reads as a credential problem and would send
  // the next investigation down the wrong hole.
  const target = resolveCheckoutTarget(
    overrides?.checkoutVersion ?? process.env.DOKU_CHECKOUT_VERSION,
  );
  const requestId = randomUUID();
  const timestamp = formatDokuTimestamp(new Date());
  const digest = buildDigest(rawBody);
  const signature = buildSignature({
    clientId,
    requestId,
    timestamp,
    target,
    digest,
    secretKey,
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${target}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Id": clientId,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        Signature: signature,
      },
      body: rawBody,
      // A session create that hangs would hold the invoice's link claim and the
      // caller's request open; 10 s x the 3 retries stays inside the claim window.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Fetch itself threw — DNS, TLS, socket reset, a timeout, etc. No HTTP response to
    // classify, so retriable network error with status=null.
    const message = err instanceof Error ? err.message : "DOKU network error";
    throw new GatewayApiError({
      status: null,
      code: "network",
      retriable: true,
      message,
    });
  }

  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => null);
    console.error("[DOKU ERROR] Create session failed:", JSON.stringify(errorBody));
    throw classifyDokuResponse(response, errorBody);
  }

  const envelope = await response.json();
  overrides?.captureRaw?.(envelope);
  // The two Checkout versions answer with DIFFERENT envelopes — both confirmed
  // against the live sandbox by `POST /api/doku/probe` on 2026-07-31:
  //
  //   v1  { "message": ["SUCCESS"],
  //        "response": { "order": {…},
  //                      "payment": { "url", "token_id", "expired_datetime" } } }
  //   v2  { "message": "SUCCESS",
  //        "payment": { "url", "token" } }
  //
  // v2 is flat (no `response` wrapper), names the id `token` rather than
  // `token_id`, and carries no expiry at all. Falling back to `envelope`
  // itself covers v2 without disturbing v1, where `envelope.payment` is
  // undefined and the `response` branch always wins.
  const data = envelope?.response ?? envelope;
  const paymentUrl: string | undefined = data?.payment?.url;
  if (!paymentUrl) {
    // Empty/missing URL would silently break the SENT-transition guard at
    // app/api/invoices/[id]/route.ts (it gates on truthy xenditPaymentUrl),
    // mirroring the equivalent Xendit throw.
    throw new Error("[DOKU] Session response missing payment.url");
  }

  return {
    // v1 calls it `token_id`, v2 calls it `token`. Nothing in Talib keys off
    // this value — DOKU's status endpoint is keyed on `invoice_number` — but
    // it is the id DOKU support asks for, so keep it populated on both.
    id:
      typeof data?.payment?.token_id === "string"
        ? data.payment.token_id
        : typeof data?.payment?.token === "string"
          ? data.payment.token
          : null,
    paymentUrl,
    status: "PENDING", // DOKU's create-session response carries no status field.
    // `expired_datetime` is an undocumented but confirmed-present field
    // (live sandbox probe, 2026-07-27) carrying proper ISO8601 UTC, e.g.
    // "2026-08-03T08:49:58Z". Prefer it over the documented `expired_date`,
    // which is `yyyyMMddHHmmss` in UTC+7 and awkward to parse. Fall back to
    // `expired_date` only if `expired_datetime` is absent.
    expiresAt:
      data?.payment?.expired_datetime ??
      data?.payment?.expired_date ??
      fallbackExpiresAt(expiresAt),
  };
}

/**
 * Deploy-time / health-check probe. Signed `GET
 * /orders/v1/status/healthcheck-<uuid>` with NO Digest header (GET requests
 * carry no digest per DOKU's docs). Resolves on any response that is not
 * 401/403 (reachable, credentials accepted); throws a typed `GatewayApiError`
 * on 401/403. Timeout via `AbortController`; a timeout/abort surfaces as a
 * `network`-coded error.
 *
 * Used by `GET /api/health/payments` (AC-18).
 */
export async function pingDoku(timeoutMs: number = 5000): Promise<void> {
  if (process.env.DEMO_MODE === "true") return; // health check no-op in demo

  const clientId = getClientId();
  const secretKey = getSecretKey();
  const target = `/orders/v1/status/healthcheck-${randomUUID()}`;
  const requestId = randomUUID();
  const timestamp = formatDokuTimestamp(new Date());
  const signature = buildSignature({
    clientId,
    requestId,
    timestamp,
    target,
    // No digest for GET — DOKU docs: "For GET Method, you don't need to
    // generate a Digest."
    secretKey,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${target}`, {
      method: "GET",
      headers: {
        "Client-Id": clientId,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        Signature: signature,
      },
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DOKU network error";
    throw new GatewayApiError({
      status: null,
      code: "network",
      retriable: true,
      message,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    const errorBody: unknown = await response.json().catch(() => null);
    throw classifyDokuResponse(response, errorBody);
  }
  // Any other status (2xx, 404 for a synthetic order id, etc.) means the
  // endpoint is reachable and credentials were accepted — healthy. Discard
  // body, caller only cares about resolve/throw.
}

/**
 * Map a DOKU transaction status onto the gateway-neutral state. Vocabulary
 * taken from the notification handler in `app/api/doku/webhook/route.ts`, so
 * a manual refresh and a real notification classify identically.
 *
 * Unrecognized → `PENDING` (the no-op branch), never a credit or a revert.
 *
 * Exported for unit testing.
 */
export function mapDokuTransactionState(raw: string | null): GatewayPaymentState {
  switch ((raw ?? "").toUpperCase()) {
    case "SUCCESS":
      return "COMPLETED";
    case "EXPIRED":
      return "EXPIRED";
    case "FAILED":
    case "VOIDED":
      return "FAILED";
    case "REFUNDED":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

/**
 * Distil a `GET /orders/v1/status/{invoice_number}` body into the
 * gateway-neutral status shape.
 *
 * DOKU's check-status body mirrors its notification payload (`order`,
 * `transaction`, `channel`, `acquirer`), so the field reads here are the same
 * ones `app/api/doku/webhook/route.ts` performs — including the
 * `original_request_id` idempotency key and the float-amount coercion. Some
 * deployments wrap the result in a top-level `response` envelope (as the
 * create-session call does), so both shapes are accepted.
 *
 * Exported for unit testing.
 */
export function parseDokuOrderStatus(envelope: unknown): GatewayPaymentStatus {
  const top = (envelope && typeof envelope === "object" ? envelope : {}) as Record<
    string,
    unknown
  >;
  const body = (
    top.response && typeof top.response === "object" ? top.response : top
  ) as Record<string, unknown>;

  const obj = (key: string): Record<string, unknown> =>
    body[key] && typeof body[key] === "object"
      ? (body[key] as Record<string, unknown>)
      : {};

  const transaction = obj("transaction");
  const order = obj("order");
  const channel = obj("channel");

  const transactionStatus =
    typeof transaction.status === "string" ? transaction.status : null;

  // Checkout's own order-level status (DOKU changelog, 24 Jul 2025). A link the
  // parent never opened has no channel and so no `transaction`, which would read
  // as PENDING forever; `ORDER_EXPIRED` ("Order expired without payment") is the
  // only expiry signal such an order carries. It only upgrades a PENDING read:
  // a terminal transaction status (paid, failed, refunded) always wins. Merchants
  // registered before Dec 2024 must ask DOKU support to enable `order.status`;
  // without it this branch simply never fires. Cycle 2026-10-17-expired-link-overdue.
  const orderStatus = typeof order.status === "string" ? order.status : null;
  const orderExpired =
    orderStatus?.toUpperCase() === "ORDER_EXPIRED" &&
    mapDokuTransactionState(transactionStatus) === "PENDING";
  const rawStatus = orderExpired ? orderStatus : transactionStatus;

  // Same float-tolerant coercion as the notification route — some channels
  // send `20000.00` rather than `20000`.
  const amountRaw = order.amount;
  const amountCoerced =
    typeof amountRaw === "number" || typeof amountRaw === "string"
      ? Number(amountRaw)
      : NaN;

  const amountDetails =
    transaction.amount_details && typeof transaction.amount_details === "object"
      ? (transaction.amount_details as Record<string, unknown>)
      : null;

  return {
    state: orderExpired ? "EXPIRED" : mapDokuTransactionState(transactionStatus),
    rawStatus,
    // Same idempotency key the notification route uses, so a manual refresh
    // and a late notification for one settlement collapse onto one Payment row.
    paymentId:
      typeof transaction.original_request_id === "string" &&
      transaction.original_request_id.length > 0
        ? transaction.original_request_id
        : null,
    amount: Number.isFinite(amountCoerced) ? amountCoerced : null,
    currency:
      amountDetails && typeof amountDetails.currency === "string"
        ? amountDetails.currency
        : null,
    channelCode: typeof channel.id === "string" ? channel.id : null,
    raw: envelope,
  };
}

/**
 * Read-only poll of a DOKU order — signed `GET /orders/v1/status/{invoice_number}`
 * (no Digest header; DOKU omits the digest for GET, same as `pingDoku`).
 *
 * Keyed on `invoice_number`, which `createDokuSession` sets to the bare
 * `Invoice.id` — so unlike Xendit this path needs no stored session id and is
 * always available.
 *
 * A 404 means DOKU has no order for that invoice (no checkout was ever
 * started) — reported as `UNAVAILABLE`, not an error, since there is nothing
 * to reconcile.
 */
export async function getDokuOrderStatus(
  ref: GatewayStatusRef,
  timeoutMs: number = 10_000,
): Promise<GatewayPaymentStatus> {
  if (process.env.DEMO_MODE === "true") {
    return {
      state: "PENDING",
      rawStatus: "PENDING",
      paymentId: null,
      amount: null,
      currency: "IDR",
      channelCode: null,
      raw: { demo: true, invoiceId: ref.invoiceId, status: "PENDING" },
    };
  }

  const clientId = getClientId();
  const secretKey = getSecretKey();
  const target = `/orders/v1/status/${encodeURIComponent(ref.invoiceId)}`;
  const requestId = randomUUID();
  const timestamp = formatDokuTimestamp(new Date());
  const signature = buildSignature({
    clientId,
    requestId,
    timestamp,
    target,
    // No digest for GET — DOKU docs, mirrored from `pingDoku`.
    secretKey,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${target}`, {
      method: "GET",
      headers: {
        "Client-Id": clientId,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        Signature: signature,
      },
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "DOKU network error";
    throw new GatewayApiError({
      status: null,
      code: "network",
      retriable: true,
      message,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) {
    return {
      state: "UNAVAILABLE",
      rawStatus: null,
      paymentId: null,
      amount: null,
      currency: null,
      channelCode: null,
      raw: null,
      unavailableReason: "ORDER_NOT_FOUND",
    };
  }

  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => null);
    console.error(`[DOKU ERROR] Get order status failed status=${response.status}`);
    throw classifyDokuResponse(response, errorBody);
  }

  const data: unknown = await response.json();
  if (process.env.DOKU_DEBUG === "1") {
    console.info("[DOKU DEBUG] Order status response:", JSON.stringify(data));
  }
  return parseDokuOrderStatus(data);
}

/**
 * `PaymentGateway` implementation backed by DOKU Checkout (Virtual Account
 * channels only).
 */
export const dokuGateway: PaymentGateway = {
  id: "doku",
  createSession(params: CreateSessionParams): Promise<GatewaySession> {
    return createDokuSession(params);
  },
  ping(timeoutMs?: number): Promise<void> {
    return pingDoku(timeoutMs);
  },
  fetchPaymentStatus(ref: GatewayStatusRef): Promise<GatewayPaymentStatus> {
    return getDokuOrderStatus(ref);
  },
};
