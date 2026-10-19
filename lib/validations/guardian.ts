import { z } from "zod";
import { optionalEmail } from "./optional-email";
import { cleanText, longText, nameText } from "./text";

const short = (max: number) => cleanText({ max, singleLine: true });

// Shared by createGuardianSchema, updateGuardianSchema and linkGuardianSchema:
// an HTML number input sends "Anak ke-" as a string, and an empty field must
// clear the column rather than coerce to 0. Preprocess so ""/null
// short-circuit to undefined. Exported so the form-schema layer below (and
// any other derived form schema) can reuse the exact same tolerance instead
// of a divergent copy.
export const childOrderField = z
  .preprocess(
    (v) => (v === null || v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().min(1).optional(),
  )
  .nullable()
  .optional();

export const createGuardianSchema = z.object({
  name: nameText({ required: "Nama wali wajib diisi" }),
  phone: short(20).optional().nullable(),
  email: optionalEmail,
  whatsapp: short(20).optional().nullable(),
  // No silent default — pre-fix `.default("WALI")` masked combobox-state
  // bugs (FIND-009): the form selected "Ayah" but submit dropped the value
  // and the server quietly persisted "WALI".
  relationship: z.enum(["AYAH", "IBU", "WALI", "OTHER"]),
  // isPrimary stays optional; first-guardian auto-default is applied in the
  // POST route (FIND-010) since it needs a DB count, not a static default.
  isPrimary: z.boolean().optional(),
  parentNik: short(20).optional().nullable(),
  education: short(100).optional().nullable(),
  occupation: short(100).optional().nullable(),
  employer: short(200).optional().nullable(),
  employerAddress: longText({ max: 500 }).optional().nullable(),
  employerCity: short(100).optional().nullable(),
  incomeRange: short(50).optional().nullable(),
  address: longText({ max: 500 }).optional().nullable(),
  childrenTotal: z.coerce.number().int().min(0).optional().nullable(),
  // T3 data-loss fix: the create branch of POST
  // /api/students/[id]/guardians collected "Anak ke-" on the "Tambah Wali
  // Baru" form but this key was never in the wire schema, so it was
  // stripped before the route ever saw it. Same shape as
  // linkGuardianSchema's — the junction row this ultimately writes to is
  // the same column either way.
  childOrder: childOrderField,
  // Set once the admin has seen the duplicate-candidate list and chose to
  // create a new parent anyway. Absent on the first submit, which is what
  // lets the route run the check exactly once per decision.
  confirmNew: z.boolean().optional(),
});

/**
 * Linking a parent who already exists. Deliberately carries no bio fields —
 * the parent's own record owns those, and accepting them here would let the
 * "Tambah Wali" dialog silently overwrite another family's data. Only the
 * junction's own columns are settable.
 */
export const linkGuardianSchema = z.object({
  parentId: z.string().min(1, "Wali wajib dipilih"),
  relationship: z.enum(["AYAH", "IBU", "WALI", "OTHER"]),
  isPrimary: z.boolean().optional(),
  childOrder: childOrderField,
});

/**
 * Form-side schema for "Tautkan anak" on the wali page: the wali is the page
 * itself, so the form only picks the student and the relationship. The page
 * adds `parentId` when it posts to POST /api/students/[id]/guardians, whose
 * body is `linkGuardianSchema`. `isPrimary` is deliberately not offered: the
 * route makes the first guardian primary and leaves an existing one alone.
 */
export const linkChildFormSchema = z.object({
  studentId: z.string().min(1, "Pilih siswa terlebih dahulu"),
  relationship: z.enum(["AYAH", "IBU", "WALI", "OTHER"]),
});

export const updateGuardianSchema = z.object({
  name: nameText({ required: "Nama wali wajib diisi" }).optional(),
  phone: short(20).optional().nullable(),
  email: optionalEmail,
  whatsapp: short(20).optional().nullable(),
  relationship: z.enum(["AYAH", "IBU", "WALI", "OTHER"]).optional(),
  isPrimary: z.boolean().optional(),
  // T8: per-junction "Anak ke-" position.
  childOrder: childOrderField,
  parentNik: short(20).optional().nullable(),
  education: short(100).optional().nullable(),
  occupation: short(100).optional().nullable(),
  employer: short(200).optional().nullable(),
  employerAddress: longText({ max: 500 }).optional().nullable(),
  employerCity: short(100).optional().nullable(),
  incomeRange: short(50).optional().nullable(),
  address: longText({ max: 500 }).optional().nullable(),
  childrenTotal: z.coerce.number().int().min(0).optional().nullable(),
});

export const toggleGuardianStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  // CORE-4: when deactivating the primary guardian, the admin may pick which
  // remaining ACTIVE guardian becomes the new primary (else the server picks).
  newPrimaryId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Form schemas — students/[id] guardian dialog's create/edit steps (T3).
//
// Derived from the wire schemas above, not divergent copies (lesson 4): every
// field keeps the wire schema's own validator except `childrenTotal`, whose
// form value is a raw `<Input type="number">` string. A bare
// `z.coerce.number()` turns "" into 0 (`Number("") === 0`), so it needs a
// blank-tolerant preprocess — but unlike `childOrderField` (blank →
// `undefined`, dropped by `JSON.stringify`), blank here must become an
// explicit `null`: `guardianUpdateFormSchema` feeds the PUT edit dialog, and
// a PUT that omits a key means "keep" (lesson 2) — the admin clearing
// "Jumlah Anak" must still clear it. Same shape as `parentFormSchema`'s own
// `childrenTotal` (lib/validations/parent.ts).
// ---------------------------------------------------------------------------

const childrenTotalFormField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.union([z.null(), z.coerce.number().int().min(0, "Jumlah anak tidak valid")]),
);

export const guardianCreateFormSchema = createGuardianSchema.extend({
  childrenTotal: childrenTotalFormField,
});

// updateGuardianSchema's `name` is optional at the wire level (a PATCH-style
// PUT: an absent key means "keep") and carries no message on its `.min(1)`,
// which is correct for that route but wrong for a dialog where Nama is
// always rendered and always required — an admin who clears it needs a
// human message, not Zod's default English one (lesson: never let one reach
// the UI). Same copy the pre-RHF handler used for both its create and edit
// paths. Tightening a message, not what the API accepts.
// Same reason for `childOrder` on edit: the wire field maps "" to undefined
// (dropped → the PUT keeps the old value), so an admin could never clear
// "Anak ke-". Blank → explicit null, which the route writes as a clear.
const childOrderFormField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.union([z.null(), z.coerce.number().int().min(1, "Anak ke- minimal 1")]),
);

export const guardianUpdateFormSchema = updateGuardianSchema.extend({
  name: nameText({ required: "Nama wali wajib diisi" }),
  childrenTotal: childrenTotalFormField,
  childOrder: childOrderFormField,
});
