import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getXenditSessionStatus, parseXenditInvoiceStatus } from "../client";

const legacyId = "62efe4c33e45294d63f585f2";

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "");
  vi.stubEnv("XENDIT_SECRET_KEY", "test-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("legacy Xendit invoice status", () => {
  it("polls the legacy invoice endpoint for its historical ID format", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: legacyId, status: "EXPIRED" })));
    vi.stubGlobal("fetch", fetch);
    expect(await getXenditSessionStatus({ invoiceId: "inv1", sessionId: legacyId })).toMatchObject({ state: "EXPIRED", rawStatus: "EXPIRED" });
    expect(fetch).toHaveBeenCalledWith(`https://api.xendit.co/v2/invoices/${legacyId}`, expect.objectContaining({ method: "GET" }));
  });

  it.each(["PAID", "SETTLED"])("credits paid_amount for %s, with a stable provider payment identity", (status) => {
    expect(parseXenditInvoiceStatus({ id: legacyId, status, amount: 950000, paid_amount: "850000.00", currency: "IDR", payment_channel: "BCA" })).toMatchObject({
      state: "COMPLETED", paymentId: legacyId, amount: 850000, currency: "IDR", channelCode: "BCA",
    });
    expect(parseXenditInvoiceStatus({ id: legacyId, status, payment_id: "actual-payment", paid_amount: 850000 }).paymentId).toBe("actual-payment");
  });

  it("does not substitute the invoice face value when the received amount is absent", () => {
    expect(parseXenditInvoiceStatus({ id: legacyId, status: "PAID", amount: 850000 }).amount).toBeNull();
  });

  it("keeps modern Checkout Session polling on its original endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ps-modern", status: "ACTIVE" })));
    vi.stubGlobal("fetch", fetch);
    expect((await getXenditSessionStatus({ invoiceId: "inv1", sessionId: "ps-modern" })).state).toBe("PENDING");
    expect(fetch).toHaveBeenCalledWith("https://api.xendit.co/sessions/ps-modern", expect.anything());
  });

  it("a missing stored ID remains unavailable without guessing from the checkout URL", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await getXenditSessionStatus({ invoiceId: "inv1", sessionId: null })).toMatchObject({ state: "UNAVAILABLE", unavailableReason: "NO_SESSION_ID" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds a legacy status request to 10 seconds and keeps the typed network error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const outcome = getXenditSessionStatus({ invoiceId: "inv1", sessionId: legacyId }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await outcome).toMatchObject({ name: "GatewayApiError", code: "network", retriable: true });
  });
});
