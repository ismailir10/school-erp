import { describe, it, expect, vi, beforeEach } from "vitest";

const { feeFindUnique, feeUpdate, createSession } = vi.hoisted(() => ({
  feeFindUnique: vi.fn(),
  feeUpdate: vi.fn(),
  createSession: vi.fn(),
}));

// `feeUpdate` stands for updateMany: every write is a compare-and-set.
vi.mock("@/lib/db", () => ({ prisma: { enrollmentFee: { findUnique: feeFindUnique, updateMany: feeUpdate } } }));
vi.mock("@/lib/payments/registry", () => ({ getGateway: () => ({ id: "doku", createSession }) }));

import { GatewayApiError } from "@/lib/payments/types";
import { getOrCreateFeePaymentLink } from "./fee-payment";

const NOW = new Date("2026-10-10T03:00:00.000Z");
const ORIGIN = "https://talib.example";
const base = { applicationId: "app-1", tenantId: "t-1", token: "tok/with space", requestOrigin: ORIGIN, now: NOW };

function fee(over: Record<string, unknown> = {}) {
  return {
    id: "fee-1",
    tenantId: "t-1",
    status: "UNPAID",
    amount: "300000",
    paymentUrl: null,
    sessionExpiresAt: null,
    application: {
      status: "SUBMITTED",
      childName: "Aisyah Putri",
      parentEmail: "app@example.com",
      admission: { parentName: "Bu Siti", parentEmail: "siti@example.com", parentPhone: "0811111", parentWhatsapp: "081234567890" },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  feeFindUnique.mockResolvedValue(fee());
  feeUpdate.mockResolvedValue({ count: 1 });
  createSession.mockResolvedValue({ id: "sess-1", paymentUrl: "https://doku.example/pay/1", status: "PENDING", expiresAt: "x" });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getOrCreateFeePaymentLink", () => {
  it("is NO_FEE when the application has no fee row, or it belongs to another tenant", async () => {
    feeFindUnique.mockResolvedValue(null);
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "NO_FEE" });
    feeFindUnique.mockResolvedValue(fee({ tenantId: "t-2" }));
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "NO_FEE" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("is NO_FEE for a zero amount (nothing to charge)", async () => {
    feeFindUnique.mockResolvedValue(fee({ amount: "0" }));
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "NO_FEE" });
  });

  it.each(["PAID", "WAIVED"])("a %s fee is SETTLED and never reaches the gateway", async (status) => {
    feeFindUnique.mockResolvedValue(fee({ status }));
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "SETTLED", status });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("hands back the stored link while it has more than 10 minutes left", async () => {
    feeFindUnique.mockResolvedValue(
      fee({ paymentUrl: "https://doku.example/pay/old", sessionExpiresAt: new Date(NOW.getTime() + 3 * 86_400_000) }),
    );
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "LINK", paymentUrl: "https://doku.example/pay/old", reused: true });
    expect(createSession).not.toHaveBeenCalled();
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["about to expire", new Date(NOW.getTime() + 5 * 60_000)],
    ["already expired", new Date(NOW.getTime() - 60_000)],
    ["with no recorded expiry", null],
  ])("replaces a stored link that is %s", async (_name, sessionExpiresAt) => {
    feeFindUnique.mockResolvedValue(fee({ paymentUrl: "https://doku.example/pay/old", sessionExpiresAt }));
    const link = await getOrCreateFeePaymentLink(base);
    expect(link).toEqual({ kind: "LINK", paymentUrl: "https://doku.example/pay/1", reused: false });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("creates a session priced at the fee's snapshotted amount, referenced by the fee id", async () => {
    await getOrCreateFeePaymentLink(base);
    const p = createSession.mock.calls[0][0];
    expect(p.referenceId).toBe("fee-1");
    expect(p.amount).toBe(300_000);
    expect(p.items).toEqual([{ name: "Biaya pendaftaran", quantity: 1, price: 300_000 }]);
    expect(p.description).toBe("Biaya pendaftaran — Aisyah Putri");
    expect(p.customerName).toBe("Bu Siti");
    expect(p.customerEmail).toBe("siti@example.com");
    // WhatsApp number preferred over the landline-ish phone.
    expect(p.customerPhone).toBe("081234567890");
    expect(p.notificationUrl).toBe(`${ORIGIN}/api/doku/webhook`);
    // The caller's own origin, with the token URL-encoded into the return pages.
    expect(p.successReturnUrl).toBe(`${ORIGIN}/pendaftaran/tok%2Fwith%20space/pembayaran?status=paid`);
    expect(p.cancelReturnUrl).toBe(`${ORIGIN}/pendaftaran/tok%2Fwith%20space/pembayaran?status=cancel`);
    // 7 days from now, as an instant.
    expect(p.expiresAt.getTime()).toBe(NOW.getTime() + 7 * 86_400_000);
  });

  it("falls back to the application's contact data when the admission carries none", async () => {
    feeFindUnique.mockResolvedValue(
      fee({ application: { status: "SUBMITTED", childName: "Aisyah Putri", parentEmail: "app@example.com", admission: null } }),
    );
    await getOrCreateFeePaymentLink(base);
    const p = createSession.mock.calls[0][0];
    expect(p.customerName).toBe("Aisyah Putri");
    expect(p.customerEmail).toBe("app@example.com");
    expect(p.customerPhone).toBeUndefined();
  });

  it("stores the session, its expiry and clears any old error — as a compare-and-set", async () => {
    await getOrCreateFeePaymentLink(base);
    const update = feeUpdate.mock.calls[0][0];
    // Applies only while the fee is still UNPAID, still the amount the session
    // was priced at, and still without a usable link.
    expect(update.where).toMatchObject({ id: "fee-1", status: "UNPAID", amount: "300000" });
    expect(update.where.OR).toEqual([
      { paymentUrl: null },
      { sessionExpiresAt: null },
      { sessionExpiresAt: { lte: new Date(NOW.getTime() + 10 * 60_000) } },
    ]);
    expect(update.data).toEqual({
      gatewaySessionId: "sess-1",
      paymentUrl: "https://doku.example/pay/1",
      sessionExpiresAt: new Date(NOW.getTime() + 7 * 86_400_000),
      linkError: null,
    });
  });

  it("lost race: another request stored a link first → its link is returned, ours is dropped unseen", async () => {
    feeFindUnique
      .mockResolvedValueOnce(fee())
      .mockResolvedValueOnce(fee({ paymentUrl: "https://doku.example/pay/winner", sessionExpiresAt: new Date(NOW.getTime() + 86_400_000) }));
    feeUpdate.mockResolvedValueOnce({ count: 0 });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const link = await getOrCreateFeePaymentLink(base);

    expect(link).toEqual({ kind: "LINK", paymentUrl: "https://doku.example/pay/winner", reused: true });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("lost race because staff changed the amount mid-flight → a fresh session at the new amount", async () => {
    feeFindUnique.mockResolvedValueOnce(fee()).mockResolvedValueOnce(fee({ amount: "240000" }));
    feeUpdate.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    createSession
      .mockResolvedValueOnce({ id: "sess-old", paymentUrl: "https://doku.example/pay/old-amount", status: "PENDING", expiresAt: "x" })
      .mockResolvedValueOnce({ id: "sess-new", paymentUrl: "https://doku.example/pay/new-amount", status: "PENDING", expiresAt: "x" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const link = await getOrCreateFeePaymentLink(base);

    expect(link).toEqual({ kind: "LINK", paymentUrl: "https://doku.example/pay/new-amount", reused: false });
    expect(createSession.mock.calls.map((c) => c[0].amount)).toEqual([300_000, 240_000]);
    // The stale link was never stored.
    expect(feeUpdate.mock.calls[1][0].data.paymentUrl).toBe("https://doku.example/pay/new-amount");
  });

  it("loses the race twice → FAILED, not a loop", async () => {
    feeUpdate.mockResolvedValue({ count: 0 });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "FAILED" });
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("a fee settled while the session was being minted is reported SETTLED, not given a link", async () => {
    feeFindUnique.mockResolvedValueOnce(fee()).mockResolvedValueOnce(fee({ status: "PAID" }));
    feeUpdate.mockResolvedValueOnce({ count: 0 });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "SETTLED", status: "PAID" });
  });

  it("CLOSED for a rejected application's unpaid fee — no new link is issued", async () => {
    feeFindUnique.mockResolvedValue(fee({ application: { ...fee().application, status: "REJECTED" } }));
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "CLOSED" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("a fee already PAID stays SETTLED even if the application was later rejected", async () => {
    feeFindUnique.mockResolvedValue(fee({ status: "PAID", application: { ...fee().application, status: "REJECTED" } }));
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "SETTLED", status: "PAID" });
  });

  it("a gateway failure is FAILED, records a prefixed linkError for staff, and throws nothing", async () => {
    createSession.mockRejectedValue(new GatewayApiError({ status: 422, code: "422", retriable: false, message: "PAYMENT CHANNEL IS INACTIVE" }));
    const link = await getOrCreateFeePaymentLink(base);
    expect(link).toEqual({ kind: "FAILED" });
    expect(feeUpdate.mock.calls[0][0].data).toEqual({ linkError: "422: PAYMENT CHANNEL IS INACTIVE" });
  });

  it("the failure is recorded only while the fee has no working link (never painted over a good one)", async () => {
    createSession.mockRejectedValue(new Error("boom"));
    await getOrCreateFeePaymentLink(base);
    const where = feeUpdate.mock.calls[0][0].where;
    expect(where.id).toBe("fee-1");
    expect(where.OR).toEqual([
      { paymentUrl: null },
      { sessionExpiresAt: null },
      { sessionExpiresAt: { lte: new Date(NOW.getTime() + 10 * 60_000) } },
    ]);
  });

  it("still returns FAILED when even recording the error fails", async () => {
    createSession.mockRejectedValue(new Error("boom"));
    feeUpdate.mockRejectedValue(new Error("db down"));
    expect(await getOrCreateFeePaymentLink(base)).toEqual({ kind: "FAILED" });
  });

  it("DEMO_MODE-style synthetic sessions flow through unchanged", async () => {
    createSession.mockResolvedValue({ id: "demo_session_fee-1", paymentUrl: "https://demo.doku.local/checkout/fee-1", status: "PENDING", expiresAt: "x" });
    expect(await getOrCreateFeePaymentLink(base)).toMatchObject({ kind: "LINK", paymentUrl: "https://demo.doku.local/checkout/fee-1" });
  });
});
