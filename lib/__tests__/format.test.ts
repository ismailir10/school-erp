import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  formatRupiah,
  formatRupiahCompact,
  formatTime,
  formatWeekRangeLabel,
  maskBankAccount,
} from "@/lib/format";

describe("formatNumber", () => {
  it("groups thousands the Indonesian way", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(-1500)).toBe("-1.500");
  });

  it("uses a decimal comma and honours maximumFractionDigits", () => {
    expect(formatNumber(104.5)).toBe("104,5");
    expect(formatNumber(1.23456)).toBe("1,235");
    expect(formatNumber(1.23456, { maximumFractionDigits: 2 })).toBe("1,23");
    expect(formatNumber(1234.5, { maximumFractionDigits: 0 })).toBe("1.235");
  });
});

describe("formatRupiahCompact", () => {
  it("abbreviates thousands, millions and billions the Indonesian way", () => {
    expect(formatRupiahCompact(850_000)).toBe("Rp 850 rb");
    expect(formatRupiahCompact(12_400_000)).toBe("Rp 12,4 jt");
    expect(formatRupiahCompact(1_200_000_000)).toBe("Rp 1,2 M");
  });

  it("leaves amounts under a thousand and zero as plain numbers", () => {
    expect(formatRupiahCompact(850)).toBe("Rp 850");
    expect(formatRupiahCompact(0)).toBe("Rp 0");
  });

  it("coerces numeric strings (Prisma Decimal serialization)", () => {
    expect(formatRupiahCompact("2500000")).toBe("Rp 2,5 jt");
  });
});

describe("formatRupiah", () => {
  it("formats integer amount with Indonesian thousand separators", () => {
    expect(formatRupiah(3300000)).toBe("Rp 3.300.000");
  });

  it("coerces numeric strings (Prisma Decimal serialization)", () => {
    expect(formatRupiah("750000")).toBe("Rp 750.000");
  });

  it("rounds fractional amounts", () => {
    expect(formatRupiah(1234.56)).toBe("Rp 1.235");
  });

  it("handles zero", () => {
    expect(formatRupiah(0)).toBe("Rp 0");
  });

  it("formats the reported bug case correctly (no string concat)", () => {
    // Reproduces the reported bug: "750000" + "2000000" + "550000" used to produce
    // "7500002000000550000" → "Rp 7.500.002.000.000.550.000". Correct sum is 3,300,000.
    const amounts = ["750000", "2000000", "550000"];
    const total = amounts.reduce<number>((s, v) => s + (Number(v) || 0), 0);
    expect(total).toBe(3_300_000);
    expect(formatRupiah(total)).toBe("Rp 3.300.000");
  });
});

describe("maskBankAccount", () => {
  it("masks all but the last 4 digits", () => {
    expect(maskBankAccount("1234567890")).toBe("******7890");
  });

  it("masks a longer real account number", () => {
    expect(maskBankAccount("0000000001")).toBe("******0001");
  });

  it("fully masks a ≤4-char account (security primitive — never reveal short values)", () => {
    expect(maskBankAccount("1234")).toBe("****");
    expect(maskBankAccount("12")).toBe("**");
    expect(maskBankAccount("1")).toBe("*");
  });

  it("returns an empty string unchanged (caller decides empty-state)", () => {
    expect(maskBankAccount("")).toBe("");
  });
});

describe("numeric reduce defensive pattern", () => {
  it("coerces mixed string+number inputs without concatenating", () => {
    const mixed: Array<string | number> = ["1000", 2000, "3000"];
    const total = mixed.reduce<number>((s, v) => s + (Number(v) || 0), 0);
    expect(total).toBe(6000);
  });

  it("treats invalid values as zero", () => {
    const vals: Array<string | number | undefined> = ["abc", undefined, 500];
    const total = vals.reduce<number>((s, v) => s + (Number(v) || 0), 0);
    expect(total).toBe(500);
  });
});

describe("formatWeekRangeLabel", () => {
  it("prints the year once, at the end of the range", () => {
    // The teacher journal printed "7 Jun – 11 Jun" — the same string in 2025,
    // 2026 and 2027, on a control that let the reader page years away.
    expect(formatWeekRangeLabel("2026-08-24", "2026-08-28")).toBe("24 Agu – 28 Agu 2026");
  });

  it("keeps both month names when a week straddles a month boundary", () => {
    expect(formatWeekRangeLabel("2026-08-31", "2026-09-04")).toBe("31 Agu – 4 Sep 2026");
  });

  it("returns an empty string for an empty range so callers can fall back", () => {
    expect(formatWeekRangeLabel("", "")).toBe("");
  });
});

