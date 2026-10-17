/**
 * Xendit Session API client.
 * Uses the Checkout Session API with PAYMENT_LINK mode.
 * Docs: https://docs.xendit.co/apidocs/create-session
 *
 * Re-homed from `lib/xendit/client.ts` in cycle
 * 2026-07-27-doku-payment-gateway T1 — implements the `PaymentGateway` port.
 * `lib/xendit/client.ts` is now a thin re-export shim so existing consumers
 * are unaffected. Zero behaviour change: same base URL, same auth, same
 * request/response shapes, same retry-after cap, same DEMO_MODE
 * short-circuit, same log prefixes.
 */
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

const XENDIT_API_URL = "https://api.xendit.co";

/**
 * Defensive parse of the `Retry-After` header (RFC 7231 — seconds form).
 * Multiplies seconds → ms, caps at 3000ms (per spec budget). Returns
 * `undefined` for missing/non-numeric values so the caller can fall back to
 * its default backoff schedule rather than crashing on `NaN`.
 *
 * Note: HTTP-date form (e.g. "Wed, 21 Oct 2015 07:28:00 GMT") is not
 * supported — Xendit documents the seconds form, and parsing dates would
 * complicate the cap. parseInt("Wed", 10) returns NaN → undefined fallback.
 */
export function parseRetryAfter(headerValue: string | null): number | undefined {
  if (headerValue === null) return undefined;
  const seconds = parseInt(headerValue, 10);
  if (Number.isNaN(seconds)) return undefined;
  return Math.min(seconds * 1000, 3000);
}

/**
 * Map an HTTP response (already known to be non-OK) to a typed
 * `GatewayApiError`. Body is the parsed JSON (may be `null` if parse failed).
 *
 * `message` here is deliberately the raw Xendit response text — it is
 * LOG-ONLY (voice.md "Never render a caught error"). `code` is the field a
 * caller renders from: `lib/payments/error-prefix.ts#paymentLinkErrorMessage`
 * maps every `code` to an Indonesian sentence for user-facing display.
 */
