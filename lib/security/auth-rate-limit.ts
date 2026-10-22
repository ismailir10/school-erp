// Rate limit applied in proxy.ts to /api/auth/* routes only.
// Reuses lib/rate-limit.ts (in-memory token bucket; per-Vercel-instance).
// N-instance leakage accepted — soft launch traffic keeps effective cap
// near 5 req/min/IP × small N. Promote to Upstash if abuse seen post-launch.
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { isDemoAuthEnabled } from "@/lib/security/demo-mode";

const AUTH_LIMIT = 5;
const AUTH_WINDOW_MS = 60_000;

export function enforceAuthRateLimit(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/auth/")) return null;

  // Skip in demo mode — dev / staging / e2e environments hit /api/auth/users
  // and friends repeatedly during test setup; rate-limiting them produces
  // 429s that break test fixtures. isDemoAuthEnabled() is false on Vercel, so
  // a stray DEMO_MODE there cannot switch the limiter off.
  if (isDemoAuthEnabled()) return null;

  const ip = getClientIp(request);
  // Skip rate limiting when IP is unidentifiable. On Vercel this never
  // happens (platform always sets x-forwarded-for); the "anonymous"
  // fallback only triggers in dev/non-Vercel hosts. Sharing one bucket
  // across all unidentified callers would let a single attacker DoS
  // every legitimate anonymous request.
  if (ip === "anonymous") return null;

  // Key is per-IP across all /api/auth/* paths — strict 5 req/min/IP.
  // Path-scoped keys would let an attacker rotate /login → /signup →
  // /reset to multiply the effective cap.
  const result = rateLimit(`auth:${ip}`, AUTH_LIMIT, AUTH_WINDOW_MS);
  if (result.success) return null;

  return NextResponse.json(
    { error: "rate_limited" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(AUTH_WINDOW_MS / 1000)) },
    },
  );
}
