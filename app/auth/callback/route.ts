import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { assertSingleTenant, isAdminRole } from "@/lib/auth";
import { resolveCallbackOrigin } from "@/lib/auth-callback";

type PendingCookie = {
  name: string;
  value: string;
  options: Parameters<
    ReturnType<typeof NextResponse.next>["cookies"]["set"]
  >[2];
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const base = resolveCallbackOrigin(request);

  // Cookies written by `exchangeCodeForSession` are captured here and applied
  // to the final redirect response. Returning `NextResponse.redirect(...)`
  // directly from a route handler does NOT inherit ambient `cookies().set()`
  // writes — the Set-Cookie headers are lost and the browser has no session
  // on the next request, producing the /auth/callback → /admin → / loop.
  const pending: PendingCookie[] = [];

  const respond = (path: string) => {
    const res = NextResponse.redirect(`${base}${path}`);
    for (const { name, value, options } of pending) {
      res.cookies.set(name, value, options);
    }
    // Reset idle-timeout cookie on fresh login. Without this, a stale
    // `school-erp-last-active` from a previous session (e.g. demo mode)
    // makes proxy.ts's enforceIdleTimeout redirect /admin → / immediately
    // after the OAuth callback succeeds, producing the login loop.
    if (path === "/admin" || path === "/teacher" || path === "/parent") {
      res.cookies.set("school-erp-last-active", String(Date.now()), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24,
      });
    }
    return res;
  };

  if (!code) return respond("/?error=no_code");

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const c of cookiesToSet) {
              pending.push({ name: c.name, value: c.value, options: c.options });
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchange_failed:", error.message);
      return respond("/?error=exchange_failed");
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      console.error("[auth/callback] no_email after exchange");
      return respond("/?error=no_email");
    }
    // Same Google-only rule as lib/auth.ts#_getSession — otherwise a non-Google
    // account would be routed to a portal that then bounces it back to login.
    if (user.app_metadata?.provider !== "google") {
      console.error("[auth/callback] non_google_provider:", user.app_metadata?.provider ?? null);
      return respond("/?error=access_denied");
    }

    try {
      const { prisma } = await import("@/lib/db");
      // Multi-tenant safety rail — see lib/auth.ts#assertSingleTenant.
      // This callback also keys on email alone and must fail-loud the
      // moment a second tenant is seeded.
      await assertSingleTenant();
      // email is unique per-tenant (`@@unique([tenantId, email])`) so use
      // findFirst — single-tenant MVP returns the only match. Filter
      // status: "ACTIVE" to block deactivated accounts from logging in
      // via Supabase OAuth, matching _getSession's filter.
      const prismaUser = await prisma.user.findFirst({
        where: { email: user.email, status: "ACTIVE" },
      });

      if (isAdminRole(prismaUser?.role ?? "")) return respond("/admin");
      if (prismaUser?.role === "TEACHER") return respond("/teacher");
      if (prismaUser?.role === "GUARDIAN") return respond("/parent");

      // Auto-provisioning fallback. Employee-first precedence matches
      // lib/auth.ts#_getSession auto-create path — an email matching
      // both Employee and Parent becomes TEACHER. Override by
      // pre-creating a GUARDIAN User row before first login.
      const employee = await prisma.employee.findFirst({
        where: { email: user.email },
      });
      if (employee) return respond("/teacher");

      const parent = await prisma.parent.findFirst({
        where: { email: user.email },
      });
      if (parent) return respond("/parent");
    } catch (dbError) {
      console.error("[auth/callback] db_lookup_failed:", dbError);
    }

    return respond("/?error=access_denied");
  } catch (e) {
    console.error("[auth/callback] unhandled:", e);
    return respond("/?error=callback_error");
  }
}
