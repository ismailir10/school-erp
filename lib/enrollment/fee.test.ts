import { describe, it, expect } from "vitest";
import {
  applyDiscount,
  clampPercent,
  computeEnrollmentFee,
  initialFeeStatus,
  isDayCareProgram,
  toRupiah,
  type FeeProgram,
} from "./fee";

const KB: FeeProgram = { id: "kb", code: "KB", enrollmentFee: 300_000 };
const TK: FeeProgram = { id: "tk", code: "TKIT", enrollmentFee: 300_000 };
const DC: FeeProgram = { id: "dc", code: "DCARE", enrollmentFee: 375_000 };
const FREE: FeeProgram = { id: "popup", code: "POPUP", enrollmentFee: 0 };
const programs = [KB, TK, DC, FREE];

describe("isDayCareProgram", () => {
  it("matches DCARE case-insensitively and trims", () => {
    expect(isDayCareProgram("DCARE")).toBe(true);
    expect(isDayCareProgram(" dcare ")).toBe(true);
    expect(isDayCareProgram("KB")).toBe(false);
    expect(isDayCareProgram(null)).toBe(false);
  });
});

describe("toRupiah / clampPercent", () => {
  it("floors garbage to 0 and rounds to whole rupiah", () => {
    expect(toRupiah(-5)).toBe(0);
    expect(toRupiah(NaN)).toBe(0);
    expect(toRupiah(undefined)).toBe(0);
    expect(toRupiah("300000.00")).toBe(300_000);
    expect(toRupiah(100.6)).toBe(101);
  });
  it("clamps percent to 0-100 integers", () => {
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(33.4)).toBe(33);
    expect(clampPercent("abc")).toBe(0);
  });
});

describe("computeEnrollmentFee", () => {
  it("charges the chosen program's fee", () => {
    const f = computeEnrollmentFee({ programs, programId: "kb", dcareAddon: false });
    expect(f).toMatchObject({ programFee: 300_000, dcareAddonFee: 0, baseAmount: 300_000, discountPercent: 0, discountAmount: 0, amount: 300_000 });
  });

  it("charges Day Care's own fee when Day Care is the chosen program", () => {
    expect(computeEnrollmentFee({ programs, programId: "dc", dcareAddon: false }).amount).toBe(375_000);
  });

  it("adds the Day Care fee for a school program with the add-on (assumption A1: pay both)", () => {
    const f = computeEnrollmentFee({ programs, programId: "tk", dcareAddon: true });
    expect(f).toMatchObject({ programFee: 300_000, dcareAddonFee: 375_000, baseAmount: 675_000, amount: 675_000 });
  });

  it("does not double-charge when the chosen program is itself Day Care and the add-on is ticked", () => {
    const f = computeEnrollmentFee({ programs, programId: "dc", dcareAddon: true });
    expect(f).toMatchObject({ dcareAddonFee: 0, baseAmount: 375_000 });
  });

  it("adds 0 for the add-on when the school has no Day Care program", () => {
    const f = computeEnrollmentFee({ programs: [KB], programId: "kb", dcareAddon: true });
    expect(f.baseAmount).toBe(300_000);
  });

  it("is a zero fee for an unknown or empty program, never a throw", () => {
    expect(computeEnrollmentFee({ programs, programId: "nope", dcareAddon: true }).amount).toBe(0);
    expect(computeEnrollmentFee({ programs, programId: "", dcareAddon: true }).amount).toBe(0);
    expect(computeEnrollmentFee({ programs, programId: null, dcareAddon: false }).amount).toBe(0);
  });

  it("applies a percent discount to the base, rounded to whole rupiah", () => {
    const f = computeEnrollmentFee({ programs, programId: "kb", dcareAddon: false, discountPercent: 20 });
    expect(f).toMatchObject({ discountPercent: 20, discountAmount: 60_000, amount: 240_000 });
    const odd = computeEnrollmentFee({ programs: [{ ...KB, enrollmentFee: 333_333 }], programId: "kb", dcareAddon: false, discountPercent: 75 });
    expect(odd.discountAmount + odd.amount).toBe(333_333);
    expect(Number.isInteger(odd.amount)).toBe(true);
  });

  it("a 100 percent discount leaves a zero amount over a non-zero base", () => {
    const f = computeEnrollmentFee({ programs, programId: "kb", dcareAddon: false, discountPercent: 100 });
    expect(f).toMatchObject({ baseAmount: 300_000, amount: 0 });
  });

  it("ignores out-of-range discount input", () => {
    expect(computeEnrollmentFee({ programs, programId: "kb", dcareAddon: false, discountPercent: 250 }).amount).toBe(0);
    expect(computeEnrollmentFee({ programs, programId: "kb", dcareAddon: false, discountPercent: -20 }).amount).toBe(300_000);
  });
});

describe("applyDiscount", () => {
  it("re-derives amount from a snapshotted base", () => {
    expect(applyDiscount(675_000, 50)).toEqual({ discountPercent: 50, discountAmount: 337_500, amount: 337_500 });
    expect(applyDiscount(300_000, 0)).toEqual({ discountPercent: 0, discountAmount: 0, amount: 300_000 });
  });
});

describe("initialFeeStatus", () => {
  it("NONE when there is nothing to charge", () => {
    expect(initialFeeStatus({ baseAmount: 0, amount: 0 })).toBe("NONE");
  });
  it("UNPAID when an amount is owed", () => {
    expect(initialFeeStatus({ baseAmount: 300_000, amount: 240_000 })).toBe("UNPAID");
  });
  it("WAIVED when a non-zero base is discounted to zero", () => {
    expect(initialFeeStatus({ baseAmount: 300_000, amount: 0 })).toBe("WAIVED");
  });
});
