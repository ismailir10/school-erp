import { describe, it, expect } from "vitest";
import { calendarDate, isRealCalendarDate, rupiahAmount, rupiahAmountCoerced } from "../bounds";

describe("rupiahAmount (STR-13)", () => {
  const s = rupiahAmount();

  it("accepts whole rupiah in range", () => {
    expect(s.safeParse(1).success).toBe(true);
    expect(s.safeParse(150_000).success).toBe(true);
    expect(s.safeParse(1_000_000_000).success).toBe(true);
  });

  it("rejects 0, negatives and sub-rupiah amounts with the minimum message", () => {
    for (const v of [0, -5, 0.001, 0.5]) {
      const r = s.safeParse(v);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Nominal minimal Rp 1.");
    }
  });

  it("rejects fractional rupiah above 1", () => {
    expect(s.safeParse(100.5).success).toBe(false);
  });

  it("rejects values above Rp 1.000.000.000 (no Decimal(15,2) overflow)", () => {
    const r = s.safeParse(1e13);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Nominal maksimal Rp 1.000.000.000.");
    expect(s.safeParse(1_000_000_001).success).toBe(false);
  });

  it("rejects NaN / Infinity", () => {
    expect(s.safeParse(NaN).success).toBe(false);
    expect(s.safeParse(Infinity).success).toBe(false);
  });

  it("coerced variant accepts numeric strings but applies the same bounds", () => {
    const c = rupiahAmountCoerced();
    expect(c.safeParse("75000").success).toBe(true);
    expect(c.safeParse("0.001").success).toBe(false);
    expect(c.safeParse("1e13").success).toBe(false);
    expect(c.safeParse("").success).toBe(false);
    expect(c.safeParse("abc").success).toBe(false);
  });
});

describe("calendarDate (STR-13)", () => {
  const s = calendarDate();

  it("accepts real dates inside the window", () => {
    for (const d of ["2026-07-17", "2024-02-29", "2000-01-01", "2100-12-31"]) {
      expect(s.safeParse(d).success).toBe(true);
    }
  });

  it("rejects impossible calendar dates", () => {
    for (const d of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-07-99"]) {
      const r = s.safeParse(d);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Tanggal tidak valid.");
    }
  });

  it("rejects dates outside 2000-01-01..2100-12-31", () => {
    for (const d of ["1900-01-01", "1999-12-31", "2101-01-01", "9999-12-31"]) {
      const r = s.safeParse(d);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Tanggal di luar rentang yang wajar.");
    }
  });

  it("rejects malformed strings with the format message", () => {
    for (const d of ["", "26-07-17", "2026/07/17", "2026-7-1", "2026-07-17T00:00:00Z", "abc"]) {
      const r = s.safeParse(d);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Format tanggal harus YYYY-MM-DD.");
    }
  });

  it("honours custom messages and window", () => {
    const c = calendarDate({ invalid: "x" }, { min: "2020-01-01", max: "2030-01-01" });
    expect(c.safeParse("2019-12-31").success).toBe(false);
    expect(c.safeParse("2025-05-05").success).toBe(true);
    const r = c.safeParse("2026-02-30");
    expect(!r.success && r.error.issues[0].message).toBe("x");
  });

  it("isRealCalendarDate round-trips", () => {
    expect(isRealCalendarDate("2026-02-28")).toBe(true);
    expect(isRealCalendarDate("2026-02-30")).toBe(false);
  });
});
