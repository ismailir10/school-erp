import { describe, it, expect } from "vitest";
import { academicYearBillingWindow, rangeInsideWindow } from "../window";
import { leaveEligibility } from "../eligibility";

const ym = (year: number, month: number) => ({ year, month });

describe("academicYearBillingWindow", () => {
  it("a Juli-Juni year spans its twelve months", () => {
    expect(academicYearBillingWindow({ startDate: "2026-07-13", endDate: "2027-06-30" })).toEqual({
      from: ym(2026, 7),
      to: ym(2027, 6),
    });
  });

  it("caps a 13-calendar-month year at start + 11 (13 Juli to 11 Juli)", () => {
    expect(academicYearBillingWindow({ startDate: "2026-07-13", endDate: "2027-07-11" })).toEqual({
      from: ym(2026, 7),
      to: ym(2027, 6),
    });
  });

  it("keeps a short year's own end", () => {
    expect(academicYearBillingWindow({ startDate: "2026-07-01", endDate: "2026-12-20" })).toEqual({
      from: ym(2026, 7),
      to: ym(2026, 12),
    });
  });

  it("a one-month year is a one-month window", () => {
    expect(academicYearBillingWindow({ startDate: "2026-07-01", endDate: "2026-07-31" })).toEqual({
      from: ym(2026, 7),
      to: ym(2026, 7),
    });
  });

  it("returns null for an end before the start or unparsable dates", () => {
    expect(academicYearBillingWindow({ startDate: "2026-07-01", endDate: "2026-06-30" })).toBeNull();
    expect(academicYearBillingWindow({ startDate: "", endDate: "2027-06-30" })).toBeNull();
    expect(academicYearBillingWindow({ startDate: "2026-07-01", endDate: "garbage" })).toBeNull();
  });
});

describe("rangeInsideWindow", () => {
  const window = { from: ym(2026, 7), to: ym(2027, 6) };
  it("accepts ranges touching both window edges", () => {
    expect(rangeInsideWindow({ start: ym(2026, 7), end: ym(2027, 6) }, window)).toBe(true);
  });
  it("rejects a start before the window or an end after it", () => {
    expect(rangeInsideWindow({ start: ym(2026, 6), end: ym(2026, 8) }, window)).toBe(false);
    expect(rangeInsideWindow({ start: ym(2027, 5), end: ym(2027, 7) }, window)).toBe(false);
  });
});

describe("leaveEligibility", () => {
  const base = {
    enrollmentStatus: "ACTIVE",
    studentStatus: "ACTIVE",
    yearStatus: "ACTIVE",
    year: { startDate: "2026-07-13", endDate: "2027-06-30" },
  };

  it("is eligible with the billing window as YYYY-MM", () => {
    expect(leaveEligibility(base)).toEqual({
      eligible: true,
      ineligibleReason: null,
      window: { from: "2026-07", to: "2027-06" },
    });
  });

  it("a PLANNING year is eligible (writable)", () => {
    expect(leaveEligibility({ ...base, yearStatus: "PLANNING" }).eligible).toBe(true);
  });

  it.each([
    ["enrollmentStatus", "WITHDRAWN"],
    ["studentStatus", "WITHDRAWN"],
    ["yearStatus", "ARCHIVED"],
  ])("is not eligible when %s is %s", (key, value) => {
    const result = leaveEligibility({ ...base, [key]: value });
    expect(result.eligible).toBe(false);
    expect(result.ineligibleReason).toEqual(expect.any(String));
    // The window is still reported so the UI can show it.
    expect(result.window).toEqual({ from: "2026-07", to: "2027-06" });
  });

  it("is not eligible when the year has no usable dates", () => {
    const result = leaveEligibility({ ...base, year: { startDate: "2026-07-01", endDate: "2026-01-01" } });
    expect(result).toMatchObject({ eligible: false, window: null });
  });
});
