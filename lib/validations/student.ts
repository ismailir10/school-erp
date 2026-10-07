import { z } from "zod";
import { optionalTrimmed, partialWithoutDefaults } from "./zod-helpers";
import { cleanText, labelText, longText, nameText } from "./text";

// Identity-number style fields (NIS/NISN/NIK/KK) and date-of-birth strings.
const idText = () => cleanText({ max: 32, singleLine: true });
const phoneText = () => cleanText({ max: 30, singleLine: true });

/**
 * Trim; empty (or unset) becomes an explicit `null`, never `undefined`.
 *
 * Unlike `optionalTrimmed` (which drops an empty field to `undefined` so
 * the key disappears from `JSON.stringify`'d output), the student edit/create
 * form needs the key to always survive serialisation: `PUT /api/students/[id]`
 * distinguishes "key absent → preserve the existing value" from "key present
 * as `null`/`\"\"` → clear it" (`body.x !== undefined ? … : undefined` per
 * field, app/api/students/[id]/route.ts ~177-187) — the same contract the
 * pre-migration client honoured by always sending every field, trimmed,
 * with `field.trim() || null`. This preprocess reproduces that exactly, so
 * the value type is `string | null`, never `string | null | undefined`.
 */
function nullableTrimmed(inner: z.ZodString) {
  return z.preprocess((v) => {
    if (typeof v !== "string") return v ?? null;
    const t = v.trim();
    return t === "" ? null : t;
  }, inner.nullable());
}

/** Same contract as `nullableTrimmed` but without trimming — for fields the
 * old client sent as `field || null` (no `.trim()`): `dateOfBirth`, the
 * Jenis Kelamin `<Select>`'s `gender`, and `livingWith`. */
function nullableEmpty<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((v) => (v === "" || v === undefined ? null : v), inner.nullable());
}

export const createStudentSchema = z.object({
  name: nameText({ required: "Nama siswa wajib diisi" }),
  nickname: nameText().optional().nullable(),
  dateOfBirth: idText().optional().nullable(),
  gender: z.enum(["L", "P"]).optional().nullable(),
  address: longText().optional().nullable(),
  notes: longText().optional().nullable(),
  nis: idText().optional().nullable(),
  nisn: idText().optional().nullable(),
  birthPlace: labelText().optional().nullable(),
  nik: idText().optional().nullable(),
  kkNumber: idText().optional().nullable(),
  livingWith: labelText().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  // Admin-created students normally land ACTIVE; allowing the full enum lets
  // admins backfill historical rows (GRADUATED / WITHDRAWN) without a second PUT.
  status: z.enum(["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"]).optional(),
  guardians: z.array(z.object({
    name: nameText({ required: "Nama wali wajib diisi" }),
    relationship: z.enum(["AYAH", "IBU", "WALI", "OTHER"]).default("WALI"),
    phone: phoneText().optional().nullable(),
    email: z.string().email("Email tidak valid").max(254, "Maksimal 254 karakter.").optional().nullable(),
    whatsapp: phoneText().optional().nullable(),
    isPrimary: z.boolean().default(false),
  })).optional(),
});

/**
 * Form schema for the Tambah/Edit Siswa dialogs on `/admin/students`
 * (react-hook-form + zodResolver — see `lib/forms/use-zod-form.ts`).
 *
 * Derived from `createStudentSchema`, not a divergent copy — but every
 * optional field is re-wrapped so its output is `string | null` (never
 * `undefined`), matching **exactly** what the pre-migration client sent on
 * every submit (`field.trim() || null`, or `field || null` for `dateOfBirth`
 * /`gender`/`livingWith`, always as an explicit key). This is deliberately
 * the opposite of the usual `optionalTrimmed`/`optionalEnum` convention
 * (which coerce a blank field to `undefined` so the key is *omitted*):
 * `PUT /api/students/[id]` reads "key absent" as "leave the column alone"
 * and "key present as `null`" as "clear it" (`body.x !== undefined ? … :
 * undefined` per field, app/api/students/[id]/route.ts ~177-187) — an
 * omitted key would silently stop an admin from ever clearing a field back
 * to blank. `name` gets `.trim()` for the same parity (the old client sent
 * `editForm.name.trim()`). `metadata` and `guardians` aren't edited from
 * this form and are omitted; `status` keeps the full 4-value enum from
 * `createStudentSchema` — the edit dialog's lifecycle lock
 * (GRADUATED/WITHDRAWN) is UI-only, mirroring the PUT route which already
 * rejects GRADUATED there.
 */
export const studentFormSchema = createStudentSchema
  .omit({ metadata: true, guardians: true })
  .extend({
    name: nameText({ required: "Nama siswa wajib diisi" }),
    nickname: nullableTrimmed(nameText()),
    dateOfBirth: nullableEmpty(idText()),
    gender: nullableEmpty(z.enum(["L", "P"])),
    address: nullableTrimmed(longText()),
    notes: nullableTrimmed(longText()),
    nis: nullableTrimmed(idText()),
    nisn: nullableTrimmed(idText()),
    birthPlace: nullableTrimmed(labelText()),
    nik: nullableTrimmed(idText()),
    kkNumber: nullableTrimmed(idText()),
    livingWith: nullableEmpty(labelText()),
    status: z.enum(["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"]),
  });

