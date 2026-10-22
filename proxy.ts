import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { applySecurityHeaders } from "@/lib/security/headers";
import { enforceAuthRateLimit } from "@/lib/security/auth-rate-limit";
import { isDemoAuthEnabled } from "@/lib/security/demo-mode";

const DEMO_COOKIE = "school-erp-session";
const LAST_ACTIVE_COOKIE = "school-erp-last-active";

// Idle timeout thresholds per portal (milliseconds)
const IDLE_THRESHOLDS: { prefix: string; ms: number }[] = [
  { prefix: "/admin", ms: 4 * 60 * 60 * 1000 },   // 4 hours
  { prefix: "/teacher", ms: 24 * 60 * 60 * 1000 }, // 24 hours
  { prefix: "/parent", ms: 24 * 60 * 60 * 1000 },  // 24 hours
];

/**
 * Enforce idle timeout using a cookie timestamp.
 * Applies to /admin (4h), /teacher (24h), /parent (24h).
 * If idle exceeds threshold → redirect to login.
 * On every page request → refresh the timestamp cookie.
 */
function enforceIdleTimeout(request: NextRequest, response: NextResponse): NextResponse {
  const { pathname } = request.nextUrl;

  // Find matching threshold for this route
  const rule = IDLE_THRESHOLDS.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return response;

  const lastActive = request.cookies.get(LAST_ACTIVE_COOKIE)?.value;

  if (lastActive) {
    const elapsed = Date.now() - parseInt(lastActive, 10);
    if (elapsed > rule.ms) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      const redirect = NextResponse.redirect(url);
      redirect.cookies.delete(LAST_ACTIVE_COOKIE);
      return redirect;
    }
  }

  // Refresh the timestamp on the existing response
  response.cookies.set(LAST_ACTIVE_COOKIE, String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h
  });
  return response;
}

export async function proxy(request: NextRequest) {
  const response = await proxyImpl(request);
  // /api/csp-report receives the violation reports themselves — applying
  // CSP headers here would be redundant and could create report loops.
  if (!request.nextUrl.pathname.startsWith("/api/csp-report")) {
    applySecurityHeaders(response, request.nextUrl.pathname);
  }
  return response;
}

async function proxyImpl(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // FIND-003: Next.js RSC prefetch issues background HEAD requests against
  // admin/teacher/parent routes; under load updateSession() occasionally
  // returns 503, polluting Vercel logs. HEAD has no body so the auth chain
  // adds no value — let it through unconditionally. GET still goes through
  // the full chain a sentence later.
  if (request.method === "HEAD") {
    return NextResponse.next();
  }

  // Rate limit /api/auth/* — credential-stuffing defense.
  // Skip non-auth paths instantly (returns null, near-zero overhead).
  const limited = enforceAuthRateLimit(request);
  if (limited) return limited;

  // Fully public routes — NO auth check at all (external webhooks, payment pages,
  // public admission entry per Phase 1.1 / cycle 2026-05-10-daftar-public-form).
  //
  // Exact-segment match on the webhook paths (cycle 2026-07-27-doku-payment-
  // gateway T4 / AC-21) — the previous Xendit-only rule used a loose
  // `startsWith("/api/xendit/webhook")` prefix, which would also bypass a
  // hypothetical `/api/xendit/webhook-anything` route. Both webhook paths
  // now require an exact match on the path itself.
  if (
    pathname === "/api/xendit/webhook" ||
    pathname === "/api/doku/webhook" ||
    pathname.startsWith("/payment/") ||
    pathname === "/daftar" ||
    pathname.startsWith("/daftar/") ||
    pathname === "/api/admission/submit" ||
    // Cycle A: tokenized enrollment form + its public token APIs. The
    // unguessable accessToken gates access in-route; the admin invite route
    // (/api/enrollments/invite) is NOT public and stays session-gated.
    pathname.startsWith("/pendaftaran/") ||
    pathname.startsWith("/api/enrollments/token/")
  ) {
    return NextResponse.next();
  }

  // OAuth PKCE callback — bypass updateSession entirely. Running getUser() here
  // before the route handler exchanges the code risks interfering with the PKCE
  // code verifier cookie, producing "PKCE code verifier not found in storage".
  if (pathname === "/auth/callback" && request.nextUrl.searchParams.has("code")) {
    return NextResponse.next();
  }

  // Public routes — allow but still refresh Supabase session if present.
  // Exact segment match on `/auth` + `/api/auth` prevents hypothetical
  // routes like `/authentic-*` from inheriting the public bypass.
  if (
    pathname === "/" ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/legal/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/logo") ||
    // Public school photos shown on /daftar and the invite form. next/image fetches
    // them server-side without a session, so without this the optimizer is bounced
    // to the sign-in page (307) and every photo renders broken. Trailing slash on
    // purpose: `/schoolfoo` must not inherit the bypass.
    pathname.startsWith("/school/")
  ) {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return await updateSession(request);
    }
    return NextResponse.next();
  }

  // Demo mode takes priority when enabled — skip Supabase auth entirely.
  // Still enforce idle timeout on portal paths so demo sessions expire
  // consistently with Supabase-authenticated sessions.
  if (isDemoAuthEnabled()) {
    const demoCookie = request.cookies.get(DEMO_COOKIE)?.value;
    if (demoCookie) {
      return enforceIdleTimeout(request, NextResponse.next());
    }
  }

  // API routes call getSession() themselves — skip the redundant middleware getUser()
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Supabase auth (production)
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const response = await updateSession(request);
    // If updateSession redirected (no user), don't check idle
    if (response.status === 307 || response.headers.get("location")) {
      return response;
    }
    return enforceIdleTimeout(request, response);
  }

  // Demo mode fallback (only when Supabase is NOT configured)
  const demoCookie = request.cookies.get(DEMO_COOKIE)?.value;
  if (demoCookie) {
    const response = NextResponse.next();
    return enforceIdleTimeout(request, response);
  }

  // No session → redirect to login
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
