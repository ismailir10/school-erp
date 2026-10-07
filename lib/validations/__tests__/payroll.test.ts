import { describe, it, expect } from "vitest";
import { generatePayrollSchema } from "@/lib/validations/payroll";

describe("generatePayrollSchema", () => {
  it("accepts a valid one-month range", () => {
    const r = generatePayrollSchema.safeParse({
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed periodStart ('foo')", () => {
    const r = generatePayrollSchema.safeParse({
      periodStart: "foo",
      periodEnd: "2026-04-30",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("periodStart"))).toBe(true);
    }
  });

  it("rejects reversed range", () => {
    const r = generatePayrollSchema.safeParse({
      periodStart: "2026-12-01",
      periodEnd: "2026-01-01",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.message.includes("sebelum atau sama dengan"))
      ).toBe(true);
    }
  });

  it("rejects a 60-day range (over the 45-day cap)", () => {
    const r = generatePayrollSchema.safeParse({
      periodStart: "2026-01-01",
      periodEnd: "2026-03-01",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("periodEnd"))).toBe(true);
    }
  });

  it("rejects empty body", () => {
    const r = generatePayrollSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects non-ISO format like '2026/04/01'", () => {
    const r = generatePayrollSchema.safeParse({
      periodStart: "2026/04/01",
      periodEnd: "2026/04/30",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a single-day range (start == end)", () => {
    const r = generatePayrollSchema.safeParse({
      periodStart: "2026-04-15",
      periodEnd: "2026-04-15",
    });
    expect(r.success).toBe(true);
  });

  it("accepts the exact 45-day boundary", () => {
    // 2026-01-01..2026-02-14 inclusive = 45 days
    const r = generatePayrollSchema.safeParse({
      periodStart: "2026-01-01",
      periodEnd: "2026-02-14",
    });
    expect(r.success).toBe(true);
  });
});

import { adjustPayrollLineSchema } from "@/lib/validations/payroll";

describe("adjustPayrollLineSchema", () => {
  it("accepts a valid adjustment", () => {
    const r = adjustPayrollLineSchema.safeParse({ adjustmentAmount: 50000, adjustmentNote: "Lembur" });
    expect(r.success).toBe(true);
  });

  it("accepts zero (clears a previous adjustment)", () => {
    const r = adjustPayrollLineSchema.safeParse({ adjustmentAmount: 0, adjustmentNote: "Reset" });
    expect(r.success).toBe(true);
  });

  it("rejects missing or blank note", () => {
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: 1000 }).success).toBe(false);
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: 1000, adjustmentNote: "  " }).success).toBe(false);
  });

  it("rejects non-numeric and non-finite amounts", () => {
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: "abc", adjustmentNote: "x" }).success).toBe(false);
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: NaN, adjustmentNote: "x" }).success).toBe(false);
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: Infinity, adjustmentNote: "x" }).success).toBe(false);
  });
});

import { adjustPayrollLineFormSchema, payrollVariablesSchema } from "@/lib/validations/payroll";

describe("adjustPayrollLineFormSchema", () => {
  it("coerces a string amount from <Input type=number>", () => {
    const r = adjustPayrollLineFormSchema.safeParse({ adjustmentAmount: "50000", adjustmentNote: "Lembur" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.adjustmentAmount).toBe(50000);
  });

  it("coerces a blank amount to 0, matching the prior parseFloat(...) || 0 fallback", () => {
    const r = adjustPayrollLineFormSchema.safeParse({ adjustmentAmount: "", adjustmentNote: "Reset" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.adjustmentAmount).toBe(0);
  });

  it("still requires a non-blank note", () => {
    expect(adjustPayrollLineFormSchema.safeParse({ adjustmentAmount: "1000", adjustmentNote: "" }).success).toBe(false);
  });

  it("rejects a non-numeric amount with an Indonesian message", () => {
    const r = adjustPayrollLineFormSchema.safeParse({ adjustmentAmount: "abc", adjustmentNote: "x" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "Jumlah penyesuaian harus berupa angka")).toBe(true);
    }
  });
});

describe("payrollVariablesSchema", () => {
  const valid = { overtimeHours: "2.5", outdoorDays: "1", holidayWorkedDays: "0", dcDays: "0" };

  it("coerces string inputs to numbers", () => {
    const r = payrollVariablesSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ overtimeHours: 2.5, outdoorDays: 1, holidayWorkedDays: 0, dcDays: 0 });
    }
  });

  it("coerces blank inputs to 0 (default-with-no-asterisk fields)", () => {
    const r = payrollVariablesSchema.safeParse({ overtimeHours: "", outdoorDays: "", holidayWorkedDays: "", dcDays: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ overtimeHours: 0, outdoorDays: 0, holidayWorkedDays: 0, dcDays: 0 });
    }
  });

  it("defaults a missing field to 0, matching the route's own `?? 0` and partial-body callers", () => {
    const r = payrollVariablesSchema.safeParse({ overtimeHours: 5 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ overtimeHours: 5, outdoorDays: 0, holidayWorkedDays: 0, dcDays: 0 });
    }
  });

  it("rejects a negative value with an Indonesian message", () => {
    const r = payrollVariablesSchema.safeParse({ ...valid, outdoorDays: "-1" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("outdoorDays") && i.message === "Hari outdoor tidak boleh negatif")).toBe(true);
    }
  });

  it("rejects a non-integer day count", () => {
    const r = payrollVariablesSchema.safeParse({ ...valid, dcDays: "1.5" });
    expect(r.success).toBe(false);
  });

  it("rejects overtimeHours above the Decimal(5,2) column bound", () => {
    const r = payrollVariablesSchema.safeParse({ ...valid, overtimeHours: "1000" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-numeric value with an Indonesian message, not a default Zod one", () => {
    const r = payrollVariablesSchema.safeParse({ ...valid, dcDays: "abc" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "Hari DC harus berupa angka")).toBe(true);
    }
  });
});

