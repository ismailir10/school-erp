import { describe, it, expect } from "vitest";
import { weekStart, weekDates } from "@/lib/student-journal/week";

describe("weekStart", () => {
  it("returns Monday for a Wednesday", () => {
    expect(weekStart("2026-04-22")).toBe("2026-04-20");
  });
  it("returns Monday for a Sunday", () => {
    expect(weekStart("2026-04-26")).toBe("2026-04-20");
  });
  it("returns Monday for a Monday", () => {
    expect(weekStart("2026-04-20")).toBe("2026-04-20");
  });
});

describe("weekDates", () => {
  it("includes observed Saturday without imposing an empty Sunday", () => {
    expect(weekDates("2026-04-20", ["2026-04-25"])).toEqual([
      "2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24", "2026-04-25",
    ]);
  });
  it("returns 5 dates Mon-Fri for a given weekStart", () => {
    expect(weekDates("2026-04-20")).toEqual([
      "2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24",
    ]);
  });
});
