import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, createSession } = vi.hoisted(() => ({ findUnique: vi.fn(), createSession: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { invoice: { findUnique } } }));
vi.mock("@/lib/payments/session", () => ({ createPaymentSessionForInvoice: createSession }));

import { ensurePaymentLink } from "@/lib/payments/ensure-link";

const row = (over: Record<string, unknown> = {}) => ({ tenantId: "t1", status: "OVERDUE", xenditPaymentUrl: null, ...over });
const call = () => ensurePaymentLink("inv1", "t1", "https://app.test", { waitForWinnerMs: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  findUnique.mockResolvedValue(row());
  createSession.mockResolvedValue({ paymentUrl: "https://checkout.doku.com/new", created: true });
});

// The one-link-per-invoice guarantee itself is tested against the real helper in
// `link-claim.test.ts`; this wrapper only decides who may ask and how the answer is told.
describe("what may get a link", () => {
  it.each(["SENT", "PARTIALLY_PAID", "OVERDUE"])("%s without a link gets one", async (status) => {
    findUnique.mockResolvedValue(row({ status }));
    expect(await call()).toEqual({ kind: "READY", paymentUrl: "https://checkout.doku.com/new", created: true });
    expect(createSession).toHaveBeenCalledWith("inv1", "t1", "https://app.test", {
      holdClaimOnFailure: true,
      waitForWinnerMs: 0,
      now: undefined,
    });
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

describe("what it reports", () => {
  it("an invoice that already has a link returns it and creates nothing", async () => {
    findUnique.mockResolvedValue(row({ xenditPaymentUrl: "https://checkout.doku.com/live" }));
    expect(await call()).toEqual({ kind: "READY", paymentUrl: "https://checkout.doku.com/live", created: false });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("a link another caller made while this one waited is READY but not 'created'", async () => {
    createSession.mockResolvedValue({ paymentUrl: "https://checkout.doku.com/winner", created: false });
    expect(await call()).toEqual({ kind: "READY", paymentUrl: "https://checkout.doku.com/winner", created: false });
  });

  it("a declined create on an invoice that is still unpaid is FAILED (the claim holder never produced a link)", async () => {
    createSession.mockResolvedValue(null);
    findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ status: "OVERDUE" });
    expect(await call()).toEqual({ kind: "FAILED" });
  });

  it("a declined create on an invoice paid meanwhile is NOT_PAYABLE", async () => {
    createSession.mockResolvedValue(null);
    findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ status: "PAID" });
    expect(await call()).toEqual({ kind: "NOT_PAYABLE" });
  });

  it("a thrown gateway error is FAILED", async () => {
    createSession.mockRejectedValue(new Error("gateway down"));
    expect(await call()).toEqual({ kind: "FAILED" });
  });
});
