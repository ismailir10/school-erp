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
  it("claims the invoice with a stamp in the FUTURE, only while it has no link and is not already claimed", async () => {
    await call();
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where.id).toBe("inv1");
    expect(where.xenditPaymentUrl).toBeNull();
    // Not claimed = never stamped, or stamped in the past (a payment check, harmless).
    expect(where.OR).toEqual([{ paymentCheckedAt: null }, { paymentCheckedAt: { lt: NOW } }]);
    expect(data.paymentCheckedAt.getTime()).toBe(NOW.getTime() + 45_000);
  });

  // The regression the security review found: the parent route runs a payment check
  // (which stamps "now") right before this. That stamp must not read as a claim.
  it("a stamp left by a payment check a moment ago does not block the claim", async () => {
    findUnique.mockResolvedValue(row({ paymentCheckedAt: new Date(NOW.getTime() - 100) }));
    await call();
    const { where } = updateMany.mock.calls[0][0];
    const justBefore = new Date(NOW.getTime() - 100);
    expect(where.OR[1].paymentCheckedAt.lt.getTime()).toBeGreaterThan(justBefore.getTime());
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

  it("on success the claim is turned into an ordinary check stamp, touching only its own claim", async () => {
    await call();
    const finish = updateMany.mock.calls[1][0];
    expect(finish.where).toEqual({ id: "inv1", paymentCheckedAt: new Date(NOW.getTime() + 45_000) });
    expect(finish.data.paymentCheckedAt).toBeInstanceOf(Date);
  });
});

describe("failure", () => {
  it("a thrown gateway error keeps the claim (a cooldown), so a failing invoice is not retried on every press", async () => {
    createSession.mockRejectedValue(new Error("gateway down"));
    expect(await call()).toEqual({ kind: "FAILED" });
    expect(updateMany).toHaveBeenCalledTimes(1); // the claim only: no release, no restore
  });

  it("a session helper that declines (invoice flipped to paid meanwhile) is NOT_PAYABLE and releases only its own claim", async () => {
    findUnique.mockResolvedValue(row({ paymentCheckedAt: new Date("2026-10-17T09:00:00Z") }));
    createSession.mockResolvedValue(null);
    expect(await call()).toEqual({ kind: "NOT_PAYABLE" });
    const release = updateMany.mock.calls[1][0];
    expect(release.where).toEqual({ id: "inv1", paymentCheckedAt: new Date(NOW.getTime() + 45_000) });
    expect(release.data).toEqual({ paymentCheckedAt: new Date("2026-10-17T09:00:00Z") });
  });
});
