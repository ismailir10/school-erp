import { describe, it, expect } from "vitest";
import { priorMonthLabel, hasSlipInMonth, periodMonthLabel, formatPeriodRange, slipBanner } from "../helpers";

describe("priorMonthLabel", () => {
  it("returns April 2026 when today is May 2026", () => {
    const result = priorMonthLabel(new Date(2026, 4, 3)); // month index 4 = May
    expect(result.year).toBe(2026);
    expect(result.month).toBe(4);
    expect(result.label).toBe("April 2026");
  });

  it("handles year rollback: returns Desember 2025 when today is January 2026", () => {
    const result = priorMonthLabel(new Date(2026, 0, 15)); // month index 0 = January
    expect(result.year).toBe(2025);
    expect(result.month).toBe(12);
    expect(result.label).toBe("Desember 2025");
  });
});

describe("hasSlipInMonth", () => {
  it("returns true when a slip's periodStart matches the given year and month", () => {
    const slips = [
      { payrollRun: { periodStart: "2026-04-01", periodEnd: "2026-04-30", status: "APPROVED" } },
    ];
    expect(hasSlipInMonth(slips, 2026, 4)).toBe(true);
  });

  it("returns false when no slip matches the given year and month", () => {
    const slips = [
      { payrollRun: { periodStart: "2026-03-01", periodEnd: "2026-03-31", status: "APPROVED" } },
    ];
    expect(hasSlipInMonth(slips, 2026, 4)).toBe(false);
  });

  it("returns false when the slip list is empty", () => {
    expect(hasSlipInMonth([], 2026, 4)).toBe(false);
  });

  it("handles ISO strings with timezone offset correctly (date-only parsing)", () => {
    const slips = [
      {
        payrollRun: {
          periodStart: "2026-04-01T00:00:00.000Z",
          periodEnd: "2026-04-30T00:00:00.000Z",
          status: "APPROVED",
        },
      },
    ];
    expect(hasSlipInMonth(slips, 2026, 4)).toBe(true);
  });

  it("does not false-positive on same month but different year", () => {
    const slips = [
      { payrollRun: { periodStart: "2025-04-01", periodEnd: "2025-04-30", status: "APPROVED" } },
    ];
    expect(hasSlipInMonth(slips, 2026, 4)).toBe(false);
  });
});

describe("hasSlipInMonth, end-month rule", () => {
  const augToSep = [{ payrollRun: { periodStart: "2026-08-21", periodEnd: "2026-09-20" } }];

  it("counts a 21 Aug – 20 Sep cycle as September, not August", () => {
    expect(hasSlipInMonth(augToSep, 2026, 9)).toBe(true);
    expect(hasSlipInMonth(augToSep, 2026, 8)).toBe(false);
  });
});

describe("periodMonthLabel / formatPeriodRange", () => {
  it("names the period by its end month", () => {
    expect(periodMonthLabel("2026-09-20")).toBe("September 2026");
    expect(periodMonthLabel("2026-09-20T00:00:00.000Z")).toBe("September 2026");
  });

  it("prints a long-form range with the year once", () => {
    expect(formatPeriodRange("2026-08-21", "2026-09-20")).toBe("21 Agustus – 20 September 2026");
  });

  it("keeps both years when the cycle crosses a year boundary", () => {
    expect(formatPeriodRange("2026-12-21", "2027-01-20")).toBe("21 Desember 2026 – 20 Januari 2027");
  });
});

describe("slipBanner (Asia/Jakarta)", () => {
  const augToSep = [{ payrollRun: { periodStart: "2026-08-21", periodEnd: "2026-09-20" } }];

  it("returns null when last month's slip exists, even on 7 Oct", () => {
    expect(slipBanner(augToSep, new Date("2026-10-07T03:00:00Z"))).toBeNull();
  });

  it("promises the 5th while it is still ahead (or today)", () => {
    const b = slipBanner([], new Date("2026-10-03T03:00:00Z"));
    expect(b?.kind).toBe("upcoming");
    expect(b?.title).toBe("Slip September 2026 akan tersedia setelah tanggal 5");
    expect(slipBanner([], new Date("2026-10-05T16:00:00Z"))?.kind).toBe("upcoming"); // 5 Oct 23:00 WIB
  });

  it("stops promising once the 5th has passed with no slip", () => {
    const b = slipBanner([], new Date("2026-10-07T03:00:00Z"));
    expect(b?.kind).toBe("overdue");
    expect(b?.title).toBe("Slip September 2026 belum diterbitkan admin");
    expect(b?.description).toBe("Hubungi admin bila perlu.");
    expect(b?.title).not.toMatch(/tanggal 5/);
  });

  it("uses the Jakarta day, not the UTC day, at the month boundary", () => {
    // 30 Sep 18:00 UTC is already 1 Oct in Jakarta -> prior month is September, still upcoming.
    const b = slipBanner([], new Date("2026-09-30T18:00:00Z"));
    expect(b?.kind).toBe("upcoming");
    expect(b?.title).toContain("September 2026");
    // 5 Oct 17:30 UTC is 6 Oct in Jakarta -> overdue.
    expect(slipBanner([], new Date("2026-10-05T17:30:00Z"))?.kind).toBe("overdue");
  });

  it("rolls the prior month back across the year", () => {
    expect(slipBanner([], new Date("2027-01-08T03:00:00Z"))?.title).toBe("Slip Desember 2026 belum diterbitkan admin");
  });
});
