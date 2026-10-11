/**
 * Pure logic behind the "Ubah data" editor (`enrollment-application-editor.tsx`):
 * form shape, the client schema, and the diff that becomes the PATCH body.
 *
 * The client schema is DERIVED from the server's staff* schemas
 * (`lib/enrollment/submit-validation.ts`), so a phone, email, date or option is
 * checked here by exactly the rule the API applies. The one difference is
 * blanks: the API treats a blank as "clear this field" before validating, so the
 * derived schema does the same (blank -> undefined) instead of failing on "".
 */
import { z } from "zod";
import { MAX_PRIOR_FAMILY_ATTENDEES } from "@/lib/enrollment/constants";
import { staffConsentSchema, staffParentSchema, staffStudentSchema } from "@/lib/enrollment/submit-validation";

export const ADDRESS_KEYS = ["perumahan", "blokCluster", "rtRw", "kecamatan", "kodePos"] as const;
export const STUDENT_KEYS = [
  "childName",
  "nickname",
  "childGender",
  "birthPlace",
  "dateOfBirth",
  "agama",
  "kewarganegaraan",
  "livingWith",
  "homeLanguage",
  "siblingsKandung",
  "siblingsTiri",
  "siblingsAngkat",
  "childOrder",
  "siblingsTotal",
  "birthDelivery",
  "birthTerm",
  "weightKg",
  "heightCm",
  "headCircumferenceCm",
  "bloodType",
  "foodAllergy",
  "seriousIllness",
] as const;
export const PARENT_KEYS = [
  "name",
  "birthPlace",
  "dateOfBirth",
  "agama",
  "phone",
  "email",
  "education",
  "occupation",
  "income",
  "employerName",
  "employerPhone",
  "employerAddress",
] as const;

type Address = Record<(typeof ADDRESS_KEYS)[number], string>;
export type PriorFamily = { name: string; yearEntered: string };
export type StudentValues = Record<(typeof STUDENT_KEYS)[number], string> & {
  address: Address;
  priorFamilyAttendees: PriorFamily[];
};
export type ParentValues = Record<(typeof PARENT_KEYS)[number], string> & { address: Address };

/** Every field is a string (what an input holds); the API parses and trims. */
export type EditorValues = {
  studentData: StudentValues;
  ayahData: ParentValues;
  ibuData: ParentValues;
  consentData: { onlyParent: string };
  programId: string;
  dcareAddon: boolean;
};

