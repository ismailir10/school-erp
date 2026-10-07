import { z } from "zod";

/**
 * Numeric and date bounds shared by money / calendar inputs (STR-13).
 */

export const RUPIAH_MIN = 1;
export const RUPIAH_MAX = 1_000_000_000;

const RUPIAH_MIN_MESSAGE = "Nominal minimal Rp 1.";
const RUPIAH_MAX_MESSAGE = "Nominal maksimal Rp 1.000.000.000.";
const RUPIAH_INT_MESSAGE = "Nominal harus bilangan bulat rupiah.";

/**
 * A rupiah amount: whole rupiah, Rp 1 … Rp 1.000.000.000. Rupiah has no cents
 * in this codebase (every adjustment/rounding path rounds to 0 dp), so a
 * fractional value is a mistake — `0.001` used to book a Rp 0 payment and
 * `1e13` overflowed `Decimal(15,2)` into a 500.
 *
 * The base is a plain `z.number()`; callers that receive strings (HTML inputs
 * posting verbatim) wrap it with `z.coerce` via {@link rupiahAmountCoerced}.
 */
export function rupiahAmount(messages: { min?: string; max?: string; int?: string } = {}) {
  return z
    .number()
    .min(RUPIAH_MIN, messages.min ?? RUPIAH_MIN_MESSAGE)
    .int(messages.int ?? RUPIAH_INT_MESSAGE)
    .max(RUPIAH_MAX, messages.max ?? RUPIAH_MAX_MESSAGE);
}

/** Same bounds, but accepts numeric strings (`z.coerce.number()` semantics). */
export function rupiahAmountCoerced(messages: { min?: string; max?: string; int?: string } = {}) {
  return z.coerce
    .number()
    .min(RUPIAH_MIN, messages.min ?? RUPIAH_MIN_MESSAGE)
    .int(messages.int ?? RUPIAH_INT_MESSAGE)
    .max(RUPIAH_MAX, messages.max ?? RUPIAH_MAX_MESSAGE);
}

export const CALENDAR_DATE_MIN = "2000-01-01";
export const CALENDAR_DATE_MAX = "2100-12-31";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `s` is a real YYYY-MM-DD calendar date (round-trips through UTC). */
export function isRealCalendarDate(s: string): boolean {
  const m = YMD.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
  );
}

/**
 * A YYYY-MM-DD string that is a real calendar date inside a sane window
 * (default 2000-01-01 … 2100-12-31). `2026-02-30` and `1900-01-01` used to pass
 * the bare regex. Returns a plain `ZodString`, so `.min()`-style chaining and
 * `.optional()` keep working. The string is compared lexicographically, which
 * is correct for zero-padded ISO dates.
 */
export function calendarDate(
  messages: { format?: string; invalid?: string; range?: string } = {},
  window: { min?: string; max?: string } = {},
) {
  const min = window.min ?? CALENDAR_DATE_MIN;
  const max = window.max ?? CALENDAR_DATE_MAX;
  return z
    .string()
    .regex(YMD, messages.format ?? "Format tanggal harus YYYY-MM-DD.")
    .refine(isRealCalendarDate, messages.invalid ?? "Tanggal tidak valid.")
    .refine((s) => !isRealCalendarDate(s) || (s >= min && s <= max), messages.range ?? "Tanggal di luar rentang yang wajar.");
}
