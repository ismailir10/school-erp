/**
 * reconcileEnrollmentFee — the pull path for a pendaftaran fee, used by the
 * public return page (throttled) and the daily sweep. It must change nothing on
 * its own: every transition goes through processPaymentEvent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { feeFindUnique, feeUpdate, fetchPaymentStatus, processPaymentEvent } = vi.hoisted(() => ({
  feeFindUnique: vi.fn(),
  feeUpdate: vi.fn(),
  fetchPaymentStatus: vi.fn(),
  processPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  // `feeUpdate` stands for updateMany: the poll claim is one atomic statement.
  prisma: { enrollmentFee: { findUnique: feeFindUnique, updateMany: feeUpdate }, invoice: { findUnique: vi.fn() } },
}));
vi.mock("../registry", () => ({ getGateway: () => ({ id: "doku", fetchPaymentStatus }) }));
vi.mock("../webhook-processor", () => ({ processPaymentEvent }));

import { GatewayApiError } from "../types";
import { reconcileEnrollmentFee } from "../reconcile";

const NOW = new Date("2026-10-10T03:00:00.000Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "fee-1",
  status: "UNPAID",
  gatewaySessionId: "sess-1",
  ...over,
});
const completed = {
  state: "COMPLETED",
  rawStatus: "SUCCESS",
  paymentId: "pay-1",
  amount: 300_000,
  currency: "IDR",
  channelCode: "VIRTUAL_ACCOUNT_BCA",
  raw: { ok: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  feeFindUnique.mockResolvedValue(row());
  feeUpdate.mockResolvedValue({ count: 1 });
  fetchPaymentStatus.mockResolvedValue({ ...completed });
  processPaymentEvent.mockResolvedValue({ httpStatus: 200, body: { ok: true, status: "PAID" } });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("reconcileEnrollmentFee", () => {
  it("NOT_FOUND for an unknown fee", async () => {
    feeFindUnique.mockResolvedValue(null);
    expect((await reconcileEnrollmentFee("x")).code).toBe("NOT_FOUND");
    expect(fetchPaymentStatus).not.toHaveBeenCalled();
  });

  it.each(["PAID", "WAIVED"])("a %s fee is ALREADY_PAID and the gateway is not asked", async (status) => {
    feeFindUnique.mockResolvedValue(row({ status }));
    expect((await reconcileEnrollmentFee("fee-1")).code).toBe("ALREADY_PAID");
    expect(fetchPaymentStatus).not.toHaveBeenCalled();
  });

  it("does not poll when no gateway session was ever issued", async () => {
    feeFindUnique.mockResolvedValue(row({ gatewaySessionId: null }));
    const r = await reconcileEnrollmentFee("fee-1");
    expect(r).toMatchObject({ code: "NO_CHANGE", message: "Pembayaran belum dimulai." });
    expect(fetchPaymentStatus).not.toHaveBeenCalled();
  });

  it("keys on the session, not the stored link: staff dropping the link must not hide a payment on the old order", async () => {
    // The fee row no longer has a paymentUrl (it is not even selected), yet the
    // parent may still pay the order DOKU holds.
    await reconcileEnrollmentFee("fee-1");
    expect(feeFindUnique.mock.calls[0][0].select).toEqual({ id: true, status: true, gatewaySessionId: true });
    expect(fetchPaymentStatus).toHaveBeenCalledTimes(1);
  });

  it("throttles: when the atomic claim finds the fee checked inside minIntervalMs, the gateway is not touched", async () => {
    // The claim is one UPDATE that checks the interval and stamps in the same statement.
    feeUpdate.mockResolvedValue({ count: 0 });
    const r = await reconcileEnrollmentFee("fee-1", { minIntervalMs: 15_000, now: NOW });
    expect(r).toMatchObject({ code: "NO_CHANGE", message: "Baru saja diperiksa." });
    expect(fetchPaymentStatus).not.toHaveBeenCalled();
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it("the claim only matches a fee never checked, or checked more than the interval ago, and still UNPAID", async () => {
    await reconcileEnrollmentFee("fee-1", { minIntervalMs: 15_000, now: NOW });
    expect(feeUpdate.mock.calls[0][0]).toEqual({
      where: {
        id: "fee-1",
        status: "UNPAID",
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(NOW.getTime() - 15_000) } }],
      },
      data: { lastCheckedAt: NOW },
    });
    expect(fetchPaymentStatus).toHaveBeenCalledTimes(1);
  });

  it("never throttles when minIntervalMs is 0 (staff, cron): the claim has no interval condition", async () => {
    await reconcileEnrollmentFee("fee-1", { minIntervalMs: 0, now: NOW });
    expect(feeUpdate.mock.calls[0][0].where).toEqual({ id: "fee-1", status: "UNPAID" });
    expect(fetchPaymentStatus).toHaveBeenCalledTimes(1);
  });

  it("N concurrent loads: only the one whose claim lands polls the gateway", async () => {
    // The database lets exactly one UPDATE win the interval; the rest see count 0.
    let claimed = false;
    feeUpdate.mockImplementation(async () => {
      if (claimed) return { count: 0 };
      claimed = true;
      return { count: 1 };
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => reconcileEnrollmentFee("fee-1", { minIntervalMs: 15_000, now: NOW })),
    );
    expect(fetchPaymentStatus).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.message === "Baru saja diperiksa.")).toHaveLength(7);
  });

  it("stamps lastCheckedAt BEFORE the network call, so a slow poll does not let the next load through", async () => {
    const order: string[] = [];
    feeUpdate.mockImplementation(async () => {
      order.push("stamp");
      return { count: 1 };
    });
    fetchPaymentStatus.mockImplementation(async () => {
      order.push("poll");
      return { ...completed };
    });
    await reconcileEnrollmentFee("fee-1", { now: NOW });
    expect(order.slice(0, 2)).toEqual(["stamp", "poll"]);
  });

  it("asks the gateway by the fee id (the reference) and the stored session id", async () => {
    await reconcileEnrollmentFee("fee-1");
    expect(fetchPaymentStatus).toHaveBeenCalledWith({ invoiceId: "fee-1", sessionId: "sess-1" });
  });

  it("a settled payment goes through the shared processor, then reports UPDATED when the fee flipped to PAID", async () => {
    feeFindUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ status: "PAID" });
    const r = await reconcileEnrollmentFee("fee-1");
    expect(processPaymentEvent).toHaveBeenCalledTimes(1);
    const ev = processPaymentEvent.mock.calls[0][0];
    expect(ev).toMatchObject({
      provider: "doku",
      kind: "PAYMENT_COMPLETED",
      referenceId: "fee-1",
      sessionId: "sess-1",
      paymentId: "pay-1",
      amount: 300_000,
      currency: "IDR",
    });
    // Deterministic, so repeated polls dedup on WebhookEvent.eventId.
    expect(ev.eventId).toBe("manual:doku:fee-1:COMPLETED:pay-1");
    expect(r).toMatchObject({ code: "UPDATED", statusBefore: "UNPAID", statusAfter: "PAID" });
    expect(r.message).toMatch(/LUNAS/);
  });

  it("an amount the processor refused leaves the fee UNPAID and is NEEDS_REVIEW, not a quiet no-change", async () => {
    processPaymentEvent.mockResolvedValue({ httpStatus: 200, body: { ok: true, status: "ERROR:amount_mismatch" } });
    feeFindUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ status: "UNPAID" });
    const r = await reconcileEnrollmentFee("fee-1");
    expect(r).toMatchObject({ code: "NEEDS_REVIEW", statusAfter: "UNPAID", processorStatus: "ERROR:amount_mismatch" });
    expect(r.message).toMatch(/jumlahnya berbeda/);
    expect(r.message).toMatch(/DOKU/);
  });

  it.each([
    ["ERROR:duplicate_payment_after_paid", /pembayaran kedua/],
    ["ERROR:paid_on_waived_fee", /sudah dibebaskan/],
    ["ERROR:duplicate_payment_id", /sudah tercatat pada biaya lain/],
  ])("%s is NEEDS_REVIEW with its own words", async (processorStatus, words) => {
    processPaymentEvent.mockResolvedValue({ httpStatus: 200, body: { ok: true, status: processorStatus } });
    feeFindUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ status: "UNPAID" });
    const r = await reconcileEnrollmentFee("fee-1");
    expect(r.code).toBe("NEEDS_REVIEW");
    expect(r.message).toMatch(words);
  });

  it("another guard's rejection (missing payment id, non-IDR) stays a plain NO_CHANGE", async () => {
    processPaymentEvent.mockResolvedValue({ httpStatus: 200, body: { ok: true, status: "ERROR:no_payment_id" } });
    feeFindUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ status: "UNPAID" });
    expect((await reconcileEnrollmentFee("fee-1")).code).toBe("NO_CHANGE");
  });

  it("PENDING and FAILED change nothing and never reach the processor", async () => {
    fetchPaymentStatus.mockResolvedValue({ ...completed, state: "PENDING", rawStatus: "PENDING" });
    expect((await reconcileEnrollmentFee("fee-1")).message).toBe("Belum ada pembayaran masuk.");
    fetchPaymentStatus.mockResolvedValue({ ...completed, state: "FAILED", rawStatus: "FAILED" });
    expect((await reconcileEnrollmentFee("fee-1")).message).toBe("Percobaan pembayaran terakhir gagal.");
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it("EXPIRED is dispatched so the stored link is cleared, and the parent is told to start again", async () => {
    fetchPaymentStatus.mockResolvedValue({ ...completed, state: "EXPIRED", rawStatus: "EXPIRED", paymentId: null, amount: null });
    feeFindUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ status: "UNPAID" });
    const r = await reconcileEnrollmentFee("fee-1");
    expect(processPaymentEvent.mock.calls[0][0].kind).toBe("SESSION_EXPIRED");
    expect(r).toMatchObject({ code: "NO_CHANGE", message: "Sesi pembayaran sudah kedaluwarsa. Buat tautan baru." });
  });

  it("keys an expiry on the SESSION, so each re-issued session's expiry is its own event (not dropped as a duplicate of the first)", async () => {
    fetchPaymentStatus.mockResolvedValue({ ...completed, state: "EXPIRED", rawStatus: "EXPIRED", paymentId: null, amount: null });
    feeFindUnique.mockResolvedValue(row({ gatewaySessionId: "sess-1" }));
    await reconcileEnrollmentFee("fee-1");
    feeFindUnique.mockResolvedValue(row({ gatewaySessionId: "sess-2" }));
    await reconcileEnrollmentFee("fee-1");
    const ids = processPaymentEvent.mock.calls.map((c) => c[0].eventId);
    expect(ids).toEqual(["manual:doku:fee-1:EXPIRED:sess-1", "manual:doku:fee-1:EXPIRED:sess-2"]);
    // and the session is passed along so the processor can refuse a stale one
    expect(processPaymentEvent.mock.calls[1][0].sessionId).toBe("sess-2");
  });

  it("a refund is surfaced for manual handling, never reported as settled", async () => {
    fetchPaymentStatus.mockResolvedValue({ ...completed, state: "REFUNDED", rawStatus: "REFUNDED" });
    feeFindUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ status: "UNPAID" });
    const r = await reconcileEnrollmentFee("fee-1");
    expect(processPaymentEvent.mock.calls[0][0]).toMatchObject({ kind: "UNHANDLED", ignoreReason: "REFUND_UNHANDLED" });
    expect(r.message).toMatch(/refund/);
  });

  it("UNAVAILABLE (gateway has no order yet) is reported as such", async () => {
    fetchPaymentStatus.mockResolvedValue({ ...completed, state: "UNAVAILABLE", unavailableReason: "ORDER_NOT_FOUND" });
    expect((await reconcileEnrollmentFee("fee-1")).code).toBe("UNAVAILABLE");
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it("a gateway outage is GATEWAY_ERROR with a fixed message, not the raw error", async () => {
    fetchPaymentStatus.mockRejectedValue(new GatewayApiError({ status: 500, code: "5xx", retriable: true, message: "vendor stack trace" }));
    const r = await reconcileEnrollmentFee("fee-1");
    expect(r.code).toBe("GATEWAY_ERROR");
    expect(r.message).not.toContain("vendor stack trace");
    expect(r.statusAfter).toBe("UNPAID");
  });

  it("a non-gateway throw is also GATEWAY_ERROR with a fixed message", async () => {
    fetchPaymentStatus.mockRejectedValue(new Error("TypeError: secret detail"));
    const r = await reconcileEnrollmentFee("fee-1");
    expect(r.code).toBe("GATEWAY_ERROR");
    expect(r.message).not.toContain("secret detail");
  });
});
