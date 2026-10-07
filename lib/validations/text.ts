import { z } from "zod";

/**
 * Shared text bounds for free-text API inputs (STR-7).
 *
 * Before this, `z.string().min(1)` accepted a 200,000-character student name
 * (portals grew millions of pixels wide), a NUL byte reached Postgres and came
 * back as an opaque 500 ("invalid byte sequence 0x00"), and API callers' names
 * were stored untrimmed. Every helper here returns a plain `ZodString`, so it
 * drops into the existing `.optional()` / `.nullable()` / `.extend()` /
 * `optionalTrimmed()` call sites without changing their optional semantics.
 *
 * Deliberately no `.default()` anywhere: a default inside `.partial()` resets
 * stored columns on a PATCH (see `partialWithoutDefaults`).
 */

export const NAME_MAX = 120;
export const LABEL_MAX = 200;
export const LONG_TEXT_MAX = 2000;

/** C0 controls except TAB / LF / CR, plus DEL. NUL is the one Postgres rejects. */
export const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const CONTROL_CHARS_GLOBAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const LINE_BREAKS = new RegExp("[\\n\\r\\u2028\\u2029]");

export const INVALID_TEXT_MESSAGE = "Teks berisi karakter yang tidak valid.";
export const SINGLE_LINE_MESSAGE = "Teks harus satu baris.";

export function maxMessage(max: number): string {
  return `Maksimal ${max} karakter.`;
}

export type CleanTextOptions = {
  /** Maximum length after trimming. */
  max: number;
  /**
   * When set, the value must be non-empty after trimming and this is the
   * message. Omit for an optional-ish field that may legitimately be "".
   */
  required?: string;
  /** Reject line breaks too (names, short labels). */
  singleLine?: boolean;
};

/**
 * string → trim → (non-empty) → no control characters → max length.
 * Messages are Indonesian; none of them echo the raw input.
 */
export function cleanText({ max, required, singleLine = false }: CleanTextOptions) {
  let schema = z.string().trim();
  if (required !== undefined) schema = schema.min(1, required);
  schema = schema.refine((v) => !CONTROL_CHARS.test(v), INVALID_TEXT_MESSAGE);
  if (singleLine) schema = schema.refine((v) => !LINE_BREAKS.test(v), SINGLE_LINE_MESSAGE);
  return schema.max(max, maxMessage(max));
}

/** Person / entity name, single line, max 120. */
export function nameText(opts: { required?: string; max?: number } = {}) {
  return cleanText({ max: opts.max ?? NAME_MAX, required: opts.required, singleLine: true });
}

/** Short label (job title, period label, bank name, …), single line, max 200. */
export function labelText(opts: { required?: string; max?: number } = {}) {
  return cleanText({ max: opts.max ?? LABEL_MAX, required: opts.required, singleLine: true });
}

/** Notes / addresses / reasons — multi-line allowed, max 2000. */
export function longText(opts: { required?: string; max?: number } = {}) {
  return cleanText({ max: opts.max ?? LONG_TEXT_MAX, required: opts.required });
}

/** Remove control characters (incl. NUL) — for query-string search terms. */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS_GLOBAL, "");
}