export type EditorSource = {
  studentData: unknown;
  ayahData: unknown;
  ibuData: unknown;
  consentData: unknown;
  programId: string | null;
  dcareAddon: boolean;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function addressOf(v: unknown): Address {
  const a = obj(v);
  return Object.fromEntries(ADDRESS_KEYS.map((k) => [k, str(a[k])])) as Address;
}

function pick<K extends readonly string[]>(keys: K, v: unknown): Record<K[number], string> {
  const o = obj(v);
  return Object.fromEntries(keys.map((k) => [k, str(o[k])])) as Record<K[number], string>;
}

/** Stored blobs -> the strings the inputs start with. */
export function toEditorValues(src: EditorSource): EditorValues {
  const s = obj(src.studentData);
  const family = Array.isArray(s.priorFamilyAttendees) ? s.priorFamilyAttendees : [];
  const onlyParent = obj(src.consentData).onlyParent;
  return {
    studentData: {
      ...pick(STUDENT_KEYS, s),
      address: addressOf(s.address),
      priorFamilyAttendees: family
        .slice(0, MAX_PRIOR_FAMILY_ATTENDEES)
        .map((r) => ({ name: str(obj(r).name), yearEntered: str(obj(r).yearEntered) })),
    },
    ayahData: { ...pick(PARENT_KEYS, src.ayahData), address: addressOf(obj(src.ayahData).address) },
    ibuData: { ...pick(PARENT_KEYS, src.ibuData), address: addressOf(obj(src.ibuData).address) },
    consentData: { onlyParent: onlyParent === "ayah" || onlyParent === "ibu" ? onlyParent : "" },
    programId: src.programId ?? "",
    dcareAddon: src.dcareAddon,
  };
}

// ── Schema ──────────────────────────────────────────────────────────────────

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Wrap every field of a staff* shape so a blank passes (it means "clear"). */
function relaxed(shape: Record<string, z.ZodType>): Record<string, z.ZodType> {
  return Object.fromEntries(Object.entries(shape).map(([k, f]) => [k, z.preprocess(blankToUndefined, f)]));
}

const baseEditorSchema = z.object({
  studentData: z.object(relaxed(staffStudentSchema.shape)),
  ayahData: z.object(relaxed(staffParentSchema.shape)),
  ibuData: z.object(relaxed(staffParentSchema.shape)),
  consentData: staffConsentSchema,
  programId: z.string(),
  dcareAddon: z.boolean(),
});

/**
 * Blank every field staff did NOT change, so only the diff that will be sent is
 * validated. A stored value that is invalid or outside the option lists (an old
 * draft, an older submission) therefore never blocks saving something else, and
 * the API — which only ever sees the diff — applies the same rules.
 */
export function maskUnchanged(initial: EditorValues, current: EditorValues): EditorValues {
  const masked = structuredClone(current);
  const blankSame = (a: Json, b: Json) => {
    for (const k of Object.keys(b)) {
      if (k === "priorFamilyAttendees") {
        if (JSON.stringify(cleanFamily(a[k] as PriorFamily[])) === JSON.stringify(cleanFamily(b[k] as PriorFamily[]))) b[k] = [];
      } else if (k === "address") blankSame(obj(a[k]), obj(b[k]));
      else if (str(a[k]) === str(b[k])) b[k] = "";
    }
  };
  for (const section of ["studentData", "ayahData", "ibuData", "consentData"] as const) {
    blankSame(initial[section] as unknown as Json, masked[section] as unknown as Json);
  }
  return masked;
}

/**
 * The form schema for one editor session: `baseEditorSchema` (rules derived from
 * the API's staff schemas) run over the masked values. The cast narrows the
 * preprocess-wrapped zod type to the plain string-valued form shape react-hook-form
 * is typed with; the shape itself is guaranteed by `EditorValues`/`toEditorValues`.
 */
export function editorSchemaFor(initial: EditorValues): z.ZodType<EditorValues, EditorValues> {
  return z.preprocess((v) => maskUnchanged(initial, v as EditorValues), baseEditorSchema) as unknown as z.ZodType<EditorValues, EditorValues>;
}

// ── Diff -> PATCH body ──────────────────────────────────────────────────────

function isBlankRow(r: PriorFamily) {
  return r.name.trim() === "" && r.yearEntered.trim() === "";
}
const cleanFamily = (rows: PriorFamily[]) => rows.filter((r) => !isBlankRow(r));

function diffSection(initial: Json, current: Json): Json | null {
  const out: Json = {};
  for (const [key, value] of Object.entries(current)) {
    if (key === "address") {
      const ia = obj(initial.address);
      const changed = Object.fromEntries(
        Object.entries(obj(value)).filter(([k, v]) => str(v) !== str(ia[k])),
      );
      if (Object.keys(changed).length > 0) out.address = changed;
    } else if (key === "priorFamilyAttendees") {
      const before = cleanFamily((initial[key] as PriorFamily[]) ?? []);
      const after = cleanFamily(value as PriorFamily[]);
      // A list is replaced as a whole; an empty one clears it.
      if (JSON.stringify(before) !== JSON.stringify(after)) out[key] = after;
    } else if (str(value) !== str(initial[key])) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The PATCH body: ONLY what the staff member changed, so a field the parent
 * saved meanwhile (or any section left alone) is never overwritten with a stale
 * copy. A blank value is sent as-is; the API reads it as "clear". Empty object =
 * nothing to save.
 */
export function buildPatchBody(initial: EditorValues, current: EditorValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const section of ["studentData", "ayahData", "ibuData", "consentData"] as const) {
    const d = diffSection(initial[section], current[section]);
    if (d) body[section] = d;
  }
  if (current.programId !== initial.programId) body.programId = current.programId;
  if (current.dcareAddon !== initial.dcareAddon) body.dcareAddon = current.dcareAddon;
  return body;
}

// ── Fee copy ────────────────────────────────────────────────────────────────

export type FeeNote = "repriced" | "unchanged_paid" | "unchanged_waived" | "unchanged_inactive_program" | "none";

/** Second toast line after a program / Day Care change; null when there is nothing to add. */
export function feeNoteLine(note: FeeNote | undefined, amount: number | null | undefined, rupiah: (n: number) => string): string | null {
  if (note === "repriced") return amount == null ? "Biaya pendaftaran dihitung ulang." : `Biaya pendaftaran dihitung ulang: ${rupiah(amount)}`;
  if (note === "unchanged_paid") return "Biaya sudah lunas, tidak berubah.";
  if (note === "unchanged_waived") return "Biaya sudah dibebaskan, tidak berubah.";
  if (note === "unchanged_inactive_program") return "Program sudah tidak aktif, biaya tidak berubah.";
  return null;
}
