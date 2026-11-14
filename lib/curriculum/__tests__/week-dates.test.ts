import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { schoolWeekError } from "../week-dates";
describe("school week dates", () => {
  it("accepts a Monday–Friday within semester", () => {
    expect(schoolWeekError("2026-11-16", "2026-11-20", "2026-07-01", "2026-12-31")).toBeNull();
  });
  it("rejects Tuesday–Sunday and multiple weeks", () => {
    expect(schoolWeekError("2034-02-07", "2034-02-12")).toMatch(/Senin/);
    expect(schoolWeekError("2026-11-16", "2026-11-27")).toMatch(/minggu yang sama/);
  });
  it("rejects dates just outside either semester boundary", () => {
    expect(schoolWeekError("2027-01-04", "2027-01-08", "2026-07-01", "2027-01-03")).toMatch(/semester/);
    expect(schoolWeekError("2026-06-29", "2026-07-03", "2026-07-01", "2027-01-03")).toMatch(/semester/);
  });
});
