import { describe, it, expect } from "vitest";
import {
  createManualInvoiceSchema,
  manualInvoiceFormSchema,
  paymentFromForm,
} from "@/lib/validations/invoice";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

/**
 * Schema tests for createManualInvoiceSchema. The route layer relies on the
 * schema as its single source of truth for both shape AND duplicate-line
 * rejection — the upstream `Set` dedup at `app/api/invoices/route.ts:117`
 * was removed in T2b.
 */

const baseValid = {
  studentId: "s-1",
  periodLabel: "April 2026",
  dueDate: "2026-04-30",
  lines: [
    { feeComponentId: "fc-1", amount: 100_000 },
    { feeComponentId: "fc-2", amount: 50_000 },
  ],
};

describe("createManualInvoiceSchema", () => {
  it("accepts a valid manual-invoice payload", () => {
    const result = createManualInvoiceSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it("accepts a periodLabel of exactly 64 characters", () => {
    const result = createManualInvoiceSchema.safeParse({
      ...baseValid,
      periodLabel: "x".repeat(64),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a periodLabel longer than 64 characters with the Indonesian message", () => {
    const result = createManualInvoiceSchema.safeParse({
      ...baseValid,
      periodLabel: "x".repeat(65),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes("periodLabel"),
      );
      expect(issue?.message).toBe("Maksimal 64 karakter.");
    }
  });

  it("rejects duplicate feeComponentId in lines with the Indonesian message at path ['lines']", () => {
    const result = createManualInvoiceSchema.safeParse({
      ...baseValid,
      lines: [
        { feeComponentId: "fc-1", amount: 100_000 },
        { feeComponentId: "fc-1", amount: 50_000 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const dupIssue = result.error.issues.find(
        (i) => i.message === "Komponen biaya tidak boleh duplikat",
      );
      expect(dupIssue).toBeDefined();
      expect(dupIssue?.path).toEqual(["lines"]);
    }
  });

  it("accepts non-duplicate lines even when amounts repeat", () => {
    const result = createManualInvoiceSchema.safeParse({
      ...baseValid,
      lines: [
        { feeComponentId: "fc-1", amount: 50_000 },
        { feeComponentId: "fc-2", amount: 50_000 },
        { feeComponentId: "fc-3", amount: 50_000 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

const tomorrowYmd = () => {
  const d = new Date(`${getTodayInTimezone("Asia/Jakarta")}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

describe("createManualInvoiceSchema — optional payment", () => {
  const today = getTodayInTimezone("Asia/Jakarta");
  const KEY = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
  const withPayment = (over: Record<string, unknown> = {}) => ({
    ...baseValid,
    payment: { idempotencyKey: KEY, method: "BANK_TRANSFER", paidAt: today, ...over },
  });
  const fieldsOf = (r: ReturnType<typeof createManualInvoiceSchema.safeParse>) =>
    r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

  it("is optional, and accepts a full payment", () => {
    expect(createManualInvoiceSchema.safeParse(baseValid).success).toBe(true);
    const r = createManualInvoiceSchema.safeParse(withPayment({ reference: "TRF-1", notes: null }));
    expect(r.success).toBe(true);
  });

  it("refuses gateway rails and unknown methods with the manual-method message", () => {
    for (const method of ["DOKU", "XENDIT", "cash", undefined]) {
      expect(fieldsOf(createManualInvoiceSchema.safeParse(withPayment({ method })))).toEqual([
        "payment.method: Pilih Tunai, Transfer Bank, atau Lainnya.",
      ]);
    }
  });

  it("requires a real, non-future paidAt and a uuid key", () => {
    expect(fieldsOf(createManualInvoiceSchema.safeParse(withPayment({ paidAt: undefined })))).toHaveLength(1);
    expect(fieldsOf(createManualInvoiceSchema.safeParse(withPayment({ paidAt: tomorrowYmd() })))).toEqual([
      "payment.paidAt: Tanggal bayar tidak boleh di masa depan.",
    ]);
    expect(fieldsOf(createManualInvoiceSchema.safeParse(withPayment({ paidAt: "2026-02-30" })))).toEqual([
      "payment.paidAt: Tanggal bayar tidak valid",
    ]);
    expect(createManualInvoiceSchema.safeParse(withPayment({ idempotencyKey: "abc" })).success).toBe(false);
  });

  it("keeps the duplicate-component rule when a payment is present", () => {
    const r = createManualInvoiceSchema.safeParse({
      ...withPayment(),
      lines: [
        { feeComponentId: "fc-1", amount: 1 },
        { feeComponentId: "fc-1", amount: 2 },
      ],
    });
    expect(fieldsOf(r)).toEqual(["lines: Komponen biaya tidak boleh duplikat"]);
  });
});

describe("manualInvoiceFormSchema — Sudah dibayar fields", () => {
  const today = getTodayInTimezone("Asia/Jakarta");
  const KEY = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
  const form = (over: Record<string, unknown> = {}) => ({ ...baseValid, ...over });
  const fieldsOf = (r: ReturnType<typeof manualInvoiceFormSchema.safeParse>) =>
    r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

  it("defaults markPaid to false and ignores the payment fields while unticked", () => {
    const r = manualInvoiceFormSchema.safeParse(form());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.markPaid).toBe(false);
      expect(paymentFromForm(r.data, KEY)).toBeUndefined();
    }
    expect(manualInvoiceFormSchema.safeParse(form({ markPaid: false, method: "", paidAt: "" })).success).toBe(true);
  });

  it("requires method and paidAt once ticked", () => {
    expect(fieldsOf(manualInvoiceFormSchema.safeParse(form({ markPaid: true })))).toEqual([
      "method: Pilih metode pembayaran",
      "paidAt: Tanggal bayar wajib diisi",
    ]);
    expect(fieldsOf(manualInvoiceFormSchema.safeParse(form({ markPaid: true, method: "", paidAt: "" })))).toEqual([
      "method: Pilih metode pembayaran",
      "paidAt: Tanggal bayar wajib diisi",
    ]);
  });

  it("applies the API date rules to paidAt", () => {
    expect(fieldsOf(manualInvoiceFormSchema.safeParse(form({ markPaid: true, method: "CASH", paidAt: tomorrowYmd() })))).toEqual([
      "paidAt: Tanggal bayar tidak boleh di masa depan.",
    ]);
  });

  it("paymentFromForm builds an API payment that createManualInvoiceSchema accepts", () => {
    const r = manualInvoiceFormSchema.safeParse(
      form({ markPaid: true, method: "CASH", paidAt: today, reference: "  KW-9 ", notes: "   " }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    const payment = paymentFromForm(r.data, KEY);
    expect(payment).toEqual({ idempotencyKey: KEY, method: "CASH", paidAt: today, reference: "KW-9", notes: null });
    expect(
      createManualInvoiceSchema.safeParse({
        studentId: r.data.studentId,
        periodLabel: r.data.periodLabel,
        dueDate: r.data.dueDate,
        lines: r.data.lines,
        payment,
      }).success,
    ).toBe(true);
  });
});
