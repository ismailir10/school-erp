import { describe, it, expect } from "vitest";
import { ADMIN_FEE_SELECT, feeAttentionFrom, toAdminFeeView } from "./fee-admin-view";

const NOW = new Date("2026-10-10T03:00:00.000Z");
const row = (over: Record<string, unknown> = {}) => ({
  status: "UNPAID",
  method: null,
  baseAmount: "300000.00",
  discountPercent: 0,
  discountReason: null,
  amount: "300000.00",
  paidAt: null,
  note: null,
  linkError: null,
  lastCheckedAt: null,
  paymentUrl: null,
  sessionExpiresAt: null,
  ...over,
});

describe("toAdminFeeView", () => {
  it("turns Prisma Decimals into whole rupiah numbers and dates into ISO strings", () => {
    const v = toAdminFeeView(row({ amount: "240000.00", discountPercent: 20, paidAt: new Date("2026-10-10T02:00:00.000Z") }), NOW);
    expect(v.amount).toBe(240_000);
    expect(v.baseAmount).toBe(300_000);
    expect(v.paidAt).toBe("2026-10-10T02:00:00.000Z");
  });

  it("an unknown status reads as UNPAID rather than leaking a raw code", () => {
    expect(toAdminFeeView(row({ status: "WEIRD" }), NOW).status).toBe("UNPAID");
    expect(toAdminFeeView(row({ status: "PAID" }), NOW).status).toBe("PAID");
    expect(toAdminFeeView(row({ status: "WAIVED" }), NOW).status).toBe("WAIVED");
  });

  it("linkActive only while a stored link has not expired", () => {
    const live = { paymentUrl: "https://x", sessionExpiresAt: new Date(NOW.getTime() + 60_000) };
    expect(toAdminFeeView(row(live), NOW).linkActive).toBe(true);
    expect(toAdminFeeView(row({ ...live, sessionExpiresAt: new Date(NOW.getTime() - 1) }), NOW).linkActive).toBe(false);
    expect(toAdminFeeView(row({ paymentUrl: null, sessionExpiresAt: live.sessionExpiresAt }), NOW).linkActive).toBe(false);
    expect(toAdminFeeView(row({ paymentUrl: "https://x", sessionExpiresAt: null }), NOW).linkActive).toBe(false);
  });

  it("exposes no gateway link, session or payment id", () => {
    const v = toAdminFeeView(row({ paymentUrl: "https://doku.example/SECRET", sessionExpiresAt: new Date(NOW.getTime() + 1e6) }), NOW);
    expect(JSON.stringify(v)).not.toMatch(/SECRET|paymentUrl|gatewaySessionId|paymentId|sessionExpiresAt/);
  });
});

describe("feeAttentionFrom", () => {
  const ev = (errorMessage: string | null) => ({ errorMessage });

  it("explains a wrong-amount payment with both amounts while the fee is still owed", () => {
    const [a] = feeAttentionFrom([ev("AMOUNT_MISMATCH;expected=240000;got=300000")], "UNPAID");
    expect(a.code).toBe("AMOUNT_MISMATCH");
    expect(a.message).toContain("masuk Rp 300.000");
    expect(a.message).toContain("seharusnya Rp 240.000");
  });

  it("still explains a wrong-amount payment whose numbers cannot be read", () => {
    const [a] = feeAttentionFrom([ev("AMOUNT_MISMATCH")], "UNPAID");
    expect(a.message).toContain("berbeda dari biaya");
    expect(a.message).not.toContain("masuk Rp");
  });

  it("drops a wrong-amount payment once staff settled the fee (PAID or WAIVED): it is history", () => {
    expect(feeAttentionFrom([ev("AMOUNT_MISMATCH;expected=1;got=2")], "PAID")).toEqual([]);
    expect(feeAttentionFrom([ev("AMOUNT_MISMATCH;expected=1;got=2")], "WAIVED")).toEqual([]);
  });

  it("keeps a second payment, money on a waived fee, and a payment recorded elsewhere, whatever the status", () => {
    const events = [ev("DUPLICATE_PAYMENT_AFTER_PAID"), ev("PAID_ON_WAIVED_FEE"), ev("DUPLICATE_PAYMENT_ID")];
    for (const status of ["UNPAID", "PAID", "WAIVED"] as const) {
      expect(feeAttentionFrom(events, status).map((a) => a.code)).toEqual([
        "DUPLICATE_PAYMENT_AFTER_PAID",
        "PAID_ON_WAIVED_FEE",
        "DUPLICATE_PAYMENT_ID",
      ]);
    }
  });

  it("lists each kind once, ignores unrelated or empty errors, and keeps newest-first order", () => {
    const out = feeAttentionFrom(
      [ev("PAID_ON_WAIVED_FEE"), ev(null), ev("SOMETHING_ELSE"), ev("DUPLICATE_PAYMENT_AFTER_PAID"), ev("PAID_ON_WAIVED_FEE")],
      "WAIVED",
    );
    expect(out.map((a) => a.code)).toEqual(["PAID_ON_WAIVED_FEE", "DUPLICATE_PAYMENT_AFTER_PAID"]);
  });

  it("nothing wrong, nothing shown", () => {
    expect(feeAttentionFrom([], "UNPAID")).toEqual([]);
  });
});

describe("ADMIN_FEE_SELECT", () => {
  it("never selects the gateway session id or payment id", () => {
    expect(ADMIN_FEE_SELECT).not.toHaveProperty("gatewaySessionId");
    expect(ADMIN_FEE_SELECT).not.toHaveProperty("paymentId");
  });
});
