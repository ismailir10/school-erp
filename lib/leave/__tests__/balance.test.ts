import { describe, expect, it } from "vitest";
import { balancePeriodStart } from "../balance";

/**
 * The leave allowance resets on 1 January **Jakarta time**. The period start was
 * `${now.getFullYear()}-01-01` on the server clock (UTC on Vercel), so for the
 * first seven hours of New Year in WIB the balance period still started on 1
 * January of the old year: last year's approved leave was counted against the
 * new year's allowance, and the approve gate compared against the wrong date.
 */
describe("balancePeriodStart — Asia/Jakarta calendar year", () => {
  it("is the new year at 03:00 WIB on 1 Jan (20:00Z on 31 Dec)", () => {
    expect(balancePeriodStart(new Date("2026-12-31T20:00:00.000Z"))).toBe("2027-01-01");
  });

  it("is the new year at 00:00 WIB sharp (17:00Z on 31 Dec)", () => {
    expect(balancePeriodStart(new Date("2026-12-31T17:00:00.000Z"))).toBe("2027-01-01");
  });

  it("is still the old year at 23:59 WIB on 31 Dec (16:59Z)", () => {
    expect(balancePeriodStart(new Date("2026-12-31T16:59:00.000Z"))).toBe("2026-01-01");
  });

  it("is the new year at 12:00 WIB on 1 Jan", () => {
    expect(balancePeriodStart(new Date("2027-01-01T05:00:00.000Z"))).toBe("2027-01-01");
  });

  it("is that year's 1 Jan in mid-year", () => {
    expect(balancePeriodStart(new Date("2026-06-15T10:00:00.000Z"))).toBe("2026-01-01");
  });

  it("defaults to now", () => {
    expect(balancePeriodStart()).toMatch(/^\d{4}-01-01$/);
  });
});