export const updateStudentSchema = partialWithoutDefaults(createStudentSchema).extend({
  status: z.enum(["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN"]).optional(),
  // Inline edit from Student detail "Riwayat Status" sub-card.
  // Withdrawal date is set by the /withdraw lifecycle API and stays read-only.
  // .trim() before .min(1) so whitespace-only payloads from a direct API call
  // (bypassing the client's client-side trim guard) are still rejected.
  withdrawalReason: longText({ required: "Alasan tidak boleh kosong", max: 500 }).optional(),
});

export const enrollStudentSchema = z.object({
  classSectionId: z.string().min(1, "Kelas wajib dipilih"),
  // Required only when the age-fit check comes back BELOW_MIN/ABOVE_MAX and
  // the admin chooses to proceed anyway — see evaluateAgeFit in
  // lib/enrollment/age-fit.ts. Free text, non-empty; written into the
  // AuditLog `after` payload for `student.enroll.age-override`.
  ageOverrideReason: longText({ required: "Alasan wajib diisi", max: 500 }).optional(),
});

/**
 * Form schema for `StudentEnrollDialog` (react-hook-form + zodResolver).
 * Derived from `enrollStudentSchema`: `classSectionId` keeps its real
 * validator, but `ageOverrideReason` is re-wrapped with `optionalTrimmed` —
 * the API schema's `.trim().min(1).optional()` only lets `undefined` skip
 * the min-length check, while the dialog's default form value is `""` on
 * every submit that ISN'T an age-override retry (the common case). Without
 * this the resolver would reject the plain "pick a class and submit" path
 * with "String must contain at least 1 character(s)". The *contextual*
 * rule — reason required only once the 409 advisory step is showing — stays
 * enforced exactly as before: the confirm button disables on an empty
 * reason (see `reasonEmpty` in the dialog), not a schema refinement, since
 * that requirement depends on UI state the schema doesn't see.
 */
export const enrollStudentFormSchema = enrollStudentSchema.extend({
  ageOverrideReason: optionalTrimmed(longText({ max: 500 })),
});

export const graduateStudentSchema = z.object({
  graduationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .optional(),
});

export const withdrawStudentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Alasan pengunduran diri wajib diisi")
    .max(500, "Alasan pengunduran diri maksimal 500 karakter"),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .optional(),
});

export const promoteStudentSchema = z.object({
  targetClassSectionId: z.string().min(1, "Kelas tujuan wajib dipilih"),
  notes: z.string().trim().max(500, "Catatan maksimal 500 karakter").optional().nullable(),
});

/**
 * Data Anak's inline-edit form (`components/admin/students/detail/
 * data-anak-section.tsx`), derived from `studentFormSchema` with `status`
 * dropped — the detail page's inline edit never shows a status field
 * (status only changes through the lifecycle actions: Naik Kelas / Luluskan
 * / Keluarkan), so the submitted body doesn't carry one either. Everything
 * else is identical, including the explicit-`null` contract every optional
 * field gets from `nullableTrimmed`/`nullableEmpty` — that contract is what
 * fixes a real bug: the old plain-`useState` form sent `gender: ""` for a
 * student with no gender on file, which `updateStudentSchema`'s `gender:
 * z.enum(["L","P"]).optional().nullable()` rejects outright (`""` is neither
 * `undefined` nor `null`), so saving Data Anak silently failed for every such
 * student. This schema's `nullableEmpty` turns that same `""` into `null`,
 * which the PUT route accepts as "clear the field".
 */
export const studentDetailEditFormSchema = studentFormSchema.omit({ status: true });

/**
 * Riwayat Status' inline withdrawal-reason edit (`RiwayatStatusSection`).
 * Same field `updateStudentSchema.withdrawalReason` already validates, with
 * its own Indonesian copy for this specific control — a lesson-2-style
 * tightening of the *message* only; the PUT route keeps validating with
 * `updateStudentSchema`, unmodified, so what the API accepts doesn't change.
 */
export const withdrawalReasonFormSchema = z.object({
  withdrawalReason: longText({ required: "Alasan keluar wajib diisi", max: 500 }),
});

/**
 * Informasi Tambahan's free-form key/value rows
 * (`InformasiTambahanSection`). Form-only: there is no wire schema to derive
 * from, since `PUT /api/students/[id]` accepts `metadata` as an open
 * `z.record(...)` (`createStudentSchema`) — this is the shape the section
 * validates client-side before folding the rows into that blob with
 * `buildStudentMetadata` (`lib/student/metadata.ts`).
 *
 * Both rules land on a rendered field (lesson 1, not an object/array-level
 * error nothing renders): an empty key fails its own `.min(1, ...)`; a
 * duplicate key raises a `superRefine` issue on the *second* occurrence's
 * `rows.<index>.key` — the row an admin is actively retyping, not the first
 * (correct) one — so the inline error lands where the fix belongs.
 */
export const studentExtraMetadataFormSchema = z
  .object({
    rows: z.array(
      z.object({
        key: z.string().trim().min(1, "Nama field wajib diisi"),
        value: z.string(),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.rows.forEach((row, i) => {
      const key = row.key.trim();
      if (key === "") return; // already caught by that field's own .min(1, ...)
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Nama field harus unik",
          path: ["rows", i, "key"],
        });
        return;
      }
      seen.add(key);
    });
  });
