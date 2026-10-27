import { describe, it, expect } from "vitest";
import { defaultDueDateForPeriod, lastDayOfMonth, normalizePeriodLabel, parsePeriodMonth } from "../period-label";

describe("normalizePeriodLabel", () => {
  it.each([
    ["Jan 2026", "januari 2026"],
    ["Januari 2026", "januari 2026"],
    ["feb 2026", "februari 2026"],
    ["Februari 2026", "februari 2026"],
    ["Mar 2026", "maret 2026"],
    ["Maret 2026", "maret 2026"],
    ["Apr 2026", "april 2026"],
    ["April 2026", "april 2026"],
    ["Mei 2026", "mei 2026"],
    ["Jun 2026", "juni 2026"],
    ["Juni 2026", "juni 2026"],
    ["Jul 2026", "juli 2026"],
    ["Juli 2026", "juli 2026"],
    ["Agu 2026", "agustus 2026"],
    ["Agt 2026", "agustus 2026"],
    ["Ags 2026", "agustus 2026"],
    ["Agustus 2026", "agustus 2026"],
    ["Sep 2026", "september 2026"],
    ["Sept 2026", "september 2026"],
    ["September 2026", "september 2026"],
    ["Okt 2026", "oktober 2026"],
    ["Oktober 2026", "oktober 2026"],
    ["Nov 2026", "november 2026"],
    ["Nop 2026", "november 2026"],
    ["November 2026", "november 2026"],
    ["Des 2026", "desember 2026"],
    ["Desember 2026", "desember 2026"],
  ])("maps %s to %s", (input, expected) => {
    expect(normalizePeriodLabel(input)).toBe(expected);
  });

  it("ignores case, outer whitespace and repeated inner whitespace", () => {
    expect(normalizePeriodLabel("  OKTOBER    2026 \n")).toBe("oktober 2026");
    expect(normalizePeriodLabel("oktober 2026")).toBe(normalizePeriodLabel("Okt 2026"));
    expect(normalizePeriodLabel("Okt. 2026")).toBe("oktober 2026");
  });

  it("keeps the year, so the same month of another year stays distinct", () => {
    expect(normalizePeriodLabel("Okt 2025")).not.toBe(normalizePeriodLabel("Okt 2026"));
  });

  it("returns the lower-cased, collapsed text when no month is recognised", () => {
    expect(normalizePeriodLabel("Semester  1 2025/2026")).toBe("semester 1 2025/2026");
    expect(normalizePeriodLabel("  Uang Pangkal ")).toBe("uang pangkal");
  });

  it("never rewrites an abbreviation that is only part of another word", () => {
    expect(normalizePeriodLabel("Pendaftaran Mar-Apr")).toBe("pendaftaran maret-april");
    expect(normalizePeriodLabel("Marketing 2026")).toBe("marketing 2026");
  });
});

describe("parsePeriodMonth", () => {
  it("reads month and year from any alias", () => {
    expect(parsePeriodMonth("Oktober 2026")).toEqual({ year: 2026, month: 10 });
    expect(parsePeriodMonth("okt 2026")).toEqual({ year: 2026, month: 10 });
    expect(parsePeriodMonth("Des 2027")).toEqual({ year: 2027, month: 12 });
  });

  it("returns null when the label is not exactly one month and one year", () => {
    expect(parsePeriodMonth("Semester 1 2025/2026")).toBeNull();
    expect(parsePeriodMonth("Oktober")).toBeNull();
    expect(parsePeriodMonth("2026")).toBeNull();
    expect(parsePeriodMonth("Okt - Des 2026")).toBeNull();
    expect(parsePeriodMonth("")).toBeNull();
  });
});

describe("lastDayOfMonth", () => {
  it("returns the last day as YYYY-MM-DD", () => {
    expect(lastDayOfMonth(2026, 10)).toBe("2026-10-31");
    expect(lastDayOfMonth(2026, 11)).toBe("2026-11-30");
    expect(lastDayOfMonth(2027, 2)).toBe("2027-02-28");
    expect(lastDayOfMonth(2028, 2)).toBe("2028-02-29");
    expect(lastDayOfMonth(2026, 12)).toBe("2026-12-31");
  });
});

describe("defaultDueDateForPeriod", () => {
  it("is the last day of the month named by the label", () => {
    expect(defaultDueDateForPeriod("Oktober 2026")).toBe("2026-10-31");
    expect(defaultDueDateForPeriod("Feb 2028")).toBe("2028-02-29");
  });

  it("is null when the label does not name one month", () => {
    expect(defaultDueDateForPeriod("Semester 1 2025/2026")).toBeNull();
  });
});