function classifyXenditResponse(
  response: Response,
  body: unknown,
): GatewayApiError {
  const status = response.status;
  const bodyMessage =
    body && typeof body === "object" && "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : null;
  const message = bodyMessage ?? `Xendit API error: ${status}`;

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

/** Convert Indonesian phone number to E.164 format (+62xxx) */
function formatPhoneE164(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("62")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+62${cleaned.slice(1)}`;
  return `+62${cleaned}`;
}

function getAuthHeader(): string {
  const apiKey = process.env.XENDIT_SECRET_KEY;
  if (!apiKey) throw new Error("XENDIT_SECRET_KEY not configured");
  // Xendit uses Basic Auth with secret key as username, empty password
  return "Basic " + Buffer.from(apiKey + ":").toString("base64");
}

export type { CreateSessionParams };

export type CreateSessionResponse = {
  /**
   * Xendit session id. Null when Xendit returns a response without a
   * recognizable id field (observed in sandbox; see `pickSessionId`).
   * The payment URL is still usable; callers should persist `null` in
   * `Invoice.xenditSessionId` and rely on `xenditPaymentUrl` for
   * idempotency / re-fetch.
   */
  id: string | null;
  payment_link_url: string;
  status: string;
  expires_at: string;
};

/**
 * Create a Xendit Checkout Session for an invoice.
 * Returns the payment link URL that can be shared with parents.
 *
 * DEMO_MODE short-circuit: when `process.env.DEMO_MODE === "true"` (CI
 * Playwright runs, demo deploys), skip the real Xendit API call and
 * return a synthetic session. Two reasons:
 *   1. CI hits localhost http URLs that Xendit rejects with INVALID_URL.
 *   2. Sandbox rate limit blocks bulk tagihan tests with RATE_LIMIT_EXCEEDED.
 * Real Xendit integration is verified manually on staging deploy.
 */
export async function createXenditSession(
  params: CreateSessionParams
): Promise<CreateSessionResponse> {
  // Xendit's `expires_at` is already an absolute instant, so `params.expiresAt`
  // passes straight through. The 7-day fallback applies only to callers with no
  // invoice to derive a due date from — see `CreateSessionParams.expiresAt`.
  const expiresAt = params.expiresAt ?? defaultExpiresAt();

  if (process.env.DEMO_MODE === "true") {
    return {
      id: `demo_session_${params.referenceId}`,
      payment_link_url: `https://demo.xendit.local/checkout/${params.referenceId}`,
      status: "ACTIVE",
      expires_at: expiresAt.toISOString(),
    };
  }

  const body: Record<string, unknown> = {
    reference_id: params.referenceId,
    session_type: "PAY",
    mode: "PAYMENT_LINK",
    amount: Math.round(params.amount),
    currency: "IDR",
    country: "ID",
    capture_method: "AUTOMATIC",
    locale: "id",
    description: params.description,
    success_return_url: params.successReturnUrl,
    cancel_return_url: params.cancelReturnUrl,
    expires_at: expiresAt.toISOString(),
    customer: {
      reference_id: `cust_${params.referenceId}`,
      type: "INDIVIDUAL",
      ...(params.customerEmail && { email: params.customerEmail }),
      ...(params.customerPhone && { mobile_number: formatPhoneE164(params.customerPhone) }),
      individual_detail: {
        given_names: params.customerName,
      },
    },
  };

  // Add items if provided
  if (params.items?.length) {
    body.items = params.items.map((item, idx) => ({
      reference_id: `item_${idx}`,
      name: item.name,
      type: "DIGITAL_PRODUCT",
      category: "EDUCATION",
      net_unit_amount: Math.round(item.price),
      quantity: item.quantity,
      currency: "IDR",
    }));
  }

  let response: Response;
  try {
    response = await fetch(`${XENDIT_API_URL}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify(body),
      // Keep the complete retry budget inside the invoice claim and bulk function duration.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Fetch itself threw — DNS, TLS, socket reset, timeout, etc. No HTTP response to
    // classify, so retriable network error with status=null.
    const message = err instanceof Error ? err.message : "Xendit network error";
    throw new GatewayApiError({
      status: null,
      code: "network",
      retriable: true,
      message,
    });
  }

  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => null);
    console.error("[XENDIT ERROR] Create session failed:", JSON.stringify(errorBody));
    throw classifyXenditResponse(response, errorBody);
  }

  const data = await response.json();
  if (process.env.XENDIT_DEBUG === "1") {
    // One-off shape probing. Only enabled when operator opts in.
    console.info("[XENDIT DEBUG] Session response:", JSON.stringify(data));
  }
  const paymentUrl: string | undefined =
    data.payment_link_url ?? data.checkout?.url;
  if (!paymentUrl) {
    // Empty/missing URL would silently break the SENT-transition guard at
    // app/api/invoices/[id]/route.ts (it gates on truthy xenditPaymentUrl).
    throw new Error("[XENDIT] Session response missing payment_link_url");
  }
  return {
    id: pickSessionId(data),
    payment_link_url: paymentUrl,
    status: data.status,
    expires_at: data.expires_at,
  };
}

/**
 * Deploy-time health probe — pings Xendit `GET /balance` to validate the
 * configured `XENDIT_SECRET_KEY`. Throws a typed `GatewayApiError` on failure
 * so callers can branch on `error.code` (matches the breakdown taxonomy).
 *
 * Cycle 2026-04-28 T4: added so a missing/wrong key fails loud at deploy
 * time instead of silently accumulating `PENDING_PAYMENT_LINK` rows on the
 * next bulk-create run. Used by `GET /api/health/xendit`.
 *
 * Timeout: 5 seconds via `AbortController`. A timeout surfaces as a
 * `network`-coded error (the fetch threw before getting a response).
 */
export async function pingXenditBalance(timeoutMs: number = 5000): Promise<void> {
  if (process.env.DEMO_MODE === "true") return; // health check no-op in demo

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${XENDIT_API_URL}/balance`, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(),
      },
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Xendit network error";
    throw new GatewayApiError({
      status: null,
      code: "network",
      retriable: true,
      message,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => null);
    throw classifyXenditResponse(response, errorBody);
  }
  // Success — discard body, caller only cares about ok/throw.
}

