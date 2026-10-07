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
