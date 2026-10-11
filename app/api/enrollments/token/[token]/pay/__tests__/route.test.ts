import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { resolveAccess, getLink } = vi.hoisted(() => ({ resolveAccess: vi.fn(), getLink: vi.fn() }));

vi.mock("@/lib/enrollment/resolve-token", () => ({ resolveEnrollmentAccess: resolveAccess }));
// The real module imports the DB client; the route only needs the link helper
// and the fixed parent-facing message (asserted verbatim below).
vi.mock("@/lib/enrollment/fee-payment", () => ({
  FEE_LINK_FAILED_MESSAGE: "Tautan pembayaran belum bisa dibuat. Coba lagi sebentar.",
  getOrCreateFeePaymentLink: getLink,
}));

import { POST } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const ctx = (token = "tok") => ({ params: Promise.resolve({ token }) });
const req = (ip = "1.1.1.1", body: unknown = {}) =>
  new NextRequest("https://talib.example/api/enrollments/token/tok/pay", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  resolveAccess.mockResolvedValue({ access: "SUBMITTED", id: "app-1", tenantId: "t-1" });
  getLink.mockResolvedValue({ kind: "LINK", paymentUrl: "https://doku.example/pay/1", reused: false });
});

describe("POST /api/enrollments/token/[token]/pay", () => {
  it("returns the payment link for a submitted application, scoped to the token's own tenant", async () => {
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paymentUrl: "https://doku.example/pay/1" });
    expect(getLink).toHaveBeenCalledWith({ applicationId: "app-1", tenantId: "t-1", token: "tok", requestOrigin: "https://talib.example" });
  });

  it("reads nothing from the body: a client-supplied amount, tenant or application id changes nothing", async () => {
    await POST(req("1.1.1.1", { amount: 1, tenantId: "evil", applicationId: "other" }), ctx());
    expect(getLink.mock.calls[0][0]).toMatchObject({ applicationId: "app-1", tenantId: "t-1" });
    expect(getLink.mock.calls[0][0]).not.toHaveProperty("amount");
  });

  it("an unknown (well-shaped) token never creates a per-token limiter entry: 20 distinct ones still never reach the token limit, and each is a plain 404", async () => {
    resolveAccess.mockResolvedValue({ access: "NOT_FOUND", id: null, tenantId: null });
    for (let i = 0; i < 8; i++) {
      expect((await POST(req(`3.3.3.${i}`), ctx("same-unknown-token"))).status).toBe(404);
    }
    // Had the unknown token been counted (limit 6 a minute), the later calls would be 429.
    resolveAccess.mockResolvedValue({ access: "SUBMITTED", id: "app-1", tenantId: "t-1" });
    expect((await POST(req("3.3.3.99"), ctx("same-unknown-token"))).status).toBe(200);
  });

  it("404 for an unknown token, without looking up a fee", async () => {
    resolveAccess.mockResolvedValue({ access: "NOT_FOUND", id: null, tenantId: null });
    expect((await POST(req(), ctx())).status).toBe(404);
    expect(getLink).not.toHaveBeenCalled();
  });

  it("pay-first: works while the form is still INVITED and the fee is owed (PAYMENT_REQUIRED)", async () => {
    resolveAccess.mockResolvedValue({ access: "PAYMENT_REQUIRED", id: "app-1", tenantId: "t-1", hasFee: true });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paymentUrl: "https://doku.example/pay/1" });
    expect(getLink).toHaveBeenCalledWith({ applicationId: "app-1", tenantId: "t-1", token: "tok", requestOrigin: "https://talib.example" });
  });

  it.each(["PAID", "WAIVED"])("an INVITED form whose fee is %s answers { status } instead of a link", async (status) => {
    resolveAccess.mockResolvedValue({ access: "OK", id: "app-1", tenantId: "t-1", hasFee: true });
    getLink.mockResolvedValue({ kind: "SETTLED", status });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status });
  });

  it("404 NO_FEE for an INVITED form that has no fee row (sent before pay-first, or a free program): nothing to pay", async () => {
    resolveAccess.mockResolvedValue({ access: "OK", id: "app-1", tenantId: "t-1", hasFee: false });
    getLink.mockResolvedValue({ kind: "NO_FEE" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NO_FEE" });
  });

  it("409 APPLICATION_CLOSED for an INVITED form whose lead was cancelled: no new link", async () => {
    resolveAccess.mockResolvedValue({ access: "PAYMENT_REQUIRED", id: "app-1", tenantId: "t-1", hasFee: true });
    getLink.mockResolvedValue({ kind: "CLOSED" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "APPLICATION_CLOSED" });
  });

  it("410 for an invite that lapsed before it was ever submitted", async () => {
    resolveAccess.mockResolvedValue({ access: "EXPIRED", id: "app-1", tenantId: "t-1" });
    expect((await POST(req(), ctx())).status).toBe(410);
  });

  it("409 APPLICATION_CLOSED when staff rejected the application: no new link", async () => {
    getLink.mockResolvedValue({ kind: "CLOSED" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "APPLICATION_CLOSED" });
  });

  it.each([
    ["a multi-KB path segment", "a".repeat(5000)],
    ["a token with odd characters", "tok en/../x"],
    ["an empty-looking token", ""],
  ])("404 for %s before any limiter entry or DB lookup is made for it", async (_name, token) => {
    const res = await POST(req(), ctx(token));
    expect(res.status).toBe(404);
    expect(resolveAccess).not.toHaveBeenCalled();
    expect(getLink).not.toHaveBeenCalled();
  });

  it("404 when a submitted application has no fee to pay (free program)", async () => {
    getLink.mockResolvedValue({ kind: "NO_FEE" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it.each(["PAID", "WAIVED"])("200 { status: %s } when there is nothing left to pay", async (status) => {
    getLink.mockResolvedValue({ kind: "SETTLED", status });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status });
  });

  it("502 with a fixed parent-facing message when the gateway cannot issue a link, never the raw error", async () => {
    getLink.mockResolvedValue({ kind: "FAILED" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "LINK_FAILED", message: "Tautan pembayaran belum bisa dibuat. Coba lagi sebentar." });
  });

  it("429 after 10 calls from one address in a minute, before any DB work", async () => {
    for (let i = 0; i < 10; i++) expect((await POST(req("9.9.9.9"), ctx(`t${i}`))).status).toBe(200);
    resolveAccess.mockClear();
    const res = await POST(req("9.9.9.9"), ctx("t-new"));
    expect(res.status).toBe(429);
    expect(resolveAccess).not.toHaveBeenCalled();
  });

  it("429 on the 7th call for one token even from different addresses", async () => {
    for (let i = 0; i < 6; i++) expect((await POST(req(`2.2.2.${i}`), ctx("same"))).status).toBe(200);
    const res = await POST(req("2.2.2.99"), ctx("same"));
    expect(res.status).toBe(429);
    expect(getLink).toHaveBeenCalledTimes(6);
  });
});
