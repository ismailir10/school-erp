import { z } from "zod";
import { optionalEnum, optionalTrimmed } from "@/lib/validations/zod-helpers";
import { programIdSchema } from "@/lib/validations/program-id";
import { PHONE_FORMAT_ERROR, WHATSAPP_FORMAT_ERROR, admissionDobError } from "@/lib/validations/admission";

// Phone shape: digits, +, spaces, dashes, parens. 6–20 chars.
// Permissive on purpose — Indonesian families type numbers in many shapes
// ("0812-3456-7890", "+62 812 3456 7890", "(021) 555-1234"). Server-side
// trim happens before this regex matches; client-side input mode="tel".
export const PHONE_REGEX = /^[+\d\s\-()]{6,20}$/;

// ISO date: YYYY-MM-DD only. HTML5 type="date" emits this exact shape.
// We do NOT accept full ISO 8601 timestamps — the existing Admission.dateOfBirth
// is a string column treated as a date-only value.
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Shown when none of phone / WhatsApp / email is filled. Also used by the form. */
export const CONTACT_REQUIRED_ERROR = "Isi minimal satu: No. HP/WhatsApp atau email.";

/**
 * Public-admission submit schema. A short lead: who the parent is and how to
 * reach them. Child data is optional — the full formulir collects it later.
 * Subset of `createAdmissionSchema` (lib/validations/admission.ts) — does NOT
 * expose `source` (server-side hard-codes WEBSITE), `status` (defaults INQUIRY
 * at DB), `studentId`, `tenantId` (server-side findFirst), `parentEducation`,
 * `parentOccupation`, `parentIncome`, or `followUpDate` (admin-only knobs).
 *
 * Zod v4 `z.object()` defaults to strip mode: unknown keys passed in by an
 * attacker (e.g. `source: "REFERRAL"`, `status: "ADMITTED"`, `tenantId: "x"`)
 * are removed from the parsed result, neither rejected nor forwarded. The
 * route never reads them after parse.
 *
 * Empty strings count as "not given" (the form sends "" for unfilled fields).
 */
export const submitAdmissionSchema = z
  .object({
    // `{ error }` on each z.string() is the message for a missing / non-string
    // value — without it Zod's English default ("Invalid input: expected string…")
    // reaches any client that skips the form's own checks (R2-P-13).
    parentName: z
      .string({ error: "Nama orang tua wajib diisi" })
      .trim()
      .min(1, "Nama orang tua wajib diisi")
      .max(80, "Nama orang tua terlalu panjang"),
    parentRelationship: optionalEnum(
      z.enum(["AYAH", "IBU", "WALI"], { error: "Pilih Ayah, Ibu, atau Wali" }),
    ),
    parentPhone: optionalTrimmed(z.string().regex(PHONE_REGEX, PHONE_FORMAT_ERROR)),
    parentWhatsapp: optionalTrimmed(z.string().regex(PHONE_REGEX, WHATSAPP_FORMAT_ERROR)),
    parentEmail: optionalTrimmed(z.string().max(254, "Email tidak valid").email("Email tidak valid")),
    childName: optionalTrimmed(z.string().max(80, "Nama anak terlalu panjang")),
    // The plausible PAUD/TK range (1–8 years as of today, Asia/Jakarta) applies
    // only when a date is actually given — PUBX-2.
    dateOfBirth: optionalTrimmed(
      z
        .string()
        .regex(ISO_DATE_REGEX, "Tanggal lahir tidak valid (format YYYY-MM-DD)")
        .superRefine((value, ctx) => {
          const message = admissionDobError(value);
          if (message) ctx.addIssue({ code: "custom", message });
        }),
    ),
    childGender: optionalEnum(z.enum(["L", "P"], { error: "Pilih jenis kelamin" })),
    programId: optionalTrimmed(programIdSchema.max(64, "Program tidak valid")),
    notes: optionalTrimmed(z.string().max(500, "Catatan terlalu panjang (maksimal 500 karakter)")),
  })
  // At least one way to reach the family. Reported under `contact` so the form
  // can show it next to the contact fields instead of on one specific input.
  .superRefine((data, ctx) => {
    if (!data.parentPhone && !data.parentWhatsapp && !data.parentEmail) {
      ctx.addIssue({ code: "custom", path: ["contact"], message: CONTACT_REQUIRED_ERROR });
    }
  });

export type SubmitAdmissionInput = z.infer<typeof submitAdmissionSchema>;

/**
 * Flatten Zod error into a `{ fieldName: message }` shape for the 400 response.
 * One message per field — first error wins (sufficient for inline form display).
 */
export function flattenSubmitErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}
