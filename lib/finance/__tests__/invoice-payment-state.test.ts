import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  ACTIVE_PAYMENT_FILTER,
  deriveInvoicePaymentState,
  recomputeInvoiceFromPayments,
  unpaidStatusFor,
} from "../invoice-payment-state";

const D = (v: number) => new Prisma.Decimal(v);
const base = {
  status: "SENT",
  totalDue: D(1_000_000),
  dueDate: "2026-09-30",
  sentAt: new Date("2026-09-01"),
  xenditPaymentUrl: "https://pay.example/x",
  paymentLinkError: null,
};

describe("deriveInvoicePaymentState", () => {
  it("full payment -> PAID with a paidAt", () => {
    const r = deriveInvoicePaymentState(base, D(1_000_000), "2026-09-15");
    expect(r.status).toBe("PAID");
    expect(r.paidAt).toBeInstanceOf(Date);
  });

  it("partial payment -> PARTIALLY_PAID, no paidAt", () => {
    const r = deriveInvoicePaymentState(base, D(250_000), "2026-09-15");
    expect(r).toEqual({ status: "PARTIALLY_PAID", paidAt: null });
  });

  it("partial payment past the due date -> OVERDUE, paid amount untouched, no paidAt", () => {
    expect(deriveInvoicePaymentState(base, D(250_000), "2026-10-01")).toEqual({ status: "OVERDUE", paidAt: null });
  });

  it("a partly paid OVERDUE invoice stays OVERDUE when more is paid but not all", () => {
    expect(deriveInvoicePaymentState({ ...base, status: "OVERDUE" }, D(600_000), "2026-10-05").status).toBe("OVERDUE");
  });

  it("partial payment on the due day itself is still PARTIALLY_PAID (due today is not late)", () => {
    expect(deriveInvoicePaymentState(base, D(250_000), "2026-09-30").status).toBe("PARTIALLY_PAID");
  });

  it("full payment past the due date -> PAID, not OVERDUE", () => {
    expect(deriveInvoicePaymentState({ ...base, status: "OVERDUE" }, D(1_000_000), "2026-10-05").status).toBe("PAID");
  });

  it("reversal of one of two payments on a PAID invoice past due -> OVERDUE", () => {
    expect(deriveInvoicePaymentState({ ...base, status: "PAID" }, D(400_000), "2026-10-05").status).toBe("OVERDUE");
  });

  it("nothing paid on an untouched invoice keeps its status (record path parity)", () => {
    expect(deriveInvoicePaymentState({ ...base, status: "OVERDUE" }, D(0), "2026-10-15").status).toBe("OVERDUE");
  });

  it("reversal of the only payment on a PAID invoice returns it to SENT", () => {
    const r = deriveInvoicePaymentState({ ...base, status: "PAID" }, D(0), "2026-09-15");
    expect(r).toEqual({ status: "SENT", paidAt: null });
  });

  it("reversal past the due date returns it to OVERDUE, not SENT", () => {
    expect(deriveInvoicePaymentState({ ...base, status: "PARTIALLY_PAID" }, D(0), "2026-10-05").status).toBe("OVERDUE");
  });

  it("reversal of one of two payments on a PAID invoice -> PARTIALLY_PAID", () => {
    expect(deriveInvoicePaymentState({ ...base, status: "PAID" }, D(400_000), "2026-09-15").status).toBe("PARTIALLY_PAID");
  });

  it("a zero-total invoice is never flipped to PAID by a zero sum", () => {
    expect(
      deriveInvoicePaymentState({ ...base, status: "SENT", totalDue: D(0) }, D(0), "2026-09-15").status,
    ).toBe("SENT");
  });
});

describe("unpaidStatusFor", () => {
  it("never sent, no link -> DRAFT; link error -> PENDING_PAYMENT_LINK", () => {
    const draft = { dueDate: "2026-09-30", sentAt: null, xenditPaymentUrl: null, paymentLinkError: null };
    expect(unpaidStatusFor(draft, "2026-09-15")).toBe("DRAFT");
    expect(unpaidStatusFor({ ...draft, paymentLinkError: "5xx: down" }, "2026-09-15")).toBe("PENDING_PAYMENT_LINK");
  });
});

describe("recomputeInvoiceFromPayments", () => {
  it("sums only non-REVERSED payments and writes totalPaid + status", async () => {
    const findMany = vi.fn().mockResolvedValue([{ amount: D(300_000) }, { amount: D(200_000) }]);
    const update = vi.fn();
    const tx = { payment: { findMany }, invoice: { update } } as never;
    const out = await recomputeInvoiceFromPayments(tx, { ...base, id: "inv-1" }, "2026-09-15");
    expect(findMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1", ...ACTIVE_PAYMENT_FILTER },
      select: { amount: true },
    });
    expect(ACTIVE_PAYMENT_FILTER).toEqual({ status: { not: "REVERSED" } });
    expect(out.totalPaid.toString()).toBe("500000");
    expect(update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { totalPaid: expect.anything(), status: "PARTIALLY_PAID", paidAt: null },
    });
  });
});

describe("paidAt is the settlement date, not the last recompute", () => {
  const SETTLED = new Date("2026-09-05T03:00:00.000Z");

  it("a PAID invoice that stays PAID keeps its original paidAt", () => {
    const r = deriveInvoicePaymentState({ ...base, status: "PAID", paidAt: SETTLED }, D(1_000_000), "2026-09-15");
    expect(r).toEqual({ status: "PAID", paidAt: SETTLED });
  });

  it("a PAID invoice with no stored paidAt falls back to now", () => {
    const r = deriveInvoicePaymentState({ ...base, status: "PAID", paidAt: null }, D(1_000_000), "2026-09-15");
    expect(r.paidAt).toBeInstanceOf(Date);
  });

  it("an invoice crossing into PAID gets a fresh paidAt, never a stale one", () => {
    const r = deriveInvoicePaymentState({ ...base, status: "PARTIALLY_PAID", paidAt: SETTLED }, D(1_000_000), "2026-09-20");
    expect(r.status).toBe("PAID");
    expect(r.paidAt).not.toBe(SETTLED);
  });

  it("reversing a manual payment on an overpaid invoice that stays covered keeps paidAt", async () => {
    const findMany = vi.fn().mockResolvedValue([{ amount: D(1_100_000) }]); // gateway overpayment remains
    const update = vi.fn();
    const tx = { payment: { findMany }, invoice: { update } } as never;
    await recomputeInvoiceFromPayments(tx, { ...base, status: "PAID", paidAt: SETTLED, id: "inv-1" }, "2026-09-15");
    expect(update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { totalPaid: expect.anything(), status: "PAID", paidAt: SETTLED },
    });
  });
});
