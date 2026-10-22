import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { enforceAuthRateLimit } from "../auth-rate-limit";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

function makeReq(path: string, ip: string | null = "1.2.3.4"): NextRequest {
  const headers: Record<string, string> = {};
  if (ip !== null) headers["x-forwarded-for"] = ip;
  return new NextRequest(new URL(`http://localhost${path}`), { headers });
}

describe("enforceAuthRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTest();
  });

  it("returns null for non-auth paths", () => {
    expect(enforceAuthRateLimit(makeReq("/api/students"))).toBeNull();
    expect(enforceAuthRateLimit(makeReq("/admin"))).toBeNull();
  });

  it("allows the first 5 requests and 429s the 6th", () => {
    for (let i = 0; i < 5; i++) {
      expect(enforceAuthRateLimit(makeReq("/api/auth/login"))).toBeNull();
    }
    const sixth = enforceAuthRateLimit(makeReq("/api/auth/login"));
    expect(sixth).not.toBeNull();
    expect(sixth!.status).toBe(429);
  });

  it("includes Retry-After: 60 + body on 429 response", async () => {
    for (let i = 0; i < 5; i++) enforceAuthRateLimit(makeReq("/api/auth/login"));
    const blocked = enforceAuthRateLimit(makeReq("/api/auth/login"));
    expect(blocked!.headers.get("Retry-After")).toBe("60");
    const json = await blocked!.json();
    expect(json).toEqual({ error: "rate_limited" });
  });

  it("scopes per-IP — different IPs do not share the bucket", () => {
    for (let i = 0; i < 5; i++)
      enforceAuthRateLimit(makeReq("/api/auth/login", "1.1.1.1"));
    expect(enforceAuthRateLimit(makeReq("/api/auth/login", "1.1.1.1"))).not.toBeNull();
    expect(enforceAuthRateLimit(makeReq("/api/auth/login", "2.2.2.2"))).toBeNull();
  });

  it("shares one bucket across all /api/auth/* sub-paths per IP", () => {
    // Path rotation must NOT multiply the cap — credential stuffing protection.
    enforceAuthRateLimit(makeReq("/api/auth/login"));
    enforceAuthRateLimit(makeReq("/api/auth/signup"));
    enforceAuthRateLimit(makeReq("/api/auth/reset"));
    enforceAuthRateLimit(makeReq("/api/auth/verify"));
    enforceAuthRateLimit(makeReq("/api/auth/callback"));
    // 6th hit on any auth path is blocked
    expect(enforceAuthRateLimit(makeReq("/api/auth/anything"))).not.toBeNull();
  });

  it("skips rate limit when IP is unidentifiable (no XFF)", () => {
    // Vercel always sets XFF — this fallback only triggers in dev. Sharing
    // an "anonymous" bucket would let one bot DoS every legitimate caller.
    for (let i = 0; i < 20; i++) {
      expect(enforceAuthRateLimit(makeReq("/api/auth/login", null))).toBeNull();
    }
  });

  it("skips rate limit when DEMO_MODE=true", () => {
    // Demo mode is dev/staging/e2e — those environments hit /api/auth/users
    // and friends repeatedly during test setup. Rate-limiting them breaks
    // test fixtures (response body becomes {error:"rate_limited"} object
    // instead of the expected array, and `users.find` throws).
    vi.stubEnv("DEMO_MODE", "true");
    for (let i = 0; i < 20; i++) {
      expect(enforceAuthRateLimit(makeReq("/api/auth/login"))).toBeNull();
    }
    vi.unstubAllEnvs();
  });

  it("still rate-limits when DEMO_MODE=true on Vercel", () => {
    // A stray DEMO_MODE on a deployed env must not switch the limiter off.
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("VERCEL", "1");
    const ip = "203.0.113.99";
    for (let i = 0; i < 5; i++) {
      expect(enforceAuthRateLimit(makeReq("/api/auth/login", ip))).toBeNull();
    }
    expect(enforceAuthRateLimit(makeReq("/api/auth/login", ip))?.status).toBe(429);
    vi.unstubAllEnvs();
  });
});
