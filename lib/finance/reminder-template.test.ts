import { describe, it, expect } from "vitest";
import {
  DEFAULT_REMINDER_TEMPLATE,
  MAX_REMINDER_TEMPLATE_LENGTH,
  REMINDER_PLACEHOLDERS,
  effectiveReminderTemplate,
  renderReminderTemplate,
  sampleReminderValues,
  validateReminderTemplate,
} from "./reminder-template";
import { invoiceReminderText } from "./invoice-reminder";

const values = {
  wali: "Bapak/Ibu Siti",
  siswa: "Aisyah",
  periode: "SPP Oktober 2026",
  nomor: "INV-1",
  sisa: "Rp 450.000",
  tautan: "https://pay.example/1",
};

describe("renderReminderTemplate", () => {
  it("fills every placeholder, repeats included", () => {
    expect(renderReminderTemplate("{siswa} / {siswa}: {sisa} di {tautan}", values)).toBe(
      "Aisyah / Aisyah: Rp 450.000 di https://pay.example/1",
    );
  });
  it("is a single pass: braces inside a value are not expanded", () => {
    expect(renderReminderTemplate("{wali} {tautan}", { ...values, wali: "{sisa}" })).toBe("{sisa} https://pay.example/1");
  });
  it("leaves an unknown placeholder as typed", () => {
    expect(renderReminderTemplate("{nama}", values)).toBe("{nama}");
  });
});

describe("validateReminderTemplate", () => {
  it("accepts the default", () => {
    expect(validateReminderTemplate(DEFAULT_REMINDER_TEMPLATE)).toBeNull();
  });
  it("names every unknown placeholder once", () => {
    expect(validateReminderTemplate("{sisaa} {sisaa} {x} {tautan}")).toBe(
      "Isian {sisaa}, {x} tidak dikenal. Gunakan tombol isian di atas kolom pesan.",
    );
  });
  it("requires {tautan}", () => {
    expect(validateReminderTemplate("Halo {wali}")).toMatch(/harus memuat \{tautan\}/);
  });
  it("caps the length", () => {
    const long = `{tautan}${"a".repeat(MAX_REMINDER_TEMPLATE_LENGTH)}`;
    expect(validateReminderTemplate(long)).toMatch(/terlalu panjang/);
    expect(validateReminderTemplate(long.slice(0, MAX_REMINDER_TEMPLATE_LENGTH))).toBeNull();
  });
});

describe("effectiveReminderTemplate", () => {
  it("falls back to the default for null, empty and blank", () => {
    for (const v of [null, undefined, "", "  \n "]) expect(effectiveReminderTemplate(v)).toBe(DEFAULT_REMINDER_TEMPLATE);
  });
  it("keeps a stored template", () => {
    expect(effectiveReminderTemplate("Halo {tautan}")).toBe("Halo {tautan}");
  });
});

describe("sampleReminderValues", () => {
  it("covers every placeholder, so the preview never shows a raw {key}", () => {
    const text = renderReminderTemplate(DEFAULT_REMINDER_TEMPLATE, sampleReminderValues());
    for (const p of REMINDER_PLACEHOLDERS) expect(text).not.toContain(`{${p.key}}`);
  });
});

describe("default parity", () => {
  // The exact message sent before schools could edit it: a school that never edits must not notice.
  it("renders byte-for-byte what the hard-coded message used to say", () => {
    const legacy = [
      "Assalamu'alaikum Bapak/Ibu Siti.",
      "Tagihan SPP Oktober 2026 untuk ananda Aisyah (INV-1) masih tersisa Rp 450.000.",
      "Bapak/Ibu bisa membayarnya lewat tautan berikut: https://pay.example/1",
      "Jika sudah membayar, mohon abaikan pesan ini. Jazakumullah khairan.",
    ].join("\n\n");
    const text = invoiceReminderText({
      guardianName: "Siti",
      studentName: "Aisyah",
      invoiceNumber: "INV-1",
      periodLabel: "SPP Oktober 2026",
      remaining: 450_000,
      payUrl: "https://pay.example/1",
    });
    expect(text.replace(/ /g, " ")).toBe(legacy);
  });
  it("uses the school's template when given", () => {
    const text = invoiceReminderText({
      guardianName: "",
      studentName: "Aisyah",
      invoiceNumber: "INV-1",
      periodLabel: "SPP Oktober 2026",
      remaining: 450_000,
      payUrl: "https://pay.example/1",
      template: "Halo {wali}, {siswa} belum bayar. {tautan}",
    });
    expect(text).toBe("Halo Bapak/Ibu, Aisyah belum bayar. https://pay.example/1");
  });
});
