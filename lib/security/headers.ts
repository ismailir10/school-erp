// Security headers applied to every response in proxy.ts.
// CSP is Report-Only this cycle — graduates to enforcing post-launch +1wk
// once /api/csp-report shows zero noise from legitimate flows.

import type { NextResponse } from "next/server";

const DESIGN_REFERENCE_PATH = "/admin/design-system-reference.html";

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.xendit.co https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  // wss://*.supabase.co for Realtime; vitals.vercel-insights.com for Analytics.
  // api.doku.com / api-sandbox.doku.com added in cycle
  // 2026-07-27-doku-payment-gateway T5 (AC-19) — DOKU Checkout session
  // creation + health ping are server-side `fetch` calls, so this entry is
  // defensive-in-depth for any client-side code path, not load-bearing for
  // the redirect flow itself. script-src is deliberately NOT widened: DOKU
  // Checkout is a full-page redirect, not a JS SDK, and a top-level
  // navigation is governed by neither connect-src nor script-src.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.xendit.co https://api.doku.com https://api-sandbox.doku.com https://api.resend.com https://vitals.vercel-insights.com",
  "report-uri /api/csp-report",
];

export function applySecurityHeaders<T extends NextResponse>(response: T, pathname?: string): T {
  // Only the static reference is embedded, by the same-origin admin page.
  // Every other response retains the stricter clickjacking policy.
  const sameOriginFrame = pathname === DESIGN_REFERENCE_PATH;
  response.headers.set("Content-Security-Policy-Report-Only", [
    ...CSP_REPORT_ONLY,
    sameOriginFrame ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
  ].join("; "));
  // No `preload` directive — preload-list submission is effectively
  // irreversible (months to remove). Defer to post-launch +30d once
  // the apex domain's HSTS posture is finalized.
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains",
  );
  response.headers.set("X-Frame-Options", sameOriginFrame ? "SAMEORIGIN" : "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)",
  );
  return response;
}