describe("formatTime / formatDateTime — pinned to Asia/Jakarta (TCH-1)", () => {
  // These assertions hold whatever TZ the runner uses; that is the point —
  // the SSR (UTC) and browser (WIB) renders of the same instant must match.
  it("renders 00:02 UTC as 07.02 WIB", () => {
    expect(formatTime("2026-09-29T00:02:00.000Z")).toBe("07.02");
  });

  it("renders 09:19 UTC as 16.19 WIB", () => {
    expect(formatTime("2026-09-29T09:19:00.000Z")).toBe("16.19");
  });

  it("rolls past midnight WIB and never prints 24.xx", () => {
    expect(formatTime("2026-09-29T17:05:00.000Z")).toBe("00.05");
  });

  it("returns the placeholder for null and unparseable input", () => {
    expect(formatTime(null)).toBe("--:--");
    expect(formatTime("not-a-date")).toBe("--:--");
  });

  it("gives the same string under UTC and WIB process zones", () => {
    const iso = "2026-09-29T00:02:00.000Z";
    const original = process.env.TZ;
    try {
      const out = ["UTC", "Asia/Jakarta", "America/Los_Angeles"].map((tz) => {
        process.env.TZ = tz;
        return formatTime(iso);
      });
      expect(new Set(out).size).toBe(1);
      expect(out[0]).toBe("07.02");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("formatDateTime uses the WIB calendar day, not the UTC one", () => {
    // 17:30 UTC on 28 Sep is already 00:30 on 29 Sep in Jakarta.
    expect(formatDateTime("2026-09-28T17:30:00.000Z")).toBe("29 Sep 2026 · 00.30");
    expect(formatDateTime(null)).toBe("—");
  });

  it("formatRelativeTime's old-date fallback uses the WIB calendar day", () => {
    const now = new Date("2026-12-31T00:00:00.000Z");
    expect(formatRelativeTime("2026-09-28T17:30:00.000Z", now)).toBe("29 Sep 2026");
  });
});

describe("formatDate / formatDateShort — Asia/Jakarta day for timestamps", () => {
  it("a 22:04Z timestamp is already the next day in Jakarta", () => {
    expect(formatDateShort("2026-10-06T22:04:00.000Z")).toBe("7 Okt 2026");
    expect(formatDate("2026-10-06T22:04:00.000Z")).toBe("7 Oktober 2026");
  });

  it("stays on the same day up to 16:59:59Z (23:59:59 WIB)", () => {
    expect(formatDateShort("2026-10-06T16:59:59.000Z")).toBe("6 Okt 2026");
    expect(formatDateShort("2026-10-06T17:00:00.000Z")).toBe("7 Okt 2026");
  });

  it("keeps a UTC-midnight value on its own day", () => {
    expect(formatDateShort("2026-10-06T00:00:00.000Z")).toBe("6 Okt 2026");
  });

  it("never shifts a date-only value", () => {
    expect(formatDateShort("2026-10-06")).toBe("6 Okt 2026");
    expect(formatDate("2026-10-06")).toBe("6 Oktober 2026");
  });

  it("honours caller options for both input kinds", () => {
    const opts = { day: "numeric", month: "short" } as const;
    expect(formatDate("2026-10-06T22:04:00.000Z", opts)).toBe("7 Okt");
    expect(formatDate("2026-10-06", opts)).toBe("6 Okt");
  });

  it("falls back to the date part when the timestamp is unparseable", () => {
    expect(formatDateShort("2026-10-06Tgarbage")).toBe("6 Okt 2026");
  });

  it("gives the same string under UTC, WIB and LA process zones", () => {
    const original = process.env.TZ;
    try {
      for (const [input, expected] of [
        ["2026-10-06T22:04:00.000Z", "7 Okt 2026"],
        ["2026-10-06", "6 Okt 2026"],
      ] as const) {
        const out = ["UTC", "Asia/Jakarta", "America/Los_Angeles"].map((tz) => {
          process.env.TZ = tz;
          return formatDateShort(input);
        });
        expect(new Set(out).size).toBe(1);
        expect(out[0]).toBe(expected);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
