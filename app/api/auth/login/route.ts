// @public — demo-only login, gated by DEMO_MODE + NODE_ENV at request time.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/auth";
import { cookies } from "next/headers";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { isDemoAuthEnabled } from "@/lib/security/demo-mode";

// Demo-only login — requires DEMO_MODE=true AND non-production NODE_ENV.
// The NODE_ENV belt-and-suspenders prevents a misconfigured prod deploy
// (DEMO_MODE accidentally set true) from exposing the cookie-injection
// endpoint.
export async function POST(req: NextRequest) {
  if (!isDemoAuthEnabled() || process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Demo login disabled." },
      { status: 403 }
    );
  }

  // Rate limit: 5 login attempts per minute per IP
  const { success } = rateLimit(`demo-login:${getClientIp(req)}`, 5, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, { status: 429 });
  }

  const { userId } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // NODE_ENV is narrowed to "development" | "test" here by the guard
  // above, so `secure` is always false for the demo cookie — correct.
  const cookieStore = await cookies();
  cookieStore.set("school-erp-session", userId, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const redirectUrl = isAdminRole(user.role) ? "/admin" : "/teacher";
  return NextResponse.json({ ok: true, role: user.role, redirectUrl });
}
