import { describe, it, expect } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { hasReceipt } from "../invoice-receipt";

describe("hasReceipt", () => {
  it.each(["PAID", "PARTIALLY_PAID", "OVERDUE", "SENT"])("%s with money paid has a receipt", (status) => {
    expect(hasReceipt({ status, totalPaid: 1 })).toBe(true);
    expect(hasReceipt({ status, totalPaid: new Prisma.Decimal(250_000) })).toBe(true);
  });

  it.each(["DRAFT", "SENT", "OVERDUE", "PENDING_PAYMENT_LINK"])("%s with nothing paid has none", (status) => {
    expect(hasReceipt({ status, totalPaid: 0 })).toBe(false);
    expect(hasReceipt({ status, totalPaid: new Prisma.Decimal(0) })).toBe(false);
  });

  it("a cancelled invoice never has one", () => {
    expect(hasReceipt({ status: "CANCELLED", totalPaid: 500_000 })).toBe(false);
  });
});
