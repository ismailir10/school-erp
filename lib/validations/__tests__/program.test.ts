import { describe, expect, it } from "vitest";
import {
  createProgramSchema,
  programFormSchema,
  updateProgramSchema,
} from "../program";

describe("createProgramSchema", () => {
  const valid = { code: "TKIT", name: "TK Islam Terpadu" };

  it("accepts a minimal valid input and defaults type to SEMESTER", () => {
    const r = createProgramSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.type).toBe("SEMESTER");
  });

  it("rejects a missing code", () => {
    expect(createProgramSchema.safeParse({ name: "TK Islam Terpadu" }).success).toBe(false);
  });

  it("rejects a missing name", () => {
    expect(createProgramSchema.safeParse({ code: "TKIT" }).success).toBe(false);
  });

  // Program.ageMin/ageMax are stored in MONTHS — seed data goes up to 84
  // (TKIT, 7 tahun). The schema previously capped at 30 (assuming years),
  // which would have rejected every real PAUD/TK program the moment this
  // schema was wired onto POST /api/programs.
  it("accepts an ageMax reflecting the seed data (84 bulan / 7 tahun)", () => {
    const r = createProgramSchema.safeParse({ ...valid, ageMin: 48, ageMax: 84 });
    expect(r.success).toBe(true);
  });

  it("rejects a negative or absurdly large age in months", () => {
    expect(createProgramSchema.safeParse({ ...valid, ageMin: -1 }).success).toBe(false);
    expect(createProgramSchema.safeParse({ ...valid, ageMax: 301 }).success).toBe(false);
  });

  it("accepts a null ageMin/ageMax", () => {
    const r = createProgramSchema.safeParse({ ...valid, ageMin: null, ageMax: null });
    expect(r.success).toBe(true);
  });
});

describe("updateProgramSchema", () => {
  it("accepts a partial update (status only)", () => {
    expect(updateProgramSchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
  });

  it("accepts the same 84-bulan ageMax the create schema allows", () => {
    expect(updateProgramSchema.safeParse({ ageMax: 84 }).success).toBe(true);
  });
});

describe("programFormSchema", () => {
  const valid = { code: "TKIT", name: "TK Islam Terpadu" };

  it("coerces numeric-string ageMin/ageMax from the <Input type='number'> form field", () => {
    const r = programFormSchema.safeParse({ ...valid, ageMin: "48", ageMax: "84" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ageMin).toBe(48);
      expect(r.data.ageMax).toBe(84);
    }
  });

  it("treats an empty-string ageMin/ageMax as null, not 0", () => {
    const r = programFormSchema.safeParse({ ...valid, ageMin: "", ageMax: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ageMin).toBeNull();
      expect(r.data.ageMax).toBeNull();
    }
  });

  it("still requires code and name", () => {
    expect(programFormSchema.safeParse({ code: "", name: "" }).success).toBe(false);
  });
});

describe("program name normalization", () => {
  it("collapses inner whitespace runs and trims the ends on create", () => {
    const r = createProgramSchema.safeParse({ code: "TKIT", name: "  TK  \t B " });
    expect(r.success && r.data.name).toBe("TK B");
  });

  it("does the same on update, and on the admin form schema", () => {
    const u = updateProgramSchema.safeParse({ name: "TK   A" });
    expect(u.success && u.data.name).toBe("TK A");
    const f = programFormSchema.safeParse({ code: "TKIT", name: "TK   A" });
    expect(f.success && f.data.name).toBe("TK A");
  });

  it("leaves an omitted name omitted on a partial update", () => {
    const u = updateProgramSchema.safeParse({ status: "INACTIVE" });
    expect(u.success && "name" in u.data).toBe(false);
  });

  it("treats a whitespace-only name as missing, with the field message", () => {
    const r = createProgramSchema.safeParse({ code: "TKIT", name: "   " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ["name"], message: "Nama wajib diisi" });
  });

  it("applies the 120-character cap after normalizing", () => {
    expect(createProgramSchema.safeParse({ code: "X", name: `${"a ".repeat(60)}` }).success).toBe(true);
    expect(createProgramSchema.safeParse({ code: "X", name: "a".repeat(121) }).success).toBe(false);
  });
});
