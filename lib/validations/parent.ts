import { z } from "zod";
import { optionalEmail } from "./optional-email";
import { cleanText, longText, nameText } from "./text";

const short = (max: number) => cleanText({ max, singleLine: true });

// Used by PUT /api/parents/[id] — edits the Parent contact fields shown on
// the /admin/guardians list ("Wali Murid"). Junction-table fields like
// relationship/isPrimary belong to StudentGuardian and are edited via the
// existing /api/guardians/[id] route.
export const updateParentSchema = z.object({
  name: nameText({ required: "Nama wajib diisi" }).optional(),
  phone: short(20).optional().nullable(),
  email: optionalEmail,
  whatsapp: short(20).optional().nullable(),
  address: longText({ max: 500 }).optional().nullable(),
  // Both `nik` (legacy field name on the Parent row) and `parentNik` (the
  // unified GuardianForm key used by all three admin surfaces since T7) are
  // accepted. The PUT handler folds `parentNik` into the same db column.
  nik: short(20).optional().nullable(),
  parentNik: short(20).optional().nullable(),
  education: short(100).optional().nullable(),
  occupation: short(100).optional().nullable(),
  employer: short(200).optional().nullable(),
  employerAddress: longText({ max: 500 }).optional().nullable(),
  employerCity: short(100).optional().nullable(),
  incomeRange: short(50).optional().nullable(),
  childrenTotal: z.coerce.number().int().min(0).optional().nullable(),
});

export const toggleParentStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

/**
 * Form schema for the "Edit Wali" dialog on `/admin/guardians` and the
 * inline edit on `/admin/guardians/[id]` (react-hook-form + zodResolver).
 * Both pages pass `editForm.control` straight into the shared
 * `GuardianFormBody` (components/admin/guardian-edit-dialog.tsx) with
 * `showRelationship={false}` — T3 (2026-09-27, admin-finish-standard) moved
 * that component off its pre-existing `form`/`setForm` prop contract onto a
 * generic RHF `control`, so the useWatch/setValue bridge this comment used
 * to describe no longer exists.
 *
 * Derived from `updateParentSchema`, not a divergent copy: every field
 * keeps that schema's validator except `childrenTotal`, whose form value is
 * a raw `<Input type="number">` string ("" when unset) rather than a
 * coerced number — `z.coerce.number()` alone turns `""` into `0`, not the
 * "clear the field" `null` the previous handler produced with
 * `payload.childrenTotal === "" ? null : Number(...)`. The preprocess below
 * reproduces that exactly. `nik` is omitted — `GuardianFieldValues` only
 * ever carries the unified `parentNik` key (never the legacy `nik` alias),
 * so keeping it would leave an unindexable field on this form-values type.
 */
export const parentFormSchema = updateParentSchema.omit({ childrenTotal: true, nik: true }).extend({
  childrenTotal: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.union([z.null(), z.coerce.number().int().min(0, "Jumlah anak tidak valid")]),
  ),
});
