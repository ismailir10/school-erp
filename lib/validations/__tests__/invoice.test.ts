import { describe, it, expect } from "vitest";
import {
  createManualInvoiceSchema,
  manualInvoiceFormSchema,
  PAYMENT_MODE_RETIRED_MESSAGE,
} from "@/lib/validations/invoice";

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

describe("createManualInvoiceSchema — retired payment mode", () => {
  const fieldsOf = (r: ReturnType<typeof createManualInvoiceSchema.safeParse>) =>
    r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

  it("refuses a body that carries `payment`, naming the key", () => {
    const payment = {
      idempotencyKey: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
      method: "CASH",
      paidAt: "2026-04-01",
    };
    expect(fieldsOf(createManualInvoiceSchema.safeParse({ ...baseValid, payment }))).toEqual([
      `payment: ${PAYMENT_MODE_RETIRED_MESSAGE}`,
    ]);
    expect(createManualInvoiceSchema.safeParse({ ...baseValid, payment: null }).success).toBe(false);
  });

  it("still accepts a body without `payment`", () => {
    expect(createManualInvoiceSchema.safeParse(baseValid).success).toBe(true);
  });
});

describe("manualInvoiceFormSchema", () => {
  it("carries no paid-mode fields", () => {
    const r = manualInvoiceFormSchema.safeParse({ ...baseValid, markPaid: true, method: "CASH" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(Object.keys(r.data).sort()).toEqual(["dueDate", "lines", "periodLabel", "studentId"]);
    }
  });
});
