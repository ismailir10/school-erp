import { describe, expect, it } from "vitest";
import {
  academicYearFormSchema,
  createAcademicYearSchema,
  updateAcademicYearSchema,
} from "../academic-year";

describe("createAcademicYearSchema", () => {
  const valid = {
    name: "2025/2026",
    startDate: "2025-07-01",
    endDate: "2026-06-30",
  };

  it("accepts a valid input without status", () => {
    const r = createAcademicYearSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("trims the name", () => {
    const r = createAcademicYearSchema.safeParse({ ...valid, name: "  2025/2026  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("2025/2026");
  });

  it("rejects an empty name", () => {
    const r = createAcademicYearSchema.safeParse({ ...valid, name: "   " });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed startDate", () => {
    const r = createAcademicYearSchema.safeParse({ ...valid, startDate: "01-07-2025" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing endDate", () => {
    const { endDate: _omit, ...noEnd } = valid;
    void _omit;
    const r = createAcademicYearSchema.safeParse(noEnd);
    expect(r.success).toBe(false);
  });

  it("rejects an end date before the start date, on endDate (ADM-13)", () => {
    const r = createAcademicYearSchema.safeParse({ ...valid, endDate: "2025-06-30" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["endDate"]);
      expect(r.error.issues[0].message).toBe("Tanggal selesai harus setelah tanggal mulai");
    }
  });

  it("accepts an equal start and end date", () => {
    expect(createAcademicYearSchema.safeParse({ ...valid, endDate: valid.startDate }).success).toBe(true);
  });

  it("accepts the canonical status values and rejects unknown ones", () => {
    for (const status of ["PLANNING", "ACTIVE", "ARCHIVED"]) {
      expect(createAcademicYearSchema.safeParse({ ...valid, status }).success).toBe(true);
    }
    expect(createAcademicYearSchema.safeParse({ ...valid, status: "DONE" }).success).toBe(false);
  });
});

describe("updateAcademicYearSchema", () => {
  it("accepts a partial update (status only)", () => {
    const r = updateAcademicYearSchema.safeParse({ status: "ACTIVE" });
    expect(r.success).toBe(true);
  });

  it("accepts an empty object (no-op update)", () => {
    expect(updateAcademicYearSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an inverted range when both dates are supplied", () => {
    const r = updateAcademicYearSchema.safeParse({ startDate: "2026-07-01", endDate: "2026-06-30" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["endDate"]);
  });

  it("allows a single date through (the route checks it against the stored range)", () => {
    expect(updateAcademicYearSchema.safeParse({ endDate: "2020-01-01" }).success).toBe(true);
  });

  it("still validates date format when a date is supplied", () => {
    expect(updateAcademicYearSchema.safeParse({ startDate: "bad" }).success).toBe(false);
  });
});

describe("academicYearFormSchema", () => {
  const valid = {
    name: "2025/2026",
    startDate: "2025-07-01",
    endDate: "2026-06-30",
  };

  it("accepts a valid range", () => {
    expect(academicYearFormSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an equal start/end date (end >= start)", () => {
    const r = academicYearFormSchema.safeParse({ ...valid, endDate: valid.startDate });
    expect(r.success).toBe(true);
  });

  it("rejects an end date before the start date, on endDate", () => {
    const r = academicYearFormSchema.safeParse({ ...valid, endDate: "2025-01-01" });
    expect(r.success).toBe(false);
    if (!r.success) {
      // Exactly one issue: the form reuses the create schema's refine, so the
      // field must not show the message twice.
      expect(r.error.issues).toHaveLength(1);
      const issue = r.error.issues[0];
      expect(issue.path).toEqual(["endDate"]);
      expect(issue.message).toMatch(/setelah tanggal mulai/);
    }
  });

  it("still enforces the base schema's rules (e.g. required name)", () => {
    const { name: _omit, ...noName } = valid;
    void _omit;
    expect(academicYearFormSchema.safeParse(noName).success).toBe(false);
  });
});
