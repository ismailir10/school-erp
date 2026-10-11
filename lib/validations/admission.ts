import { z } from "zod";
import { optionalTrimmed, optionalEnum, partialWithoutDefaults } from "./zod-helpers";
import { cleanText, longText, nameText } from "./text";

const short = (max: number) => cleanText({ max, singleLine: true });

/** Shown when a lead has no way to reach the family. Shared by the schema, the PUT merge check and the tests. */
export const ADMISSION_CONTACT_REQUIRED = "Isi minimal satu kontak: No. HP, WhatsApp atau Email";

/**
 * Admin-side create/update schemas for Admission rows ("Catat Pertanyaan").
 *
 * A lead is "who and how to reach them": parent name + at least one contact are
 * required; everything about the child is optional. Removed from the lead on
 * 2026-10-11 (columns stay in Prisma, nothing writes them): parentEducation,
 * parentOccupation, parentIncome, campusPreference, followUpDate. `source` is no
 * longer client-writable either — staff-created leads are always WALK_IN and the
 * public /daftar route sets WEBSITE. Unknown keys are stripped (zod default), so
 * an old client that still sends them keeps working.
 *
 * Every optional string field uses `optionalTrimmed` so an empty-string
 * payload from an unfilled HTML input (e.g. `parentEmail: ""`) is coerced
 * to `undefined` before the inner validator runs. Without this, `.email()`
 * on `""` returns "Email tidak valid" and admin edits 400 — see
 * `docs/cycles/archive/2026-05-11-admin-admissions-empty-string-fix.md`.
 * Because blank collapses to `undefined`, the PUT route decides "was this key
 * sent?" from the raw body, not from the parsed value (that is how a field is
 * cleared).
 *
 * `childAge` is NOT exposed here — it is auto-derived from `dateOfBirth`
 * via `lib/admission/age.ts:formatAgeFromDob` at display time.
 */
function isRealIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

const admissionFieldsSchema = z.object({
  parentName: nameText({ required: "Nama orang tua wajib diisi" }),
  // optionalEnum: form `<Select>` whose value is "" must coerce to undefined
  // before z.enum() runs; .optional() alone only allows undefined, not "".
  parentRelationship: optionalEnum(z.enum(["AYAH", "IBU", "WALI", "OTHER"])),
  parentPhone: optionalTrimmed(short(30)),
  parentWhatsapp: optionalTrimmed(short(30)),
  parentEmail: optionalTrimmed(z.string().email("Email tidak valid").max(254, "Maksimal 254 karakter.")),
  // The DB column is NOT NULL, so an absent child name is stored as "".
  childName: optionalTrimmed(nameText()),
  childGender: optionalEnum(z.enum(["L", "P"])),
  // Format + real calendar day only; the age range is a public-form rule (admissionDobError), not an admin one.
  dateOfBirth: optionalTrimmed(short(32).refine(isRealIsoDate, "Tanggal lahir tidak valid")),
  programId: optionalTrimmed(short(64)),
  notes: optionalTrimmed(longText()),
});

/** True when at least one of phone / WhatsApp / email carries a value. */
export function hasAdmissionContact(v: {
  parentPhone?: string | null;
  parentWhatsapp?: string | null;
  parentEmail?: string | null;
}): boolean {
  return Boolean(v.parentPhone?.trim() || v.parentWhatsapp?.trim() || v.parentEmail?.trim());
}

export const createAdmissionSchema = admissionFieldsSchema.refine(hasAdmissionContact, {
  // On the first contact field so the inline error lands next to the inputs.
  path: ["parentPhone"],
  message: ADMISSION_CONTACT_REQUIRED,
});

// Built from the un-refined object: a partial body (status change, one field)
// must not need a contact. The PUT route re-checks the MERGED row instead.
export const updateAdmissionSchema = partialWithoutDefaults(admissionFieldsSchema).extend({
  status: z.enum(["INQUIRY", "VISIT_SCHEDULED", "VISITED", "ADMITTED", "CANCELLED"]).optional(),
});

// ── Public inquiry: phone messages (R2-P-13) ─────────────────────────────────
// Shared by /daftar's inline validation and the API schema so both say the same
// thing, including a format example (the bare "tidak valid" told parents nothing).
export const PHONE_FORMAT_ERROR = "Nomor telepon tidak valid. Contoh: 0812 3456 7890";
export const WHATSAPP_FORMAT_ERROR = "Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890";

// ── Public inquiry: plausible birth date (PUBX-2) ────────────────────────────
// /daftar serves PAUD/TK/Day Care, so a child is between 1 and 8 years old
// (completed) today. Dates are YYYY-MM-DD strings compared lexicographically;
// "today" is the Asia/Jakarta calendar day so a late-evening submit is judged
// by the school's date, not the server's UTC one.
export const ADMISSION_MIN_AGE_YEARS = 1;
export const ADMISSION_MAX_AGE_YEARS = 8;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's calendar date in Asia/Jakarta as YYYY-MM-DD. */
export function todayInJakarta(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Shift an ISO date by whole years, clamping 29 Feb to 28 Feb on non-leap years. */
function shiftYears(iso: string, years: number): string {
  const m = ISO_DATE.exec(iso)!;
  const y = Number(m[1]) + years;
  const mo = Number(m[2]);
  const d = Math.min(Number(m[3]), daysInMonth(y, mo));
  return `${String(y).padStart(4, "0")}-${m[2]}-${String(d).padStart(2, "0")}`;
}

/**
 * Inclusive `min`/`max` for the birth-date input: the oldest date that is still
 * 8 (has not turned 9 yet) and the latest date that is already 1 year old.
 */
export function admissionDobBounds(today: string = todayInJakarta()): { min: string; max: string } {
  const turnsNine = shiftYears(today, -(ADMISSION_MAX_AGE_YEARS + 1));
  // Born on `turnsNine` or earlier means already 9 → one day later is the earliest allowed.
  const next = new Date(`${turnsNine}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    min: next.toISOString().slice(0, 10),
    max: shiftYears(today, -ADMISSION_MIN_AGE_YEARS),
  };
}

/** Indonesian error for an implausible birth date, or `null` when it is fine. */
export function admissionDobError(dob: string, today: string = todayInJakarta()): string | null {
  const m = ISO_DATE.exec(dob);
  if (!m) return "Tanggal lahir tidak valid";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return "Tanggal lahir tidak valid";
  if (dob > today) return "Tanggal lahir tidak boleh di masa depan";
  const { min, max } = admissionDobBounds(today);
  if (dob > max) return `Usia ananda minimal ${ADMISSION_MIN_AGE_YEARS} tahun`;
  if (dob < min) return `Usia ananda maksimal ${ADMISSION_MAX_AGE_YEARS} tahun`;
  return null;
}
