import { describe, expect, it } from "vitest";
import {
  cancelBillingRunSchema,
  commitBillingRunSchema,
  createBillingRunLineSchema,
  createBillingRunSchema,
  rebuildBillingRunSchema,
  updateBillingRunLineSchema,
  updateBillingRunRowSchema,
} from "../billing-run";

const validCreate = {
  periodLabel: "April 2026",
  dueDate: "2026-04-10",
  academicYearId: "year-1",
  classSectionIds: ["class-1"],
  includeStudentIds: [],
  excludeStudentIds: [],
};

describe("createBillingRunSchema", () => {
  it("accepts a valid payload scoped by class", () => {
    const r = createBillingRunSchema.safeParse(validCreate);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.classSectionIds).toEqual(["class-1"]);
    }
  });

  it("accepts a valid payload scoped only by includeStudentIds", () => {
    const r = createBillingRunSchema.safeParse({
      ...validCreate,
      classSectionIds: [],
      includeStudentIds: ["student-1"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty scope (no classSectionIds and no includeStudentIds)", () => {
    const r = createBillingRunSchema.safeParse({
      ...validCreate,
      classSectionIds: [],
      includeStudentIds: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing periodLabel", () => {
    const r = createBillingRunSchema.safeParse({ ...validCreate, periodLabel: "" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing academicYearId", () => {
    const r = createBillingRunSchema.safeParse({ ...validCreate, academicYearId: "" });
    expect(r.success).toBe(false);
  });

  it.each(["2026/04/10", "10-04-2026", "2026-4-10", "not-a-date"])(
    "rejects a malformed dueDate %s",
    (dueDate) => {
      const r = createBillingRunSchema.safeParse({ ...validCreate, dueDate });
      expect(r.success).toBe(false);
    }
  );

  it("accepts a payload omitting the optional array fields (defaults to [])", () => {
    const r = createBillingRunSchema.safeParse({
      periodLabel: "April 2026",
      dueDate: "2026-04-10",
      academicYearId: "year-1",
      classSectionIds: ["class-1"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.includeStudentIds).toEqual([]);
      expect(r.data.excludeStudentIds).toEqual([]);
    }
  });
});

describe("updateBillingRunRowSchema", () => {
  it("accepts PENDING", () => {
    const r = updateBillingRunRowSchema.safeParse({ status: "PENDING" });
    expect(r.success).toBe(true);
  });

  it("accepts EXCLUDED", () => {
    const r = updateBillingRunRowSchema.safeParse({ status: "EXCLUDED" });
    expect(r.success).toBe(true);
  });

  it.each(["SKIPPED_ALREADY_INVOICED", "SKIPPED_NO_FEE_STRUCTURE", "COMMITTED", "FAILED", "BOGUS"])(
    "rejects a status not permitted this cycle: %s",
    (status) => {
      const r = updateBillingRunRowSchema.safeParse({ status });
      expect(r.success).toBe(false);
    }
  );

  it("rejects a missing status", () => {
    const r = updateBillingRunRowSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("commitBillingRunSchema", () => {
  it("accepts a single row id", () => {
    const r = commitBillingRunSchema.safeParse({ rowIds: ["row-1"] });
    expect(r.success).toBe(true);
  });

  it("accepts exactly 25 row ids (cap boundary)", () => {
    const rowIds = Array.from({ length: 25 }, (_, i) => `row-${i}`);
    const r = commitBillingRunSchema.safeParse({ rowIds });
    expect(r.success).toBe(true);
  });

  it("rejects 26 row ids (over the cap)", () => {
    const rowIds = Array.from({ length: 26 }, (_, i) => `row-${i}`);
    const r = commitBillingRunSchema.safeParse({ rowIds });
    expect(r.success).toBe(false);
  });

  it("rejects an empty rowIds array", () => {
    const r = commitBillingRunSchema.safeParse({ rowIds: [] });
    expect(r.success).toBe(false);
  });

  it("rejects a missing rowIds field", () => {
    const r = commitBillingRunSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("cancelBillingRunSchema", () => {
  it("accepts status CANCELLED", () => {
    const r = cancelBillingRunSchema.safeParse({ status: "CANCELLED" });
    expect(r.success).toBe(true);
  });

  it("rejects any other status literal", () => {
    const r = cancelBillingRunSchema.safeParse({ status: "DRAFT" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing status", () => {
    const r = cancelBillingRunSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("createBillingRunLineSchema", () => {
  const validCatalog = {
    mode: "CATALOG" as const,
    feeComponentId: "comp-1",
    label: "Uang Gedung",
    amount: 500_000,
  };

  it("accepts a valid CATALOG line", () => {
    const r = createBillingRunLineSchema.safeParse(validCatalog);
    expect(r.success).toBe(true);
  });

  it("rejects a CATALOG line without feeComponentId", () => {
    const r = createBillingRunLineSchema.safeParse({
      mode: "CATALOG",
      label: "Uang Gedung",
      amount: 500_000,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid DISCOUNT line with no feeComponentId", () => {
    const r = createBillingRunLineSchema.safeParse({
      mode: "DISCOUNT",
      label: "Potongan yatim",
      amount: 50_000,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a DISCOUNT line that supplies a feeComponentId", () => {
    const r = createBillingRunLineSchema.safeParse({
      mode: "DISCOUNT",
      feeComponentId: "comp-1",
      label: "Potongan yatim",
      amount: 50_000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative amount on a DISCOUNT line (amount is always a positive magnitude)", () => {
    const r = createBillingRunLineSchema.safeParse({
      mode: "DISCOUNT",
      label: "Potongan yatim",
      amount: -50_000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a negative amount on a CATALOG line", () => {
    const r = createBillingRunLineSchema.safeParse({ ...validCatalog, amount: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    const r = createBillingRunLineSchema.safeParse({ ...validCatalog, amount: 500_000.5 });
    expect(r.success).toBe(false);
  });

  it("rejects an empty label", () => {
    const r = createBillingRunLineSchema.safeParse({ ...validCatalog, label: "" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing mode", () => {
    const r = createBillingRunLineSchema.safeParse({
      label: "Uang Gedung",
      amount: 500_000,
    });
    expect(r.success).toBe(false);
  });
});

describe("updateBillingRunLineSchema", () => {
  it("accepts a valid payload with a positive finalAmount", () => {
    const r = updateBillingRunLineSchema.safeParse({ finalAmount: 400_000 });
    expect(r.success).toBe(true);
  });

  it("accepts a negative finalAmount (e.g. a MANUAL discount line)", () => {
    const r = updateBillingRunLineSchema.safeParse({ finalAmount: -50_000 });
    expect(r.success).toBe(true);
  });

  it("rejects a non-integer finalAmount", () => {
    const r = updateBillingRunLineSchema.safeParse({ finalAmount: 400_000.25 });
    expect(r.success).toBe(false);
  });

  it("accepts the Rp 10 miliar ceiling and rejects anything above it (FINX-2)", () => {
    expect(updateBillingRunLineSchema.safeParse({ finalAmount: 10_000_000_000 }).success).toBe(true);
    const over = updateBillingRunLineSchema.safeParse({ finalAmount: 10_000_000_001 });
    expect(over.success).toBe(false);
    if (!over.success) expect(over.error.issues[0].message).toBe("Nominal maksimal Rp 10.000.000.000");
    expect(updateBillingRunLineSchema.safeParse({ finalAmount: 99_999_999_999_999 }).success).toBe(false);
    expect(updateBillingRunLineSchema.safeParse({ finalAmount: -10_000_000_001 }).success).toBe(false);
  });

  it("rejects a missing finalAmount", () => {
    const r = updateBillingRunLineSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts note: null so a note can be cleared", () => {
    const r = updateBillingRunLineSchema.safeParse({ finalAmount: 400_000, note: null });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.note).toBeNull();
    }
  });

  it("accepts a payload omitting note entirely", () => {
    const r = updateBillingRunLineSchema.safeParse({ finalAmount: 400_000 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.note).toBeUndefined();
    }
  });

  it("accepts an optional label", () => {
    const r = updateBillingRunLineSchema.safeParse({ finalAmount: 400_000, label: "Uang SPP" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty label when supplied", () => {
    const r = updateBillingRunLineSchema.safeParse({ finalAmount: 400_000, label: "" });
    expect(r.success).toBe(false);
  });
});

describe("rebuildBillingRunSchema", () => {
  it("accepts confirm: true", () => {
    const r = rebuildBillingRunSchema.safeParse({ confirm: true });
    expect(r.success).toBe(true);
  });

  it("rejects confirm: false", () => {
    const r = rebuildBillingRunSchema.safeParse({ confirm: false });
    expect(r.success).toBe(false);
  });

  it("rejects an empty POST body (no confirm field)", () => {
    const r = rebuildBillingRunSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});
