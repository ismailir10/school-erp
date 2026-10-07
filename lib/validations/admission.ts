import { z } from "zod";
import { optionalTrimmed, optionalEnum, partialWithoutDefaults } from "./zod-helpers";
import { cleanText, labelText, longText, nameText } from "./text";

const short = (max: number) => cleanText({ max, singleLine: true });

/**
 * Admin-side create/update schemas for Admission rows.
 *
 * Every optional string field uses `optionalTrimmed` so an empty-string
 * payload from an unfilled HTML input (e.g. `parentEmail: ""`) is coerced
 * to `undefined` before the inner validator runs. Without this, `.email()`
 * on `""` returns "Email tidak valid" and admin edits 400 — see
 * `docs/cycles/archive/2026-05-11-admin-admissions-empty-string-fix.md`.
 *
 * `childAge` is NOT exposed here — it is auto-derived from `dateOfBirth`
 * via `lib/admission/age.ts:formatAgeFromDob` at display time. The schema
 * column stays in `prisma/schema.prisma` for backward compatibility with
 * legacy rows, but new writes never set it.
 */
export const createAdmissionSchema = z.object({
  childName: nameText({ required: "Nama anak wajib diisi" }),
  // optionalEnum: form `<Select>` whose value is "" must coerce to undefined
  // before z.enum() runs; .optional() alone only allows undefined, not "".
  childGender: optionalEnum(z.enum(["L", "P"])),
  dateOfBirth: optionalTrimmed(short(32)),
  parentName: nameText({ required: "Nama orang tua wajib diisi" }),
  parentPhone: optionalTrimmed(short(30)),
  parentEmail: optionalTrimmed(z.string().email("Email tidak valid").max(254, "Maksimal 254 karakter.")),
  parentWhatsapp: optionalTrimmed(short(30)),
  parentEducation: optionalTrimmed(labelText({ max: 100 })),
  parentOccupation: optionalTrimmed(labelText({ max: 100 })),
  parentIncome: optionalTrimmed(short(50)),
  parentRelationship: optionalEnum(z.enum(["AYAH", "IBU", "WALI", "OTHER"])),
  programId: optionalTrimmed(short(64)),
  // Campus ID — preferred campus for the resulting enrollment when convert
  // creates one. Convert today only creates Student + Parent, so per cycle
  // assumption #3 this value is stashed on Student.metadata.campusPreference
  // during convert (T11). Optional so existing admissions without a campus
  // preference still round-trip cleanly.
  campusPreference: optionalTrimmed(short(64)),
  source: z.enum(["WHATSAPP", "WALK_IN", "WEBSITE", "REFERRAL", "OTHER"]).default("WALK_IN"),
  notes: optionalTrimmed(longText()),
  followUpDate: optionalTrimmed(short(32)),
});

// partialWithoutDefaults: a bare `.partial()` keeps `source`'s WALK_IN default in
// Zod 4, so a status-only PUT reset the lead source (CORE-1 / X-2).
export const updateAdmissionSchema = partialWithoutDefaults(createAdmissionSchema).extend({
  status: z.enum(["INQUIRY", "VISIT_SCHEDULED", "VISITED", "ADMITTED", "CANCELLED"]).optional(),
});

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
