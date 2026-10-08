import { describe, it, expect } from "vitest";
import { attendanceOverrideSchema, attendanceOverrideUpdateSchema } from "@/lib/validations/attendance";

describe("attendanceOverrideSchema", () => {
  const valid = {
    date: "2026-04-15",
    status: "PRESENT" as const,
    reason: "Sakit ringan",
  };

  it("accepts a valid past date", () => {
    expect(attendanceOverrideSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects 2024-02-31 (impossible calendar day)", () => {
    const r = attendanceOverrideSchema.safeParse({ ...valid, date: "2024-02-31" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("date"))).toBe(true);
    }
  });

  it("rejects 'not-a-date'", () => {
    const r = attendanceOverrideSchema.safeParse({ ...valid, date: "not-a-date" });
    expect(r.success).toBe(false);
  });

  it("rejects far-future date (>30 days ahead) for PRESENT", () => {
    const r = attendanceOverrideSchema.safeParse({ ...valid, date: "2099-12-31" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.message.includes("30 hari"))
      ).toBe(true);
    }
  });

  it("allows far-future date for LEAVE (annual leave planning)", () => {
    const r = attendanceOverrideSchema.safeParse({
      ...valid,
      status: "LEAVE" as const,
      date: "2099-12-31",
    });
    expect(r.success).toBe(true);
  });

  it("allows far-future date for SICK and PERMISSION", () => {
    expect(
      attendanceOverrideSchema.safeParse({ ...valid, status: "SICK" as const, date: "2099-12-31" }).success
    ).toBe(true);
    expect(
      attendanceOverrideSchema.safeParse({ ...valid, status: "PERMISSION" as const, date: "2099-12-31" }).success
    ).toBe(true);
  });

  it("rejects empty reason", () => {
    const r = attendanceOverrideSchema.safeParse({ ...valid, reason: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects unknown status", () => {
    const r = attendanceOverrideSchema.safeParse({
      ...valid,
      status: "BOGUS" as unknown as "PRESENT",
    });
    expect(r.success).toBe(false);
  });

  it("rejects slash-format date 2026/04/15", () => {
    const r = attendanceOverrideSchema.safeParse({ ...valid, date: "2026/04/15" });
    expect(r.success).toBe(false);
  });

  it("trims and length-limits reason", () => {
    const r = attendanceOverrideSchema.safeParse({
      ...valid,
      reason: "  test  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("test");
  });

  it("rejects reason >500 chars", () => {
    const r = attendanceOverrideSchema.safeParse({
      ...valid,
      reason: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe("attendanceOverrideSchema — checkInTime", () => {
  const base = { date: "2026-04-15", status: "PRESENT" as const, reason: "Koreksi" };

  it("accepts and preserves HH:MM", () => {
    const r = attendanceOverrideSchema.safeParse({ ...base, checkInTime: "07:30" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.checkInTime).toBe("07:30");
  });

  it.each(["7:3", "25:00", "07:60", "07:30:00x", "abc"])("rejects %s", (t) => {
    expect(attendanceOverrideSchema.safeParse({ ...base, checkInTime: t }).success).toBe(false);
  });

  it("treats blank or omitted as no time", () => {
    const blank = attendanceOverrideSchema.safeParse({ ...base, checkInTime: "" });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.checkInTime).toBeUndefined();
    const omitted = attendanceOverrideSchema.safeParse(base);
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.checkInTime).toBeUndefined();
  });
});

describe("attendanceOverrideUpdateSchema — checkInTime", () => {
  const base = { status: "PRESENT" as const, reason: "Koreksi" };

  it("accepts HH:MM", () => {
    const r = attendanceOverrideUpdateSchema.safeParse({ ...base, checkInTime: "07:30" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.checkInTime).toBe("07:30");
  });

  it("still accepts legacy full local datetimes", () => {
    expect(
      attendanceOverrideUpdateSchema.safeParse({ ...base, checkInTime: "2026-04-15T07:00" }).success
    ).toBe(true);
    expect(
      attendanceOverrideUpdateSchema.safeParse({ ...base, checkInTime: "2026-04-15T07:00:00.000Z" }).success
    ).toBe(true);
  });

  it.each(["7:3", "25:00", "07:30:00x"])("rejects %s", (t) => {
    expect(attendanceOverrideUpdateSchema.safeParse({ ...base, checkInTime: t }).success).toBe(false);
  });

  it("accepts blank or omitted", () => {
    expect(attendanceOverrideUpdateSchema.safeParse({ ...base, checkInTime: "" }).success).toBe(true);
    expect(attendanceOverrideUpdateSchema.safeParse(base).success).toBe(true);
  });
});
