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

  it("404 for an unknown token, without looking up a fee", async () => {
    resolveAccess.mockResolvedValue({ access: "NOT_FOUND", id: null, tenantId: null });
    expect((await POST(req(), ctx())).status).toBe(404);
    expect(getLink).not.toHaveBeenCalled();
  });

  it("409 NOT_SUBMITTED while the form is still open (no fee exists yet)", async () => {
    resolveAccess.mockResolvedValue({ access: "OK", id: "app-1", tenantId: "t-1" });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "NOT_SUBMITTED" });
    expect(getLink).not.toHaveBeenCalled();
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

  it("404 when the application has no fee to pay (free program)", async () => {
    getLink.mockResolvedValue({ kind: "NO_FEE" });
    expect((await POST(req(), ctx())).status).toBe(404);
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
