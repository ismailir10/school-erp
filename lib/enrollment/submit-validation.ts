import { z } from "zod";
import { optionalTrimmed } from "@/lib/validations/zod-helpers";
import { programIdSchema } from "@/lib/validations/program-id";
import { CONSENT_VERSION } from "./consent-clauses";
import {
  AGAMA_VALUES,
  KEWARGANEGARAAN_VALUES,
  LIVING_WITH_VALUES,
  BIRTH_DELIVERY_VALUES,
  BIRTH_TERM_VALUES,
  BLOOD_TYPE_VALUES,
  EDUCATION_VALUES,
  OCCUPATION_VALUES,
  INCOME_VALUES,
  MAX_PRIOR_FAMILY_ATTENDEES,
} from "./constants";

// Mirrors lib/admission/submit-validation.ts shapes — same phone/date
// regexes, same optionalTrimmed pattern, same flatten helper — so the rich
// enrollment form validates consistently with the thin /daftar inquiry.
const PHONE_REGEX = /^[+\d\s\-()]{6,20}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Required membership in an option Set (from constants.ts). */
const inSet = (set: Set<string>, msg: string) =>
  z
    .string({ error: msg })
    .trim()
    .refine((v) => set.has(v), msg);

/** Optional membership — empty/unfilled selects pass; non-empty must be valid. */
const optInSet = (set: Set<string>, msg: string) =>
  optionalTrimmed(z.string().refine((v) => set.has(v), msg));

/** Optional non-negative number — "" / null / undefined become undefined. */
const optNumber = (msg: string, max?: { value: number; msg: string }) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    (max
      ? z.coerce.number({ error: msg }).min(0, msg).max(max.value, max.msg)
      : z.coerce.number({ error: msg }).min(0, msg)
    ).optional(),
  );

// Kode pos is deliberately lenient here (any text up to 10): drafts autosaved before the
// parent form enforced 5 digits must still submit, and staff may fix an odd value in
// "Ubah data". The parent form (`components/enrollment/address-fields.tsx`) takes digits
// only and blocks Lanjut on a partial code; the server never rejects an old blob for it.
const addressSchema = z
  .object({
    perumahan: optionalTrimmed(z.string().max(120)),
    blokCluster: optionalTrimmed(z.string().max(60)),
    rtRw: optionalTrimmed(z.string().max(20)),
    kelurahan: optionalTrimmed(z.string().max(80)),
    kecamatan: optionalTrimmed(z.string().max(80)),
    kotaKab: optionalTrimmed(z.string().max(80)),
    provinsi: optionalTrimmed(z.string().max(60)),
    kodePos: optionalTrimmed(z.string().max(10)),
  })
  .optional();

const priorFamilyAttendeeSchema = z.object({
  name: optionalTrimmed(z.string().max(80)),
  yearEntered: optionalTrimmed(z.string().max(9)),
});

