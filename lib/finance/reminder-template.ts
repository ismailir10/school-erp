/**
 * The school's own wording for the unpaid-invoice WhatsApp reminder (cycle
 * 2026-10-23-reminder-template). Pure and client-safe: the settings page uses it
 * for the live preview, the routes and the invoice page to write the real message.
 *
 * A template is plain text with `{placeholders}`. Rendering is a single pass, so a
 * value that happens to contain braces (a guardian called "{sisa}") is never expanded.
 */

export const REMINDER_PLACEHOLDERS = [
  { key: "wali", label: "Nama wali", sample: "Bapak/Ibu Budi" },
  { key: "siswa", label: "Nama anak", sample: "Aisyah" },
  { key: "periode", label: "Periode tagihan", sample: "Oktober 2026" },
  { key: "nomor", label: "Nomor tagihan", sample: "INV-2610-0001" },
  { key: "sisa", label: "Sisa tagihan", sample: "Rp 1.250.000" },
  { key: "tautan", label: "Tautan pembayaran", sample: "https://bayar.example/abc123" },
] as const;

export type ReminderPlaceholderKey = (typeof REMINDER_PLACEHOLDERS)[number]["key"];
export type ReminderValues = Record<ReminderPlaceholderKey, string>;

/** WhatsApp links with very long prefilled text stop opening on some phones. */
export const MAX_REMINDER_TEMPLATE_LENGTH = 1000;

/** The message every school gets until it writes its own. */
export const DEFAULT_REMINDER_TEMPLATE = [
  "Assalamu'alaikum {wali}.",
  "Tagihan {periode} untuk ananda {siswa} ({nomor}) masih tersisa {sisa}.",
  "Bapak/Ibu bisa membayarnya lewat tautan berikut: {tautan}",
  "Jika sudah membayar, mohon abaikan pesan ini. Jazakumullah khairan.",
].join("\n\n");

const TOKEN = /\{([^{}]*)\}/g;
const KEYS: ReadonlySet<string> = new Set(REMINDER_PLACEHOLDERS.map((p) => p.key));

/** The stored template, or the default when the school has none (or only blanks). */
export function effectiveReminderTemplate(stored: string | null | undefined): string {
  return stored && stored.trim() ? stored : DEFAULT_REMINDER_TEMPLATE;
}

/** Fills every known placeholder; an unknown `{x}` stays as typed (validation keeps it from being saved). */
export function renderReminderTemplate(template: string, values: ReminderValues): string {
  return template.replace(TOKEN, (whole, key: string) => (KEYS.has(key) ? values[key as ReminderPlaceholderKey] : whole));
}

/** Sample data for the settings preview. */
export function sampleReminderValues(): ReminderValues {
  return Object.fromEntries(REMINDER_PLACEHOLDERS.map((p) => [p.key, p.sample])) as ReminderValues;
}

/** An Indonesian message for the first thing wrong with `template`, or null when it can be saved. */
export function validateReminderTemplate(template: string): string | null {
  if (template.length > MAX_REMINDER_TEMPLATE_LENGTH) {
    return `Pesan terlalu panjang (maksimal ${MAX_REMINDER_TEMPLATE_LENGTH} karakter).`;
  }
  const unknown = [...template.matchAll(TOKEN)].map((m) => m[1]!).filter((k) => !KEYS.has(k));
  if (unknown.length > 0) {
    const names = [...new Set(unknown)].map((k) => `{${k}}`).join(", ");
    return `Isian ${names} tidak dikenal. Gunakan tombol isian di atas kolom pesan.`;
  }
  if (!template.includes("{tautan}")) {
    return "Pesan harus memuat {tautan} agar orang tua tahu ke mana membayar.";
  }
  return null;
}
