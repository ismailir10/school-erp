import { describe, it, expect } from "vitest";
import {
  isSchoolWeekday,
  normalizeRotationStart,
  rotationDayIndex,
  rotationDayLabel,
  sentraLabel,
} from "../rotation";

const MON = "2026-11-02";

describe("isSchoolWeekday / normalizeRotationStart", () => {
  it("knows weekdays", () => {
    expect(isSchoolWeekday("2026-11-06")).toBe(true); // Fri
    expect(isSchoolWeekday("2026-11-07")).toBe(false); // Sat
    expect(isSchoolWeekday("2026-11-08")).toBe(false); // Sun
  });
  it("moves weekend starts to Monday, keeps weekdays", () => {
    expect(normalizeRotationStart("2026-11-04")).toBe("2026-11-04");
    expect(normalizeRotationStart("2026-11-07")).toBe("2026-11-09");
    expect(normalizeRotationStart("2026-11-08")).toBe("2026-11-09");
    expect(normalizeRotationStart("2026-12-26")).toBe("2026-12-28"); // month change
  });
});

describe("rotationDayIndex", () => {
  it("counts 0..9 over two weeks from a Monday and wraps", () => {
    const days = [
      "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13",
    ];
    days.forEach((d, i) => expect(rotationDayIndex(MON, d, 10)).toBe(i));
    expect(rotationDayIndex(MON, "2026-11-16", 10)).toBe(0);
  });
  it("returns null on weekends, before start, and bad cycle", () => {
    expect(rotationDayIndex(MON, "2026-11-07", 10)).toBeNull();
    expect(rotationDayIndex(MON, "2026-11-08", 10)).toBeNull();
    expect(rotationDayIndex(MON, "2026-10-30", 10)).toBeNull();
    expect(rotationDayIndex(MON, MON, 0)).toBeNull();
  });
  it("handles a Wednesday start", () => {
    const wed = "2026-11-04";
    expect(rotationDayIndex(wed, wed, 10)).toBe(0);
    expect(rotationDayIndex(wed, "2026-11-06", 10)).toBe(2);
    expect(rotationDayIndex(wed, "2026-11-09", 10)).toBe(3); // next Monday
    expect(rotationDayIndex(wed, "2026-11-03", 10)).toBeNull();
  });
  it("normalizes a Saturday start to the next Monday", () => {
    expect(rotationDayIndex("2026-11-07", "2026-11-09", 10)).toBe(0);
    expect(rotationDayIndex("2026-11-07", "2026-11-10", 10)).toBe(1);
    expect(rotationDayIndex("2026-11-07", "2026-11-06", 10)).toBeNull();
  });
  it("matches a brute-force oracle over a long span", () => {
    const start = "2026-01-05";
    const cycle = 10;
    let count = 0;
    const cur = new Date(Date.UTC(2026, 0, 5));
    const end = Date.UTC(2026, 10, 6);
    while (cur.getTime() <= end) {
      const ymd = cur.toISOString().slice(0, 10);
      const dow = cur.getUTCDay();
      if (dow >= 1 && dow <= 5) {
        expect(rotationDayIndex(start, ymd, cycle)).toBe(count % cycle);
        count++;
      } else {
        expect(rotationDayIndex(start, ymd, cycle)).toBeNull();
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  });
  it("works for other cycle lengths", () => {
    expect(rotationDayIndex(MON, "2026-11-09", 5)).toBe(0);
    expect(rotationDayIndex(MON, "2026-11-09", 3)).toBe(2);
  });
});

describe("rotationDayLabel", () => {
  it("labels from a Monday start", () => {
    expect(rotationDayLabel(MON, 0)).toBe("Pekan 1 · Senin");
    expect(rotationDayLabel(MON, 4)).toBe("Pekan 1 · Jumat");
    expect(rotationDayLabel(MON, 5)).toBe("Pekan 2 · Senin");
    expect(rotationDayLabel(MON, 9)).toBe("Pekan 2 · Jumat");
  });
  it("labels from a Wednesday start", () => {
    const wed = "2026-11-04";
    expect(rotationDayLabel(wed, 0)).toBe("Pekan 1 · Rabu");
    expect(rotationDayLabel(wed, 2)).toBe("Pekan 1 · Jumat");
    expect(rotationDayLabel(wed, 3)).toBe("Pekan 2 · Senin");
  });
  it("normalizes a Saturday start", () => {
    expect(rotationDayLabel("2026-11-07", 0)).toBe("Pekan 1 · Senin");
  });
});

describe("sentraLabel", () => {
  it("prefixes unless already prefixed", () => {
    expect(sentraLabel("Balok")).toBe("Sentra Balok");
    expect(sentraLabel("Sentra Balok")).toBe("Sentra Balok");
    expect(sentraLabel("sentra balok")).toBe("sentra balok");
  });
});
