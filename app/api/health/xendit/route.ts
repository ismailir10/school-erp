// @public — deploy-time health probe; no user session, no PII, no mutation.
/**
 * Deploy-time health probe for the configured Xendit credential.
 *
 * Pings Xendit `GET /balance` (the canonical key-validity endpoint) and
 * surfaces a normalized result. Use in deploy verification scripts and
 * uptime monitors so a missing/wrong `XENDIT_SECRET_KEY` fails loud
 * instead of silently accumulating `PENDING_PAYMENT_LINK` rows on the
 * next bulk-create run.
 *
 * Kept as an alias route in cycle 2026-07-27-doku-payment-gateway T5 —
 * existing uptime monitors point at this exact path. It now delegates its
 * rate-limit → cache → ping → format flow to the shared
 * `lib/payments/health.ts` core (also used by the gateway-aware
 * `GET /api/health/payments`, AC-18), but is pinned to Xendit: it always
 * calls `pingXenditBalance` directly and never resolves the active gateway
 * via `PAYMENT_GATEWAY` / `getGateway()`, so this endpoint's behavior does
 * not change no matter which gateway is active in production.
 *
 * ### Security checklist (.claude/standards/security.md)
 * - **Auth posture:** intentionally **public** (no auth) — must be
 *   pingable from Vercel deploy-protection bypass + uptime monitors.
 * - **Input validation:** `GET` with no params; nothing to validate.
 * - **Rate limit:** mandatory 30 req/min/IP via `lib/rate-limit.ts`.
 * - **No secret echo:** response body returns only the derived `tier`
 *   label (`"live" | "sandbox" | "unknown"`) — never the raw key,
 *   never the key prefix beyond the derived label.
 * - **Error sanitization:** error responses surface `error.message`
 *   from the typed `XenditApiError` only. No stack traces, no env
 *   values, no headers echoed.
 * - **Route inventory:** added in cycle 2026-04-28-finance-bulk-throttle.
 *
 * ### Cache + rate-limit ordering (cycle 2026-04-28 T4)
 * Hits flow: rate-limit → cache → Xendit ping. Cached responses still
 * count against the per-IP cap, so a hot cache cannot be used to burn
 * function invocations at unlimited QPS from a single IP. This route keeps
 * its own single-slot cache (`__xenditHealthCache`) rather than sharing the
 * gateway-keyed `Map` in `/api/health/payments` — it is always Xendit, so a
 * single slot is sufficient and this avoids any coupling between the two
 * routes' cache lifetimes.
 *
 * ### Tier detection (cycle 2026-04-28 T4)
 * Xendit serves both sandbox and live from `https://api.xendit.co`.
 * Tier is determined exclusively from the `XENDIT_SECRET_KEY` prefix:
 *   - `xnd_production_*`  → `"live"`
 *   - `xnd_development_*` → `"sandbox"`
 *   - missing / other     → `"unknown"`
 */

import { NextResponse } from "next/server";

import { pingXenditBalance } from "@/lib/xendit/client";
import {
  runPaymentsHealthCheck,
  type PaymentsHealthCacheEntry,
  type Tier,
} from "@/lib/payments/health";

export const dynamic = "force-dynamic";

declare global {
  var __xenditHealthCache: PaymentsHealthCacheEntry | undefined;
}

function detectTier(): Tier {
  const key = process.env.XENDIT_SECRET_KEY;
  if (!key) return "unknown";
  if (key.startsWith("xnd_production_")) return "live";
  if (key.startsWith("xnd_development_")) return "sandbox";
  return "unknown";
}

export async function GET(request: Request): Promise<NextResponse> {
  return runPaymentsHealthCheck(request, {
    rateLimitNamespace: "health:xendit",
    source: "xendit",
    detectTier,
    unknownTierError:
      "XENDIT_SECRET_KEY not configured or has unrecognized prefix",
    ping: () => pingXenditBalance(),
    getCached: () => globalThis.__xenditHealthCache,
    setCached: (entry) => {
      globalThis.__xenditHealthCache = entry;
    },
  });
}
