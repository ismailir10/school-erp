import { describe, expect, it } from "vitest";
import { parentPaymentMethodLabel } from "../parent-payment-method";

describe("parentPaymentMethodLabel", () => {
  it("maps every stored method to the label the parent app shows", () => {
    expect(parentPaymentMethodLabel("CASH")).toBe("Tunai");
    expect(parentPaymentMethodLabel("BANK_TRANSFER")).toBe("Transfer Bank");
    expect(parentPaymentMethodLabel("OTHER")).toBe("Lainnya");
  });

  it("collapses both gateways to 'Virtual Account' for a parent", () => {
    expect(parentPaymentMethodLabel("XENDIT")).toBe("Virtual Account");
    expect(parentPaymentMethodLabel("DOKU")).toBe("Virtual Account");
  });

  it("never leaks an unknown enum value", () => {
    expect(parentPaymentMethodLabel("CRYPTO")).toBe("Lainnya");
  });
});
