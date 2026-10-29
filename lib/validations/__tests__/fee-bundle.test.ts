import { describe, expect, it } from "vitest";
import { MAX_FEE_AMOUNT } from "../fee-structure";
import { saveBundleFeesSchema } from "../fee-bundle";

const change = (over: Record<string, unknown> = {}) => ({
  schoolProgramId: "p-school",
  daycareProgramId: "p-day",
  feeComponentId: "fc-spp",
  amount: 1_560_000,
  ...over,
});
const parse = (changes: unknown[]) => saveBundleFeesSchema.safeParse({ academicYearId: "ay-1", changes });

describe("saveBundleFeesSchema", () => {
  it("accepts a price, a clear (null) and the fee maximum", () => {
    expect(parse([change(), change({ feeComponentId: "fc-2", amount: null }), change({ feeComponentId: "fc-3", amount: MAX_FEE_AMOUNT })]).success).toBe(true);
  });

  it("rejects zero, negative, fractional, over-max and non-numeric amounts with Indonesian copy", () => {
    const messages = (amount: unknown) => {
      const r = parse([change({ amount })]);
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(messages(0)).toContain("Harga paket harus lebih dari 0");
    expect(messages(-5)).toContain("Harga paket harus lebih dari 0");
    expect(messages(10.5)).toContain("Harga paket harus rupiah bulat");
    expect(messages(MAX_FEE_AMOUNT + 1)).toContain("Harga paket maksimal Rp 10.000.000.000");
    expect(messages("1000")).toContain("Harga paket harus berupa angka");
  });

  it("rejects a duplicate (school, daycare, component) triple but allows the same pair for another component", () => {
    const dup = parse([change(), change({ amount: 1 })]);
    expect(dup.success).toBe(false);
    if (!dup.success) expect(dup.error.issues[0]).toMatchObject({ path: ["changes", 1] });
    expect(parse([change(), change({ feeComponentId: "fc-2" })]).success).toBe(true);
  });

  it("caps a save at 200 changes", () => {
    expect(parse(Array.from({ length: 200 }, (_, i) => change({ feeComponentId: `fc-${i}` }))).success).toBe(true);
    expect(parse(Array.from({ length: 201 }, (_, i) => change({ feeComponentId: `fc-${i}` }))).success).toBe(false);
  });

  it("requires a year", () => {
    expect(saveBundleFeesSchema.safeParse({ changes: [] }).success).toBe(false);
  });
});
