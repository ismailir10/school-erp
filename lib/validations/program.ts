import { z } from "zod";

// Program.ageMin/ageMax gate eligibility by child age in MONTHS, not years —
// see the admin form's "(bulan)" labels and the seed data (TKIT ageMin 48 /
// ageMax 84 = 4–7 tahun). The previous `.max(30)` bound assumed years; wiring
// this schema onto the create route (T3, 2026-09-27 admin-forms-rhf cycle)
// would have rejected every real PAUD/TK program the moment it went live —
// fixed to `.max(300)` (25 tahun in months), a generous ceiling that still
// catches nonsense input. Also fixes the same bug already live on PUT
// /api/programs/[id] (any edit of a program with ageMax > 30 previously 400'd).
const ageMonthsField = z
  .number({ message: "Usia harus berupa angka" })
  .int("Usia harus bilangan bulat")
  .min(0, "Usia tidak boleh negatif")
  .max(300, "Usia maksimal 300 bulan")
  .optional()
  .nullable();

// Program names are what an admin tells programs apart by on every picker and
// fee screen, so "TK  B" (doubled space, from an import) and "TK B" must not
// coexist as two lookalikes. Inner whitespace runs collapse to one space and
// the ends are trimmed before the length rules apply.
const programNameField = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Nama wajib diisi").max(120));

export const createProgramSchema = z.object({
  code: z.string().min(1, "Kode wajib diisi").max(32),
  name: programNameField,
  description: z.string().max(500).optional().nullable(),
  type: z.enum(["SEMESTER", "YEAR_ROUND", "SESSION"]).default("SEMESTER"),
  ageMin: ageMonthsField,
  ageMax: ageMonthsField,
});

export const updateProgramSchema = z.object({
  name: programNameField.optional(),
  description: z.string().max(500).optional().nullable(),
  type: z.enum(["SEMESTER", "YEAR_ROUND", "SESSION"]).optional(),
  ageMin: ageMonthsField,
  ageMax: ageMonthsField,
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

// Client form schema — the admin dialog's <Input type="number"> for Usia
// Min/Max binds ageMin/ageMax as strings ("" when empty). `z.coerce.number()`
// alone would turn "" into `0` (`Number("") === 0`), so empty first collapses
// to `undefined` before coercion — mirrors `lib/validations/campus.ts`'s
// `optionalCoercedNumber`, matching the previous ad-hoc
// `programForm.ageMin ? parseInt(programForm.ageMin) : null` in page.tsx.
const optionalAgeMonthsInput = z.preprocess(
  // Blank → null (not undefined): the PUT route clears the column only when
  // the key is present, so an emptied field must still be sent.
  (v: string | number | null | undefined) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce
    .number({ message: "Usia harus berupa angka" })
    .int("Usia harus bilangan bulat")
    .min(0, "Usia tidak boleh negatif")
    .max(300, "Usia maksimal 300 bulan")
    .optional()
    .nullable(),
);

export const programFormSchema = createProgramSchema.extend({
  ageMin: optionalAgeMonthsInput,
  ageMax: optionalAgeMonthsInput,
});

export type ProgramFormInput = z.infer<typeof programFormSchema>;
