import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMonthYearInTimezone,
  getTodayInTimezone,
  getYmdInTimezone,
  localTimeExists,
  zonedDateTimeToUtc,
} from "../timezone";

/**
 * Regression coverage for FIND-002 / FIND-016 (UAT 2026-05-14):
 *
 * The bug class was `new Date().toISOString().split("T")[0]` running on a
 * UTC-clocked Vercel function and returning yesterday's WIB date during the
 * 00:00–06:59 WIB window. The canonical fix routes every "today" through
 * `getTodayInTimezone("Asia/Jakarta")`. These tests pin the helper against
 * fixed Date instances spanning the problematic UTC↔WIB boundary so any
 * future regression of the helper itself is caught.
 */
describe("getTodayInTimezone / getYmdInTimezone — Asia/Jakarta boundaries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the WIB calendar date at 23:30 WIB (16:30 UTC same day)", () => {
    vi.setSystemTime(new Date("2026-05-14T16:30:00.000Z"));
    expect(getTodayInTimezone("Asia/Jakarta")).toBe("2026-05-14");
  });

  it("returns the *next* WIB calendar date at 00:30 WIB (17:30 UTC previous day)", () => {
    // This is the exact window the production regression manifested:
    // UTC clock reads "May 13 17:30", but WIB is already "May 14 00:30".
    vi.setSystemTime(new Date("2026-05-13T17:30:00.000Z"));
    expect(getTodayInTimezone("Asia/Jakarta")).toBe("2026-05-14");
  });

  it("returns the WIB calendar date at 06:30 WIB (23:30 UTC previous day)", () => {
    vi.setSystemTime(new Date("2026-05-13T23:30:00.000Z"));
    expect(getTodayInTimezone("Asia/Jakarta")).toBe("2026-05-14");
  });

  it("returns the same WIB calendar date at 07:30 WIB (00:30 UTC same day)", () => {
    vi.setSystemTime(new Date("2026-05-14T00:30:00.000Z"));
    expect(getTodayInTimezone("Asia/Jakarta")).toBe("2026-05-14");
  });

  it("getYmdInTimezone formats a specific Date independent of host TZ", () => {
    const d = new Date("2026-05-13T19:00:00.000Z"); // 02:00 WIB May 14
    expect(getYmdInTimezone(d, "Asia/Jakarta")).toBe("2026-05-14");
  });

  it("crosses month boundary correctly (31 May UTC 23:00 → 1 June WIB 06:00)", () => {
    vi.setSystemTime(new Date("2026-05-31T23:00:00.000Z"));
    expect(getTodayInTimezone("Asia/Jakarta")).toBe("2026-06-01");
  });

  it("crosses year boundary correctly (31 Dec UTC 23:00 → 1 Jan WIB 06:00)", () => {
    vi.setSystemTime(new Date("2026-12-31T23:00:00.000Z"));
    expect(getTodayInTimezone("Asia/Jakarta")).toBe("2027-01-01");
  });
});

describe("getMonthYearInTimezone — the school's current month, not the server's", () => {
  it("is the new month at 03:00 WIB on the 1st (20:00Z on the last day of the month before)", () => {
    expect(getMonthYearInTimezone(new Date("2026-09-30T20:00:00.000Z"), "Asia/Jakarta")).toEqual({
      month: 10,
      year: 2026,
    });
  });

  it("is the new year at 03:00 WIB on 1 Jan", () => {
    expect(getMonthYearInTimezone(new Date("2026-12-31T20:00:00.000Z"), "Asia/Jakarta")).toEqual({
      month: 1,
      year: 2027,
    });
  });

  it("is still the old month at 23:30 WIB on the last day", () => {
    expect(getMonthYearInTimezone(new Date("2026-09-30T16:30:00.000Z"), "Asia/Jakarta")).toEqual({
      month: 9,
      year: 2026,
    });
  });

  it("returns numbers without a leading zero", () => {
    expect(getMonthYearInTimezone(new Date("2026-03-15T05:00:00.000Z"), "Asia/Jakarta")).toEqual({
      month: 3,
      year: 2026,
    });
  });

  it("defaults to now", () => {
    const { month, year } = getMonthYearInTimezone(undefined, "Asia/Jakarta");
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(year).toBeGreaterThanOrEqual(2026);
  });
});

describe("zonedDateTimeToUtc", () => {
  it("converts Asia/Jakarta (UTC+7) local time to the UTC instant", () => {
    expect(zonedDateTimeToUtc("2026-10-05", "07:30", "Asia/Jakarta").toISOString()).toBe(
      "2026-10-05T00:30:00.000Z"
    );
  });

  it("rolls back a day for Asia/Makassar (UTC+8)", () => {
    expect(zonedDateTimeToUtc("2026-10-05", "07:30", "Asia/Makassar").toISOString()).toBe(
      "2026-10-04T23:30:00.000Z"
    );
  });

  it("handles Asia/Jayapura (UTC+9) and UTC", () => {
    expect(zonedDateTimeToUtc("2026-10-05", "07:30", "Asia/Jayapura").toISOString()).toBe(
      "2026-10-04T22:30:00.000Z"
    );
    expect(zonedDateTimeToUtc("2026-10-05", "07:30", "UTC").toISOString()).toBe(
      "2026-10-05T07:30:00.000Z"
    );
  });

  it("honours DST zones (America/New_York: EDT -4 in Oct, EST -5 in Dec)", () => {
    expect(zonedDateTimeToUtc("2026-10-05", "07:30", "America/New_York").toISOString()).toBe(
      "2026-10-05T11:30:00.000Z"
    );
    expect(zonedDateTimeToUtc("2026-12-05", "07:30", "America/New_York").toISOString()).toBe(
      "2026-12-05T12:30:00.000Z"
    );
  });

  it("handles midnight", () => {
    expect(zonedDateTimeToUtc("2026-10-05", "00:00", "Asia/Jakarta").toISOString()).toBe(
      "2026-10-04T17:00:00.000Z"
    );
  });
});

describe("localTimeExists", () => {
  it("is true for an ordinary Asia/Jakarta time", () => {
    expect(localTimeExists("2026-10-05", "07:30", "Asia/Jakarta")).toBe(true);
  });

  it("is false inside the America/New_York spring-forward gap", () => {
    expect(localTimeExists("2026-03-08", "02:30", "America/New_York")).toBe(false);
  });

  it("is true just after the gap", () => {
    expect(localTimeExists("2026-03-08", "03:30", "America/New_York")).toBe(true);
  });

  it("is true for an ambiguous fall-back time (it occurs twice)", () => {
    expect(localTimeExists("2026-11-01", "01:30", "America/New_York")).toBe(true);
  });

  it("is true for midnight", () => {
    expect(localTimeExists("2026-10-05", "00:00", "Asia/Jakarta")).toBe(true);
    expect(localTimeExists("2026-03-08", "00:00", "America/New_York")).toBe(true);
    expect(localTimeExists("2026-11-01", "00:00", "America/New_York")).toBe(true);
  });
});
