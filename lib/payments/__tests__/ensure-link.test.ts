import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, updateMany, createSession } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { invoice: { findUnique, updateMany } } }));
vi.mock("@/lib/payments/session", () => ({ createPaymentSessionForInvoice: createSession }));

import { ensurePaymentLink } from "@/lib/payments/ensure-link";

const NOW = new Date("2026-10-17T10:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  tenantId: "t1",
  status: "OVERDUE",
  xenditPaymentUrl: null,
  paymentCheckedAt: null,
  ...over,
});
const call = (waitForWinnerMs = 0) => ensurePaymentLink("inv1", "t1", "https://app.test", { now: NOW, waitForWinnerMs });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  findUnique.mockResolvedValue(row());
  updateMany.mockResolvedValue({ count: 1 });
  createSession.mockResolvedValue({ paymentUrl: "https://checkout.doku.com/new" });
});

describe("what may get a link", () => {
  it.each(["SENT", "PARTIALLY_PAID", "OVERDUE"])("%s without a link gets one", async (status) => {
    findUnique.mockResolvedValue(row({ status }));
    expect(await call()).toEqual({ kind: "READY", paymentUrl: "https://checkout.doku.com/new", created: true });
    expect(createSession).toHaveBeenCalledWith("inv1", "t1", "https://app.test");
  });

  it.each(["PAID", "CANCELLED", "DRAFT", "PENDING_PAYMENT_LINK"])("%s is not payable this way", async (status) => {
    findUnique.mockResolvedValue(row({ status }));
    expect(await call()).toEqual({ kind: "NOT_PAYABLE" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("another school's invoice, or a missing one, is not payable", async () => {
    findUnique.mockResolvedValue(row({ tenantId: "other" }));
    expect(await call()).toEqual({ kind: "NOT_PAYABLE" });
    findUnique.mockResolvedValue(null);
    expect(await call()).toEqual({ kind: "NOT_PAYABLE" });
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("an invoice that already has a link", () => {
  it("returns it and creates nothing", async () => {
    findUnique.mockResolvedValue(row({ xenditPaymentUrl: "https://checkout.doku.com/live" }));
    expect(await call()).toEqual({ kind: "READY", paymentUrl: "https://checkout.doku.com/live", created: false });
    expect(updateMany).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("creating exactly one link", () => {
  it("claims the invoice only while it has no link and was not claimed in the last 30 s", async () => {
    await call();
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where.xenditPaymentUrl).toBeNull();
    expect(where.OR[0]).toEqual({ paymentCheckedAt: null });
    expect(where.OR[1].paymentCheckedAt.lt.getTime()).toBe(NOW.getTime() - 30_000);
    expect(data).toEqual({ paymentCheckedAt: NOW });
  });

  it("a caller that loses the claim creates nothing and returns the winner's link", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce({ xenditPaymentUrl: null })
      .mockResolvedValueOnce({ xenditPaymentUrl: "https://checkout.doku.com/winner" });

    expect(await call(5_000)).toEqual({ kind: "READY", paymentUrl: "https://checkout.doku.com/winner", created: false });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("a loser whose winner never produces a link gives up instead of making a second one", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue(row());
    expect(await call(0)).toEqual({ kind: "FAILED" });
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("failure", () => {
  it("a thrown gateway error gives the claim back and reports FAILED", async () => {
    findUnique.mockResolvedValue(row({ paymentCheckedAt: new Date("2026-10-17T09:00:00Z") }));
    createSession.mockRejectedValue(new Error("gateway down"));

    expect(await call()).toEqual({ kind: "FAILED" });
    const release = updateMany.mock.calls[1][0];
    expect(release.where).toEqual({ id: "inv1", xenditPaymentUrl: null });
    expect(release.data).toEqual({ paymentCheckedAt: new Date("2026-10-17T09:00:00Z") });
  });

  it("a session helper that declines (invoice flipped to paid meanwhile) is NOT_PAYABLE and releases the claim", async () => {
    createSession.mockResolvedValue(null);
    expect(await call()).toEqual({ kind: "NOT_PAYABLE" });
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
