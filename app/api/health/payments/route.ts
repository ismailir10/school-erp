// @public — deploy-time health probe; no user session, no PII, no mutation.
/**
 * Deploy-time health probe for the ACTIVE payment gateway
 * (`PAYMENT_GATEWAY` — Xendit or DOKU).
 *
 * Added in cycle 2026-07-27-doku-payment-gateway T5 (AC-18) as the
 * gateway-aware sibling of `GET /api/health/xendit`, which is kept as a
 * pinned alias so existing uptime monitors do not break. Resolves the
 * active adapter via `getGateway()` and calls `gateway.ping()` — for
 * Xendit that is `GET /balance`; for DOKU it is a signed
 * `GET /orders/v1/status/<synthetic-id>` (see `lib/payments/doku/client.ts`
 * `pingDoku`), which resolves on any non-401/403 response.
 *
 * ### Security checklist (.claude/standards/security.md)
 * - **Auth posture:** intentionally **public** (no auth) — same posture as
 *   `/api/health/xendit`: must be pingable from Vercel deploy-protection
 *   bypass + uptime monitors.
 * - **Input validation:** `GET` with no params; nothing to validate.
 * - **Rate limit:** mandatory 30 req/min/IP via `lib/rate-limit.ts`.
 * - **No secret echo:** response body returns only the derived `source` /
 *   `tier` labels — never `XENDIT_SECRET_KEY`, `DOKU_SECRET_KEY`, or
 *   `DOKU_CLIENT_ID`.
 * - **Error sanitization:** error responses surface the typed
 *   `GatewayApiError.message` via `prefixForError` only.
 * - **Route inventory:** added in cycle 2026-07-27-doku-payment-gateway T5.
 *
 * ### Cache + rate-limit ordering
 * Hits flow: rate-limit → cache → gateway ping — same ordering pin as
 * `/api/health/xendit` (cycle 2026-04-28 T4): cached responses still count
 * against the per-IP cap.
 *
 * ### Cache partitioning — keyed by gateway id, NOT tier
 * Unlike `/api/health/xendit` (always Xendit, single slot), this route's
 * active gateway can change at runtime via `PAYMENT_GATEWAY`. The cache is
 * therefore a `Map` keyed by `gateway.id`: a `PAYMENT_GATEWAY` flip from
 * "xendit" to "doku" (or back) must never serve a stale cross-gateway
 * result out of a single shared slot. Still not keyed by tier — like the
 * original Xendit route, tier is derived from the gateway's own credential
 * (an env var), not an external/attacker-controlled input, so keying by it
 * would add partitioning with no security benefit.
 *
 * ### Tier detection is per-gateway
 * - Xendit: `XENDIT_SECRET_KEY` prefix — `xnd_production_` → `"live"`,
 *   `xnd_development_` → `"sandbox"`, else `"unknown"` (same heuristic as
 *   `/api/health/xendit`).
 * - DOKU: `DOKU_ENV` — `"production"` → `"live"`, `"sandbox"` → `"sandbox"`,
 *   unset/other → `"unknown"`. DOKU's key/Client-Id format does not encode
 *   tier the way Xendit's `xnd_development_`/`xnd_production_` prefix does.
 * Both "unknown" cases short-circuit to 503 with NO network ping.
 */

import { NextResponse } from "next/server";

import { getGateway } from "@/lib/payments/registry";
import {
  runPaymentsHealthCheck,
  type PaymentsHealthCacheEntry,
  type Tier,
} from "@/lib/payments/health";

export const dynamic = "force-dynamic";

declare global {
  var __paymentsHealthCache: Map<string, PaymentsHealthCacheEntry> | undefined;
}

function cacheStore(): Map<string, PaymentsHealthCacheEntry> {
  if (!globalThis.__paymentsHealthCache) {
    globalThis.__paymentsHealthCache = new Map();
  }
  return globalThis.__paymentsHealthCache;
}

function detectXenditTier(): Tier {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) return "unknown";
  if (key.startsWith("xnd_production_")) return "live";
  if (key.startsWith("xnd_development_")) return "sandbox";
  return "unknown";
}

function detectDokuTier(): Tier {
  const env = process.env.DOKU_ENV;
  if (env === "production") return "live";
  if (env === "sandbox") return "sandbox";
  return "unknown";
}

export async function GET(request: Request): Promise<NextResponse> {
  const gateway = getGateway();
  const detectTier = gateway.id === "doku" ? detectDokuTier : detectXenditTier;
  const unknownTierError =
    gateway.id === "doku"
      ? "DOKU_ENV not configured or has unrecognized value"
      : "XENDIT_SECRET_KEY not configured or has unrecognized prefix";

  return runPaymentsHealthCheck(request, {
    rateLimitNamespace: "health:payments",
    source: gateway.id,
    detectTier,
    unknownTierError,
    ping: () => gateway.ping(),
    getCached: () => cacheStore().get(gateway.id),
    setCached: (entry) => {
      cacheStore().set(gateway.id, entry);
    },
  });
}