/**
 * Strip query string from a URL — keeps origin + pathname only.
 * Used by triage logging so `?invoice=…` ids stay out of logs while
 * the route (`/payment/success` or `/payment/cancel`) and origin
 * (preview / staging / prod) remain visible for debugging.
 *
 * Returns null on falsy input or non-URL strings (defensive — webhook
 * payload field may be missing on some Xendit payloads).
 */
export function stripQuery(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}

/**
 * Defensive id extraction. Earlier Xendit `/sessions` responses observed
 * with a missing top-level `id` — `xenditSessionId` came back null even
 * though `payment_link_url` was set. Try documented shapes in priority
 * order; return null if none matched (caller stores `null` and continues).
 *
 * Exported for unit testing.
 */
export function pickSessionId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const candidates: unknown[] = [
    d.id,
    d.session_id,
    d.payment_session_id,
    (d.session as { id?: unknown } | undefined)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/**
 * Map a Xendit session status string onto the gateway-neutral state.
 *
 * Xendit documents `ACTIVE | COMPLETED | EXPIRED | CANCELED` for a Checkout
 * Session, but the vocabulary has drifted across API versions, so synonyms are
 * accepted. Anything unrecognized falls through to `PENDING` — the no-op
 * branch. That is the safe default: an unknown status must never credit an
 * invoice or destroy a live payment link. The raw string is carried through in
 * `rawStatus` so the admin sees what the gateway actually said.
 *
 * Exported for unit testing.
 */
export function mapXenditSessionState(raw: string | null): GatewayPaymentState {
  switch ((raw ?? "").toUpperCase()) {
    case "COMPLETED":
    case "SUCCEEDED":
    case "SUCCESS":
    case "PAID":
    case "CAPTURED":
      return "COMPLETED";
    case "EXPIRED":
      return "EXPIRED";
    case "CANCELED":
    case "CANCELLED":
    case "FAILED":
      return "FAILED";
    case "REFUNDED":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}

/** First string-valued candidate, or null. */
function firstString(candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/** First finite-number candidate (coercing numeric strings), or null. */
function firstNumber(candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (typeof c === "number" || typeof c === "string") {
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Distil a `GET /sessions/{id}` body into the gateway-neutral status shape.
 *
 * The exact response shape is not pinned down: Xendit's session-retrieve body
 * has never been captured in this repo (no local credentials — see the cycle
 * doc's Risks). So every field is read through a candidate list covering the
 * documented shapes plus the nested `payments[]` collection observed on
 * multi-attempt sessions. A field that matches nothing stays null, and the
 * shared webhook processor's existing MISSING_AMOUNT / MISSING_PAYMENT_ID
 * guards then refuse to credit rather than guessing.
 *
 * `paymentId` deliberately uses the SAME fallback chain as the webhook route
 * (`payment_id` → `payment_session_id`). Both paths must derive an identical
 * `Payment.xenditPaymentId` for one settlement, otherwise a manual refresh
 * followed by a late real webhook would insert two Payment rows.
 *
 * Exported for unit testing.
 */
export function parseXenditSessionStatus(data: unknown): GatewayPaymentStatus {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const payments = Array.isArray(d.payments)
    ? (d.payments as unknown[]).filter(
        (p): p is Record<string, unknown> => !!p && typeof p === "object",
      )
    : [];
  // Prefer a succeeded attempt; a session can carry earlier failed attempts.
  const settled =
    payments.find((p) => mapXenditSessionState(firstString([p.status])) === "COMPLETED") ??
    payments[0] ??
    {};

  const rawStatus = firstString([d.status, settled.status]);

  return {
    state: mapXenditSessionState(rawStatus),
    rawStatus,
    paymentId: firstString([
      d.payment_id,
      settled.payment_id,
      settled.id,
      d.payment_session_id,
      d.id,
    ]),
    amount: firstNumber([
      d.amount,
      settled.amount,
      d.captured_amount,
      d.paid_amount,
    ]),
    currency: firstString([d.currency, settled.currency]),
    channelCode: firstString([d.channel_code, settled.channel_code]),
    raw: data,
  };
}

/** Legacy Payment Link invoices predate Checkout Sessions and use a different response. */
export function parseXenditInvoiceStatus(data: unknown): GatewayPaymentStatus {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const rawStatus = firstString([d.status]);
  const state = rawStatus?.toUpperCase() === "SETTLED" ? "COMPLETED" : mapXenditSessionState(rawStatus);
  return {
    state,
    rawStatus,
    paymentId: firstString([d.payment_id, d.id]),
    // Credit what was received, never the face value of an unpaid legacy invoice.
    amount: firstNumber([d.paid_amount]),
    currency: firstString([d.currency]),
    channelCode: firstString([d.payment_channel]),
    raw: data,
  };
}

/**
 * Read-only poll of a Xendit Checkout Session (`GET /sessions/{id}`) or a
 * legacy Payment Link invoice (`GET /v2/invoices/{id}` for its 24-hex ID).
 *
 * Used by the admin "Perbarui pembayaran" action as a webhook fallback. Never
 * mutates gateway state. Returns `UNAVAILABLE` (rather than throwing) when the
 * invoice has no recorded session id, which happens for sessions created
 * before `pickSessionId` could resolve an id from the create response.
 *
 * DEMO_MODE short-circuit mirrors `createXenditSession` — CI and demo deploys
 * have no usable credentials, and the synthetic session is always PENDING so a
 * demo click is a visible no-op rather than a fake payment.
 */
export async function getXenditSessionStatus(
  ref: GatewayStatusRef,
  timeoutMs: number = 10_000,
): Promise<GatewayPaymentStatus> {
  if (!ref.sessionId) {
    return {
      state: "UNAVAILABLE",
      rawStatus: null,
      paymentId: null,
      amount: null,
      currency: null,
      channelCode: null,
      raw: null,
      unavailableReason: "NO_SESSION_ID",
    };
  }

  if (process.env.DEMO_MODE === "true") {
    return {
      state: "PENDING",
      rawStatus: "ACTIVE",
      paymentId: null,
      amount: null,
      currency: "IDR",
      channelCode: null,
      raw: { demo: true, id: ref.sessionId, status: "ACTIVE" },
    };
  }

  // Historical reseeds used /v2/invoices; those IDs are 24 hexadecimal characters,
  // while Checkout Session IDs start with ps-. Both use the same fixed API origin.
  const legacyInvoice = /^[a-f0-9]{24}$/i.test(ref.sessionId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(
      `${XENDIT_API_URL}/${legacyInvoice ? "v2/invoices" : "sessions"}/${encodeURIComponent(ref.sessionId)}`,
      {
        method: "GET",
        headers: { Authorization: getAuthHeader() },
        signal: controller.signal,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Xendit network error";
    throw new GatewayApiError({
      status: null,
      code: "network",
      retriable: true,
      message,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => null);
    console.error(
      `[XENDIT ERROR] Get session failed status=${response.status}`,
    );
    throw classifyXenditResponse(response, errorBody);
  }

  const data: unknown = await response.json();
  if (process.env.XENDIT_DEBUG === "1") {
    // Shape probing on staging — this is the only way to confirm the
    // session-retrieve body without live credentials locally.
    console.info("[XENDIT DEBUG] Session status response:", JSON.stringify(data));
  }
  return legacyInvoice ? parseXenditInvoiceStatus(data) : parseXenditSessionStatus(data);
}

/**
 * `PaymentGateway` implementation backed by Xendit Checkout Sessions.
 * Maps the Xendit-shaped response (`payment_link_url`, `expires_at`, snake
 * case) onto the gateway-neutral `GatewaySession` shape.
 */
export const xenditGateway: PaymentGateway = {
  id: "xendit",
  async createSession(params: CreateSessionParams): Promise<GatewaySession> {
    const session = await createXenditSession(params);
    return {
      id: session.id,
      paymentUrl: session.payment_link_url,
      status: session.status,
      expiresAt: session.expires_at,
    };
  },
  ping(timeoutMs?: number): Promise<void> {
    return pingXenditBalance(timeoutMs);
  },
  fetchPaymentStatus(ref: GatewayStatusRef): Promise<GatewayPaymentStatus> {
    return getXenditSessionStatus(ref);
  },
};
