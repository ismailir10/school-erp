import { describe, it, expect } from "vitest";
import { createManualInvoiceSchema } from "@/lib/validations/invoice";

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
