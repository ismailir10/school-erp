import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { webhookEvent: { findMany: vi.fn() } } }));

import { prisma } from "@/lib/db";
import { NEEDS_REVIEW_ERROR_CODES } from "@/lib/payments/needs-review";
import { needsReviewInvoiceIds } from "@/lib/payments/needs-review-invoices";

const findMany = vi.mocked(prisma.webhookEvent.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("needsReviewInvoiceIds", () => {
  it("asks for distinct, non-null invoice ids of ERROR events carrying a review code", async () => {
    findMany.mockResolvedValue([] as never);
    await needsReviewInvoiceIds();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "ERROR",
        errorMessage: { in: [...NEEDS_REVIEW_ERROR_CODES] },
        invoiceId: { not: null },
      },
      select: { invoiceId: true },
      distinct: ["invoiceId"],
    });
  });

  it("covers exactly the three review codes", () => {
    expect([...NEEDS_REVIEW_ERROR_CODES].sort()).toEqual([
      "DUPLICATE_PAYMENT_AFTER_PAID",
      "OVERPAYMENT_FLAGGED",
      "PAID_ON_CANCELLED_INVOICE",
    ]);
  });

  it("returns the ids as a flat string list and drops null ids", async () => {
    findMany.mockResolvedValue([{ invoiceId: "inv-a" }, { invoiceId: null }, { invoiceId: "inv-b" }] as never);
    expect(await needsReviewInvoiceIds()).toEqual(["inv-a", "inv-b"]);
  });

  it("returns an empty list when nothing is flagged", async () => {
    findMany.mockResolvedValue([] as never);
    expect(await needsReviewInvoiceIds()).toEqual([]);
  });

  it("uses the client it is given", async () => {
    const own = { webhookEvent: { findMany: vi.fn().mockResolvedValue([{ invoiceId: "x" }]) } };
    expect(await needsReviewInvoiceIds(own as never)).toEqual(["x"]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
