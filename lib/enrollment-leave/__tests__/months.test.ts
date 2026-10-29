import { describe, it, expect } from "vitest";
import {
  compareYearMonth,
  formatLeaveRange,
  formatShortMonth,
  formatYearMonth,
  fromMonthIndex,
  leaveCoversMonth,
  monthIndex,
  monthsOverlap,
  parseYearMonth,
} from "../months";

const ym = (year: number, month: number) => ({ year, month });
const range = (a: string, b: string) => ({ start: parseYearMonth(a)!, end: parseYearMonth(b)! });

describe("parseYearMonth / formatYearMonth", () => {
  it("round-trips YYYY-MM", () => {
    expect(parseYearMonth("2026-12")).toEqual(ym(2026, 12));
    expect(formatYearMonth(ym(2027, 1))).toBe("2027-01");
    expect(formatYearMonth(parseYearMonth("2026-07")!)).toBe("2026-07");
  });

  it.each(["2026-13", "2026-00", "2026-1", "26-01", "2026-01-01", "", "Desember 2026", " 2026-01"])(
    "rejects %j",
    (bad) => {
      expect(parseYearMonth(bad)).toBeNull();
    },
  );
});

describe("monthIndex", () => {
  it("orders across year boundaries and inverts", () => {
    expect(monthIndex(ym(2027, 1))).toBe(monthIndex(ym(2026, 12)) + 1);
    expect(fromMonthIndex(monthIndex(ym(2026, 12)))).toEqual(ym(2026, 12));
    expect(fromMonthIndex(monthIndex(ym(2027, 1)))).toEqual(ym(2027, 1));
  });

  it("compareYearMonth is signed", () => {
    expect(compareYearMonth(ym(2026, 12), ym(2027, 1))).toBeLessThan(0);
    expect(compareYearMonth(ym(2027, 1), ym(2026, 12))).toBeGreaterThan(0);
    expect(compareYearMonth(ym(2026, 5), ym(2026, 5))).toBe(0);
  });
});

describe("monthsOverlap (inclusive ranges)", () => {
  it("overlaps when sharing a single boundary month", () => {
    expect(monthsOverlap(range("2026-10", "2026-12"), range("2026-12", "2027-02"))).toBe(true);
  });
  it("overlaps when one contains the other", () => {
    expect(monthsOverlap(range("2026-08", "2027-06"), range("2026-12", "2026-12"))).toBe(true);
  });
  it("does not overlap for adjacent ranges", () => {
    expect(monthsOverlap(range("2026-10", "2026-11"), range("2026-12", "2027-01"))).toBe(false);
  });
  it("is symmetric", () => {
    const a = range("2026-10", "2026-11");
    const b = range("2026-11", "2026-12");
    expect(monthsOverlap(a, b)).toBe(monthsOverlap(b, a));
  });
  it("handles a year boundary", () => {
    expect(monthsOverlap(range("2026-12", "2027-01"), range("2027-01", "2027-03"))).toBe(true);
    expect(monthsOverlap(range("2026-11", "2026-12"), range("2027-01", "2027-03"))).toBe(false);
  });
});

describe("leaveCoversMonth", () => {
  const leave = range("2026-12", "2027-01");
  it("covers both ends inclusively", () => {
    expect(leaveCoversMonth(leave, ym(2026, 12))).toBe(true);
    expect(leaveCoversMonth(leave, ym(2027, 1))).toBe(true);
  });
  it("does not cover the months around it", () => {
    expect(leaveCoversMonth(leave, ym(2026, 11))).toBe(false);
    expect(leaveCoversMonth(leave, ym(2027, 2))).toBe(false);
  });
  it("a one-month leave covers exactly that month", () => {
    const one = range("2026-12", "2026-12");
    expect(leaveCoversMonth(one, ym(2026, 12))).toBe(true);
    expect(leaveCoversMonth(one, ym(2027, 12))).toBe(false);
  });
});

describe("formatLeaveRange", () => {
  it("formats a multi-month range with Indonesian short months", () => {
    expect(formatLeaveRange("2026-12", "2027-01")).toBe("Des 2026 – Jan 2027");
    expect(formatLeaveRange("2026-08", "2026-09")).toBe("Agu 2026 – Sep 2026");
  });
  it("collapses a single-month leave", () => {
    expect(formatLeaveRange("2026-12", "2026-12")).toBe("Des 2026");
  });
  it("names every month", () => {
    const names = Array.from({ length: 12 }, (_, i) => formatShortMonth(ym(2026, i + 1)).split(" ")[0]);
    expect(names).toEqual(["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);
  });
  it("does not throw on malformed text", () => {
    expect(formatLeaveRange("oops", "2026-12")).toBe("oops – 2026-12");
    expect(formatLeaveRange("oops", "oops")).toBe("oops");
  });
});