import {
  calendarDaysInPeriod,
  payrollEditFormSchema,
  updatePayrollRunSchema,
} from "@/lib/validations/payroll";

describe("HRX-3 actualWorkDays bounds", () => {
  it("counts calendar days inclusively", () => {
    expect(calendarDaysInPeriod("2026-09-01", "2026-09-30")).toBe(30);
    expect(calendarDaysInPeriod("2026-10-05", "2026-10-05")).toBe(1);
  });

  it("wire schema rejects 0 and fractional values, accepts 1", () => {
    expect(updatePayrollRunSchema.safeParse({ actualWorkDays: 0 }).success).toBe(false);
    expect(updatePayrollRunSchema.safeParse({ actualWorkDays: 2.5 }).success).toBe(false);
    expect(updatePayrollRunSchema.safeParse({ actualWorkDays: 1 }).success).toBe(true);
  });

  it("edit form rejects 0 and anything above the days in the period, with the range sentence", () => {
    const base = { periodStart: "2026-09-01", periodEnd: "2026-09-30" };
    expect(payrollEditFormSchema.safeParse({ ...base, actualWorkDays: "0" }).success).toBe(false);
    const over = payrollEditFormSchema.safeParse({ ...base, actualWorkDays: "999" });
    expect(over.success).toBe(false);
    if (!over.success) {
      expect(over.error.issues.find((i) => i.path[0] === "actualWorkDays")?.message).toBe(
        "Hari kerja aktual harus antara 1 dan 30 hari.",
      );
    }
    expect(payrollEditFormSchema.safeParse({ ...base, actualWorkDays: "22" }).success).toBe(true);
    expect(payrollEditFormSchema.safeParse({ ...base, actualWorkDays: "30" }).success).toBe(true);
  });
});

describe("HRX-4 adjustment bounds", () => {
  const note = { adjustmentNote: "x" };

  it("rejects fractional amounts (BSI export expects whole rupiah)", () => {
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: 0.5, ...note }).success).toBe(false);
    expect(adjustPayrollLineFormSchema.safeParse({ adjustmentAmount: "100.5", ...note }).success).toBe(false);
  });

  it("caps the magnitude at Rp 1.000.000.000 in both directions", () => {
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: 1_000_000_000, ...note }).success).toBe(true);
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: -1_000_000_000, ...note }).success).toBe(true);
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: 1_000_000_001, ...note }).success).toBe(false);
    expect(adjustPayrollLineSchema.safeParse({ adjustmentAmount: -1e15, ...note }).success).toBe(false);
    const form = adjustPayrollLineFormSchema.safeParse({ adjustmentAmount: "1e15", ...note });
    expect(form.success).toBe(false);
    if (!form.success) expect(form.error.issues[0].message).toBe("Penyesuaian maksimal Rp 1.000.000.000");
  });

  it("bounds variable day counts so an absurd value never reaches the Int column", () => {
    const r = payrollVariablesSchema.safeParse({ overtimeHours: 0, outdoorDays: 99999999999, holidayWorkedDays: 0, dcDays: 0 });
    expect(r.success).toBe(false);
  });
});
