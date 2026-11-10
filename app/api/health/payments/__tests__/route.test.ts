/**
 * Tests for `GET /api/health/payments` — gateway-aware deploy-time payment
 * probe (cycle 2026-07-27-doku-payment-gateway T5, AC-18).
 *
 * Mirrors `app/api/health/xendit/__tests__/route.test.ts` in style and
 * coverage shape. The route resolves the adapter via `getGateway()` and
 * calls `gateway.ping()` through the `PaymentGateway` port, so the seam to
 * mock is `getGateway` itself (the same established seam used by
 * `lib/__tests__/xendit-helpers.test.ts` and
 * `app/api/invoices/[id]/webhook-events/route.ts`'s tests) rather than a
 * concrete client function — mocking a concrete `ping*` export would not
 * intercept the gateway object's own closure over it.
 *
 * Coverage:
 * (a) DOKU tier "live" on success (DOKU_ENV=production)
 * (b) DOKU tier "sandbox" on success (DOKU_ENV=sandbox)
 * (c) DOKU tier "unknown" when DOKU_ENV unset — short-circuits, no ping
 * (d) DOKU tier "unknown" when DOKU_ENV has an unrecognized value
 * (e) DOKU ping 401 → 503 code:"401"
 * (f) ping network throw → 503 code:"network"
 * (g) rate-limit hit returns 429 (not via cache)
 * (h) cache hit short-circuits second call within 30s (no re-ping)
 * (i) response body never echoes DOKU_SECRET_KEY / DOKU_CLIENT_ID
 * (j) response body never echoes XENDIT_SECRET_KEY (Xendit gateway path)
 * (k) cache does not leak across a PAYMENT_GATEWAY flip
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payments/registry", () => ({
  getGateway: vi.fn(),
}));

import { getGateway } from "@/lib/payments/registry";
import { GatewayApiError } from "@/lib/payments/types";
import type { PaymentGateway } from "@/lib/payments/types";
import { GET } from "../route";

const getGatewayMock = getGateway as unknown as ReturnType<typeof vi.fn>;

let testIpCounter = 0;
function makeRequest(): Request {
  // Unique IP per call to side-step the shared rate-limit store between tests.
  testIpCounter += 1;
  return new Request("http://localhost/api/health/payments", {
    method: "GET",
    headers: {
      "X-Forwarded-For": `198.51.100.${testIpCounter}`,
    },
  });
}

function makeGateway(
  id: PaymentGateway["id"],
  ping: (timeoutMs?: number) => Promise<void>,
): PaymentGateway {
  return { id, maxSessionWindowMs: 30 * 86_400_000, ping, createSession: vi.fn(), fetchPaymentStatus: vi.fn() };
}

const ORIGINAL_DOKU_ENV = process.env.DOKU_ENV;
const ORIGINAL_DOKU_CLIENT_ID = process.env.DOKU_CLIENT_ID;
const ORIGINAL_DOKU_SECRET_KEY = process.env.DOKU_SECRET_KEY;
const ORIGINAL_XENDIT_KEY = process.env.XENDIT_SECRET_KEY;

beforeEach(() => {
  globalThis.__paymentsHealthCache = undefined;
  getGatewayMock.mockReset();
});

afterEach(() => {
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("DOKU_ENV", ORIGINAL_DOKU_ENV);
  restore("DOKU_CLIENT_ID", ORIGINAL_DOKU_CLIENT_ID);
  restore("DOKU_SECRET_KEY", ORIGINAL_DOKU_SECRET_KEY);
  restore("XENDIT_SECRET_KEY", ORIGINAL_XENDIT_KEY);
});

// --------------------------------------------------------------------------
// DOKU tier detection from DOKU_ENV
// --------------------------------------------------------------------------

describe("GET /api/health/payments — DOKU tier detection from DOKU_ENV", () => {
  it("(a) live tier on success when DOKU_ENV=production", async () => {
    process.env.DOKU_ENV = "production";
    const ping = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, source: "doku", tier: "live" });
    expect(typeof body.checkedAt).toBe("string");
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("(b) sandbox tier on success when DOKU_ENV=sandbox", async () => {
    process.env.DOKU_ENV = "sandbox";
    const ping = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, source: "doku", tier: "sandbox" });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("(c) unknown tier short-circuits when DOKU_ENV unset — no ping fires", async () => {
    delete process.env.DOKU_ENV;
    const ping = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      source: "doku",
      tier: "unknown",
      code: "unknown",
    });
    expect(ping).not.toHaveBeenCalled();
  });

  it("(d) unknown tier short-circuits when DOKU_ENV has an unrecognized value", async () => {
    process.env.DOKU_ENV = "staging";
    const ping = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.tier).toBe("unknown");
    expect(ping).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Error paths
// --------------------------------------------------------------------------

describe("GET /api/health/payments — DOKU error responses", () => {
  it('(e) 401 from DOKU → 503 with code:"401" and the typed error message', async () => {
    process.env.DOKU_ENV = "sandbox";
    const ping = vi.fn().mockRejectedValue(
      new GatewayApiError({
        status: 401,
        code: "401",
        retriable: false,
        message: "DOKU returned 401: invalid signature",
      }),
    );
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      source: "doku",
      tier: "sandbox",
      code: "401",
      error: "DOKU returned 401: invalid signature",
    });
  });

  it('(f) network throw → 503 with code:"network"', async () => {
    process.env.DOKU_ENV = "sandbox";
    const ping = vi.fn().mockRejectedValue(
      new GatewayApiError({
        status: null,
        code: "network",
        retriable: true,
        message: "fetch failed",
      }),
    );
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe("network");
    expect(body.tier).toBe("sandbox");
  });
});

// --------------------------------------------------------------------------
// Rate limit + cache
// --------------------------------------------------------------------------

describe("GET /api/health/payments — rate limit", () => {
  it("(g) rate-limit hit returns 429 from the route (not via cache)", async () => {
    process.env.DOKU_ENV = "sandbox";
    const ping = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const fixedIp = "198.51.100.250";
    function pinnedReq(): Request {
      return new Request("http://localhost/api/health/payments", {
        method: "GET",
        headers: { "X-Forwarded-For": fixedIp },
      });
    }

    let lastStatus = 0;
    for (let i = 0; i < 30; i++) {
      const res = await GET(pinnedReq());
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(200);

    const overflow = await GET(pinnedReq());
    expect(overflow.status).toBe(429);
    const overflowBody = await overflow.json();
    expect(overflowBody.error).toBe("Too many requests");
  });
});

describe("GET /api/health/payments — cache", () => {
  it("(h) cache hit short-circuits — second call within 30s does NOT re-ping", async () => {
    process.env.DOKU_ENV = "sandbox";
    const ping = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const res1 = await GET(makeRequest());
    expect(res1.status).toBe(200);
    expect(ping).toHaveBeenCalledTimes(1);

    // Second call from a DIFFERENT ip — proves the cache is not per-ip.
    const res2 = await GET(makeRequest());
    const body2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2.ok).toBe(true);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("(k) cache does not leak across a PAYMENT_GATEWAY flip", async () => {
    process.env.DOKU_ENV = "sandbox";
    process.env.XENDIT_SECRET_KEY = "xnd_development_ok";

    const dokuPing = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("doku", dokuPing));

    const res1 = await GET(makeRequest());
    const body1 = await res1.json();
    expect(body1.source).toBe("doku");
    expect(dokuPing).toHaveBeenCalledTimes(1);

    // Flip to Xendit — must NOT read the DOKU cache entry, must ping fresh.
    const xenditPing = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("xendit", xenditPing));

    const res2 = await GET(makeRequest());
    const body2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2.source).toBe("xendit");
    expect(xenditPing).toHaveBeenCalledTimes(1);

    // Flip back to DOKU within the 30s window — should hit the still-live
    // DOKU cache entry rather than re-pinging.
    getGatewayMock.mockReturnValue(makeGateway("doku", dokuPing));
    const res3 = await GET(makeRequest());
    const body3 = await res3.json();
    expect(body3.source).toBe("doku");
    expect(dokuPing).toHaveBeenCalledTimes(1); // still 1 — cache hit, not re-pinged
  });
});

// --------------------------------------------------------------------------
// Security: secret never echoed in response
// --------------------------------------------------------------------------

describe("GET /api/health/payments — secret never echoed in response", () => {
  it("(i) response body never contains DOKU_SECRET_KEY / DOKU_CLIENT_ID on success", async () => {
    process.env.DOKU_ENV = "sandbox";
    process.env.DOKU_CLIENT_ID = "BRN-0249-SUPERSECRETCLIENT";
    process.env.DOKU_SECRET_KEY = "SK-SUPERSECRETKEY12345";
    const ping = vi.fn().mockResolvedValue(undefined);
    getGatewayMock.mockReturnValue(makeGateway("doku", ping));

    const res = await GET(makeRequest());
    const bodyText = await res.text();

    expect(bodyText).not.toContain("SUPERSECRETCLIENT");
    expect(bodyText).not.toContain("SUPERSECRETKEY12345");
    expect(bodyText).toContain("sandbox");
  });

  it("(j) response body never contains XENDIT_SECRET_KEY on error (Xendit gateway path)", async () => {
    process.env.XENDIT_SECRET_KEY = "xnd_development_SUPERSECRETXENDIT";
    const ping = vi.fn().mockRejectedValue(
      new GatewayApiError({
        status: 401,
        code: "401",
        retriable: false,
        message: "Xendit returned 401",
      }),
    );
    getGatewayMock.mockReturnValue(makeGateway("xendit", ping));

    const res = await GET(makeRequest());
    const bodyText = await res.text();

    expect(bodyText).not.toContain("SUPERSECRETXENDIT");
  });
});
