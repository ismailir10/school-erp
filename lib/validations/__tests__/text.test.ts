import { describe, it, expect } from "vitest";
import { z } from "zod";
import { cleanText, nameText, labelText, longText, stripControlChars } from "../text";

const messages = (schema: z.ZodTypeAny, value: unknown) => {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("nameText", () => {
  const schema = nameText({ required: "Nama wajib diisi" });

  it.each([
    "Ahmad Fauzi",
    "An Nisaa' Ibrâhim",
    "Siti Nurhaliza binti Abdul-Rahman",
    "Zoë Müller-Çelik",
    "محمد عبد الله",
    "Ni Luh Putu Ayu O'Neil",
  ])("accepts %s", (name) => {
    expect(schema.safeParse(name).success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const r = schema.safeParse("  Aisyah  ");
    expect(r.success && r.data).toBe("Aisyah");
  });

  it("rejects empty and whitespace-only with the required message", () => {
    expect(messages(schema, "")).toEqual(["Nama wajib diisi"]);
    expect(messages(schema, "    ")).toEqual(["Nama wajib diisi"]);
  });

  it("rejects a NUL byte and other control characters", () => {
    expect(messages(schema, "Nul\u0000Byte")).toContain("Teks berisi karakter yang tidak valid.");
    expect(messages(schema, "Bell\u0007")).toContain("Teks berisi karakter yang tidak valid.");
    expect(messages(schema, "Del\u007F")).toContain("Teks berisi karakter yang tidak valid.");
  });

  it("rejects line breaks (single-line)", () => {
    expect(messages(schema, "Nama\nBaris")).toContain("Teks harus satu baris.");
    expect(messages(schema, "Nama\rBaris")).toContain("Teks harus satu baris.");
  });

  it("caps at 120 characters", () => {
    expect(schema.safeParse("A".repeat(120)).success).toBe(true);
    expect(messages(schema, "A".repeat(121))).toEqual(["Maksimal 120 karakter."]);
    expect(schema.safeParse("A".repeat(200_000)).success).toBe(false);
  });

  it("without `required` it still allows an empty string", () => {
    expect(nameText().safeParse("").success).toBe(true);
    expect(nameText().safeParse("   ").success).toBe(true);
  });

  it("keeps optional / nullable semantics when chained", () => {
    const s = nameText().optional().nullable();
    expect(s.safeParse(undefined).success).toBe(true);
    expect(s.safeParse(null).success).toBe(true);
    expect(s.safeParse("Budi").success).toBe(true);
    expect(s.safeParse("Bu\u0000di").success).toBe(false);
  });
});

describe("labelText / longText", () => {
  it("labelText caps at 200 and is single-line", () => {
    expect(labelText().safeParse("x".repeat(200)).success).toBe(true);
    expect(messages(labelText(), "x".repeat(201))).toEqual(["Maksimal 200 karakter."]);
    expect(labelText().safeParse("a\nb").success).toBe(false);
  });

  it("longText caps at 2000, allows newlines and tabs, rejects NUL", () => {
    expect(longText().safeParse("baris 1\nbaris 2\r\n\tbaris 3").success).toBe(true);
    expect(longText().safeParse("x".repeat(2000)).success).toBe(true);
    expect(messages(longText(), "x".repeat(2001))).toEqual(["Maksimal 2000 karakter."]);
    expect(longText().safeParse("a\u0000b").success).toBe(false);
  });

  it("cleanText honours a custom max", () => {
    const s = cleanText({ max: 5 });
    expect(s.safeParse("12345").success).toBe(true);
    expect(messages(s, "123456")).toEqual(["Maksimal 5 karakter."]);
  });
});

describe("stripControlChars", () => {
  it("removes NUL and C0 controls but keeps tab/newline and normal text", () => {
    expect(stripControlChars("a\u0000b\u0001c")).toBe("abc");
    expect(stripControlChars("a\tb\nc")).toBe("a\tb\nc");
    expect(stripControlChars("Ibrâhim")).toBe("Ibrâhim");
  });
});
