import { describe, it, expect } from "vitest";
import { holidaySchema } from "@/lib/validations/holiday";

const valid = {
  date: "2026-08-17",
  name: "Hari Kemerdekaan",
  type: "NATIONAL",
  isHalfDay: false,
};

describe("holidaySchema", () => {
  it("accepts a well-formed holiday body", () => {
    const res = holidaySchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it("accepts a body without the optional isHalfDay flag", () => {
    const res = holidaySchema.safeParse({
      date: valid.date,
      name: valid.name,
      type: valid.type,
    });
    expect(res.success).toBe(true);
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    const res = holidaySchema.safeParse({ ...valid, date: "17-08-2026" });
    expect(res.success).toBe(false);
  });

  it("rejects an empty / whitespace-only name", () => {
    expect(holidaySchema.safeParse({ ...valid, name: "   " }).success).toBe(
      false,
    );
  });

  it("trims the name before length checks", () => {
    const res = holidaySchema.safeParse({ ...valid, name: "  Idul Fitri  " });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.name).toBe("Idul Fitri");
  });

  it("rejects an over-long name", () => {
    const res = holidaySchema.safeParse({ ...valid, name: "x".repeat(121) });
    expect(res.success).toBe(false);
  });

  it("rejects an empty type", () => {
    expect(holidaySchema.safeParse({ ...valid, type: "" }).success).toBe(false);
  });
});

 it.each(["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-12"])("rejects impossible date %s", (date) => {
   expect(holidaySchema.safeParse({ ...valid, date }).success).toBe(false);
 });
 it("accepts leap day", () => {
   expect(holidaySchema.safeParse({ ...valid, date: "2028-02-29" }).success).toBe(true);
 });
