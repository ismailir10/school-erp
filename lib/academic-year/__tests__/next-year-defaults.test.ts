import { describe, expect, it } from "vitest";
import { nextAcademicYearDefaults } from "../next-year-defaults";

const y = (name: string, startDate: string, endDate: string, status = "ACTIVE") => ({ name, startDate, endDate, status });

describe("nextAcademicYearDefaults (R2-ADMIN-15)", () => {
  it("continues the latest non-archived year: next label, day after its end, one year less a day", () => {
    expect(
      nextAcademicYearDefaults([
        y("2025/2026", "2025-07-14", "2026-07-10", "ARCHIVED"),
        y("2026/2027", "2026-07-13", "2027-07-09"),
        y("2027/2028", "2027-07-12", "2028-07-09", "PLANNING"),
      ]),
    ).toEqual({ name: "2028/2029", startDate: "2028-07-10", endDate: "2029-07-09" });
  });

  it("ignores archived years when picking the latest", () => {
    expect(
      nextAcademicYearDefaults([y("2030/2031", "2030-07-01", "2031-06-30", "ARCHIVED"), y("2026/2027", "2026-07-13", "2027-07-09")]),
    ).toEqual({ name: "2027/2028", startDate: "2027-07-10", endDate: "2028-07-09" });
  });

  it("falls back to a label derived from the start date when the name has no YYYY/YYYY shape", () => {
    expect(nextAcademicYearDefaults([y("TA Baru", "2026-07-01", "2027-06-30")])).toEqual({
      name: "2027/2028",
      startDate: "2027-07-01",
      endDate: "2028-06-30",
    });
  });

  it("returns null when there is no non-archived year", () => {
    expect(nextAcademicYearDefaults([])).toBeNull();
    expect(nextAcademicYearDefaults([y("2025/2026", "2025-07-14", "2026-07-10", "ARCHIVED")])).toBeNull();
  });

  it("handles a leap-day boundary", () => {
    expect(nextAcademicYearDefaults([y("2027/2028", "2027-03-01", "2028-02-28")])?.startDate).toBe("2028-02-29");
  });
});
