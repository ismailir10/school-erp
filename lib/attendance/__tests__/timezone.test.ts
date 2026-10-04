import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTodayInTimezone, getYmdInTimezone, zonedDateTimeToUtc } from "../timezone";

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
