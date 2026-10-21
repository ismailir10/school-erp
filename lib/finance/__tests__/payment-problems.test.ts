import { describe, expect, it } from "vitest";
import { paymentProblemsFrom } from "../payment-problems";

const at = new Date("2026-10-21T03:00:00.000Z");
const xenditPayload = { data: { amount: 500000, payment_id: "pay-1" } };
const dokuPayload = { order: { amount: 250000 }, transaction: { original_request_id: "r-1" } };

describe("paymentProblemsFrom", () => {
  it("words a second payment on a paid invoice with gateway and amount", () => {
    const [p] = paymentProblemsFrom([
      { errorMessage: "DUPLICATE_PAYMENT_AFTER_PAID", payload: xenditPayload, provider: "xendit", createdAt: at },
    ]);
    expect(p.code).toBe("DUPLICATE_PAYMENT_AFTER_PAID");
    expect(p.createdAt).toBe(at);
    expect(p.message).toBe(
      "Ada pembayaran kedua di Xendit sebesar Rp 500.000 untuk tagihan yang sudah lunas. Pembayaran ini tidak dicatat — periksa di dashboard Xendit dan kembalikan dana bila perlu.",
    );
  });

  it("words a payment on a cancelled invoice (DOKU envelope)", () => {
    const [p] = paymentProblemsFrom([
      { errorMessage: "PAID_ON_CANCELLED_INVOICE", payload: dokuPayload, provider: "doku", createdAt: at },
    ]);
    expect(p.message).toBe(
      "Ada pembayaran di DOKU sebesar Rp 250.000 untuk tagihan yang sudah dibatalkan. Pembayaran ini tidak dicatat — periksa di dashboard DOKU dan kembalikan dana.",
    );
  });

  it("words an overpayment as already recorded", () => {
    const [p] = paymentProblemsFrom([
      { errorMessage: "OVERPAYMENT_FLAGGED", payload: xenditPayload, provider: "xendit", createdAt: at },
    ]);
    expect(p.message).toBe(
      "Pembayaran di Xendit sebesar Rp 500.000 melebihi sisa tagihan — sudah dicatat. Periksa dan kembalikan kelebihannya bila perlu.",
    );
  });

  it("omits the amount phrase when the payload has none", () => {
    const [p] = paymentProblemsFrom([
      { errorMessage: "PAID_ON_CANCELLED_INVOICE", payload: null, provider: "doku", createdAt: at },
    ]);
    expect(p.message).not.toContain("sebesar");
    expect(p.message).toContain("Ada pembayaran di DOKU untuk tagihan yang sudah dibatalkan.");
  });

  it("keeps one entry per event in the given order and skips other errors", () => {
    const later = new Date("2026-10-21T05:00:00.000Z");
    const out = paymentProblemsFrom([
      { errorMessage: "OVERPAYMENT_FLAGGED", payload: xenditPayload, provider: "xendit", createdAt: later },
      { errorMessage: "SIGNATURE_INVALID", payload: xenditPayload, provider: "xendit", createdAt: at },
      { errorMessage: null, payload: xenditPayload, provider: "xendit", createdAt: at },
      { errorMessage: "OVERPAYMENT_FLAGGED", payload: xenditPayload, provider: "xendit", createdAt: at },
    ]);
    expect(out.map((p) => p.createdAt)).toEqual([later, at]);
  });

  it("never leaks a raw code into the message", () => {
    const out = paymentProblemsFrom(
      ["DUPLICATE_PAYMENT_AFTER_PAID", "PAID_ON_CANCELLED_INVOICE", "OVERPAYMENT_FLAGGED"].map((c) => ({
        errorMessage: c, payload: xenditPayload, provider: "xendit", createdAt: at,
      })),
    );
    for (const p of out) expect(p.message).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
  });
});
