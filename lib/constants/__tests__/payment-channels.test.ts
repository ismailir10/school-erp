import { describe, it, expect } from "vitest";
import { paymentChannelLabel } from "@/lib/constants/payment-channels";
import { paymentMethodLabel } from "@/lib/constants/payment-methods";

describe("paymentChannelLabel", () => {
  it.each([
    ["VIRTUAL_ACCOUNT_BCA", "Virtual Account BCA"],
    ["VIRTUAL_ACCOUNT_BANK_MANDIRI", "Virtual Account Bank Mandiri"],
    ["VIRTUAL_ACCOUNT_BRI", "Virtual Account BRI"],
    ["VIRTUAL_ACCOUNT_DOKU", "Virtual Account DOKU"],
  ])("%s → %s", (raw, label) => {
    expect(paymentChannelLabel(raw)).toBe(label);
  });

  it("title-cases a non-VA channel and keeps known acronyms", () => {
    expect(paymentChannelLabel("EMONEY_OVO")).toBe("Emoney OVO");
    expect(paymentChannelLabel("CREDIT_CARD")).toBe("Credit Card");
  });

  it("does not throw on odd input", () => {
    expect(paymentChannelLabel("")).toBe("");
    expect(paymentChannelLabel("__")).toBe("");
  });
});

describe("paymentMethodLabel with a stored channel", () => {
  it("uses the rail for a gateway payment", () => {
    expect(paymentMethodLabel("DOKU", "VIRTUAL_ACCOUNT_BCA")).toBe("Virtual Account BCA");
  });

  it("falls back to the method when no channel was stored (older payments)", () => {
    expect(paymentMethodLabel("DOKU")).toBe("Virtual Account (DOKU)");
    expect(paymentMethodLabel("DOKU", null)).toBe("Virtual Account (DOKU)");
    expect(paymentMethodLabel("DOKU", "")).toBe("Virtual Account (DOKU)");
  });

  it("never lets a stray channel rename a manual payment", () => {
    expect(paymentMethodLabel("CASH", "VIRTUAL_ACCOUNT_BCA")).toBe("Tunai");
  });
});