const studentSchema = z.object({
  childName: z.string({ error: "Nama lengkap anak wajib diisi" }).trim().min(1, "Nama lengkap anak wajib diisi").max(80, "Nama terlalu panjang"),
  nickname: optionalTrimmed(z.string().max(40)),
  childGender: z.enum(["L", "P"], { error: "Pilih jenis kelamin" }),
  birthPlace: z.string({ error: "Tempat lahir wajib diisi" }).trim().min(1, "Tempat lahir wajib diisi").max(80),
  dateOfBirth: z.string({ error: "Tanggal lahir wajib diisi (format YYYY-MM-DD)" }).regex(ISO_DATE_REGEX, "Tanggal lahir wajib diisi (format YYYY-MM-DD)"),
  agama: inSet(AGAMA_VALUES, "Pilih agama"),
  kewarganegaraan: inSet(KEWARGANEGARAAN_VALUES, "Pilih kewarganegaraan"),
  bloodType: optInSet(BLOOD_TYPE_VALUES, "Golongan darah tidak valid"),
  livingWith: optInSet(LIVING_WITH_VALUES, "Pilihan tempat tinggal tidak valid"),
  birthDelivery: optInSet(BIRTH_DELIVERY_VALUES, "Pilihan jalan lahir tidak valid"),
  birthTerm: optInSet(BIRTH_TERM_VALUES, "Pilihan bulan lahir tidak valid"),
  homeLanguage: optionalTrimmed(z.string().max(60)),
  foodAllergy: optionalTrimmed(z.string().max(200)),
  seriousIllness: optionalTrimmed(z.string().max(200)),
  // ADM-14: the parent form accepted 9999 cm. Same ceilings as the raport editor.
  weightKg: optNumber("Berat badan tidak valid", { value: 200, msg: "Berat maksimal 200 kg" }),
  heightCm: optNumber("Tinggi badan tidak valid", { value: 250, msg: "Tinggi maksimal 250 cm" }),
  headCircumferenceCm: optNumber("Lingkar kepala tidak valid"),
  siblingsKandung: optNumber("Jumlah saudara kandung tidak valid"),
  siblingsTiri: optNumber("Jumlah saudara tiri tidak valid"),
  siblingsAngkat: optNumber("Jumlah saudara angkat tidak valid"),
  childOrder: optNumber("Anak ke- tidak valid"),
  siblingsTotal: optNumber("Jumlah saudara tidak valid"),
  address: addressSchema,
  priorFamilyAttendees: z
    .array(priorFamilyAttendeeSchema)
    .max(MAX_PRIOR_FAMILY_ATTENDEES, `Maksimal ${MAX_PRIOR_FAMILY_ATTENDEES} keluarga`)
    .optional(),
});

export const parentSchema = z.object({
  name: z.string({ error: "Nama wajib diisi" }).trim().min(1, "Nama wajib diisi").max(80, "Nama terlalu panjang"),
  birthPlace: optionalTrimmed(z.string().max(80)),
  dateOfBirth: optionalTrimmed(z.string().regex(ISO_DATE_REGEX, "Tanggal lahir tidak valid (format YYYY-MM-DD)")),
  agama: optInSet(AGAMA_VALUES, "Agama tidak valid"),
  phone: optionalTrimmed(z.string().regex(PHONE_REGEX, "Nomor telepon tidak valid")),
  email: optionalTrimmed(z.string().email("Email tidak valid")),
  address: addressSchema,
  education: optInSet(EDUCATION_VALUES, "Pendidikan tidak valid"),
  occupation: optInSet(OCCUPATION_VALUES, "Pekerjaan tidak valid"),
  employerName: optionalTrimmed(z.string().max(120)),
  employerAddress: optionalTrimmed(z.string().max(160)),
  employerPhone: optionalTrimmed(z.string().regex(PHONE_REGEX, "Nomor telepon kantor tidak valid")),
  income: optInSet(INCOME_VALUES, "Penghasilan tidak valid"),
});

// One parent's signature block within consent. signatureToken is the opaque
// storage token (lib/storage) of the uploaded drawn-signature PNG; the route
// issues it before submit. signedAt is server-stamped — accepted but not trusted.
const consentSignerSchema = z.object({
  name: z.string({ error: "Nama penandatangan wajib diisi" }).trim().min(1, "Nama penandatangan wajib diisi").max(80),
  signatureToken: z.string({ error: "Tanda tangan wajib diisi" }).trim().min(1, "Tanda tangan wajib diisi"),
  signedAt: optionalTrimmed(z.string()),
});

/**
 * R2-P-10: one parent / wali may fill the form alone. `onlyParent` names the one
 * who does ("ayah" or "ibu"; a wali uses whichever block fits); the OTHER side's
 * data block and consent signer are then optional. Lives inside the consentData
 * JSON — no column. Empty string (a cleared form select) means "both parents".
 */
export const ONLY_PARENT_VALUES = ["ayah", "ibu"] as const;
export type OnlyParent = (typeof ONLY_PARENT_VALUES)[number];

const onlyParentSchema = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.enum(ONLY_PARENT_VALUES, { error: "Pilihan orang tua yang mengisi tidak valid" }).optional(),
);

/** True when `side` is the waived one, i.e. the other parent is the only filler. */
export function isSideWaived(only: OnlyParent | "" | null | undefined, side: OnlyParent): boolean {
  return !!only && only !== side;
}

const consentSchema = z.object({
  agreed: z.literal(true, { error: "Persetujuan orang tua wajib dicentang" }),
  version: z
    .string()
    .refine((v) => v === CONSENT_VERSION, "Versi surat persetujuan kedaluwarsa — muat ulang halaman"),
  onlyParent: onlyParentSchema,
  // Optional here only so a waived side may be absent; the superRefine below
  // makes them required again for every side that is not waived.
  ayah: consentSignerSchema.optional(),
  ibu: consentSignerSchema.optional(),
});

/**
 * Full public-submit schema for the rich enrollment form. The route never
 * trusts client-supplied `status`, `accessToken`, `tenantId`, or `studentId`
 * — those are server-owned; Zod strip mode drops any such extra keys.
 */
/**
 * A waived parent's data block is dropped BEFORE validation. The parent form
 * always sends both blocks (`ayahData: { name: "", … }`), so a waived side
 * arrives as a blank — or half-typed, possibly invalid — object, not as a missing
 * key; validating it rejected every single-parent submit ("Nama wajib diisi" for
 * a parent who was skipped on purpose). Only the shape of the flag is read here;
 * an invalid flag is left for `consentSchema` to report.
 */
function dropWaivedParentData(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const body = input as Record<string, unknown>;
  const consent = body.consentData;
  const only = consent && typeof consent === "object" ? (consent as Record<string, unknown>).onlyParent : undefined;
  if (only !== "ayah" && only !== "ibu") return input;
  const out = { ...body };
  for (const side of ONLY_PARENT_VALUES) {
    if (isSideWaived(only, side)) delete out[`${side}Data`];
  }
  return out;
}

export const submitEnrollmentSchema = z.preprocess(
  dropWaivedParentData,
  z
    .object({
      programId: programIdSchema,
      dcareAddon: z.boolean().optional().default(false),
      studentData: studentSchema,
      ayahData: parentSchema.optional(),
      ibuData: parentSchema.optional(),
      consentData: consentSchema,
    })
    .superRefine((v, ctx) => {
      const only = v.consentData.onlyParent;
      for (const side of ONLY_PARENT_VALUES) {
        if (isSideWaived(only, side)) continue;
        // Re-run the real schemas on `{}` so a missing block reports the same
        // field-level messages ("ayahData.name": "Nama wajib diisi") a blank one does.
        if (v[`${side}Data`] === undefined) {
          const r = parentSchema.safeParse({});
          if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", message: i.message, path: [`${side}Data`, ...i.path] });
        }
        if (v.consentData[side] === undefined) {
          const r = consentSignerSchema.safeParse({});
          if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", message: i.message, path: ["consentData", side, ...i.path] });
        }
      }
    }),
);

/**
 * Staff-edit variants (admin "Ubah data"). Derived from the SAME field schemas as
 * the parent submit, so a value is format-checked identically (phone regex, email,
 * YYYY-MM-DD, option sets, max lengths) — but every field is optional: staff may
 * save a half-filled form, and completeness is the parent's submit gate, not
 * theirs. A blank value is handled by the caller (it means "clear this field")
 * before these run. Unknown keys are stripped by zod's default object mode.
 */
export const staffStudentSchema = studentSchema.partial();
export const staffParentSchema = parentSchema.partial();

/**
 * Staff may only choose who fills the form. `agreed`, `version` and every
 * signature field are evidence the parent writes — they are not editable here
 * and are stripped from anything staff send.
 */
export const staffConsentSchema = z.object({ onlyParent: onlyParentSchema });

/** The fields (top level, and inside `address`) a staff edit may touch. */
export const STAFF_EDITABLE_KEYS = {
  studentData: Object.keys(staffStudentSchema.shape),
  ayahData: Object.keys(staffParentSchema.shape),
  ibuData: Object.keys(staffParentSchema.shape),
  consentData: Object.keys(staffConsentSchema.shape),
  address: Object.keys(addressSchema.unwrap().shape),
} as const;

export type SubmitEnrollmentInput = z.infer<typeof submitEnrollmentSchema>;

/**
 * Flatten a ZodError into `{ "studentData.childName": message }` shape for the
 * 422 response. First error per path wins (sufficient for inline form display).
 */
export function flattenSubmitErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}
