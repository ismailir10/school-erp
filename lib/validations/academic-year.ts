import { z } from "zod";
import { ACADEMIC_YEAR_STATUSES } from "@/lib/academic-year/activate";

// AcademicYear was the only admin CRUD surface validating its POST/PUT body
// with ad-hoc `if (!name?.trim())` checks instead of a Zod schema (CRUD
// correctness audit, 2026-06-20 cycle, finding R2). This file brings it onto
// the same pattern as every other module. Status enum is sourced from the
// single canonical list in `lib/academic-year/activate.ts` so the validator
// and the activation branch logic can never drift.
//
// `name` mirrors the AcademicYear.name display convention ("2025/2026"). Dates
// are Jakarta-tz YYYY-MM-DD strings (the column type is String, not DateTime).
const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;

const statusSchema = z.enum(ACADEMIC_YEAR_STATUSES);

const END_BEFORE_START_MESSAGE = "Tanggal selesai harus setelah tanggal mulai";

/** Field-level message for a date range that collides with another year. */
export const academicYearOverlapMessage = (otherName: string) =>
  `Rentang tanggal bertumpuk dengan tahun ajaran ${otherName}.`;

export const createAcademicYearSchema = z
  .object({
    name: z.string().trim().min(1, "Nama tahun ajaran wajib diisi").max(120),
    startDate: z
      .string()
      .regex(ymdRegex, "Format tanggal mulai tidak valid (YYYY-MM-DD)"),
    endDate: z
      .string()
      .regex(ymdRegex, "Format tanggal selesai tidak valid (YYYY-MM-DD)"),
    // Optional on create — the route defaults to PLANNING when omitted.
    status: statusSchema.optional(),
  })
  // ADM-13: the server used to accept an end date before the start. The same
  // ymd strings compare correctly as text; an equal start/end is allowed.
  .refine((v) => v.endDate >= v.startDate, {
    message: END_BEFORE_START_MESSAGE,
    path: ["endDate"],
  });

export const updateAcademicYearSchema = z
  .object({
    name: z.string().trim().min(1, "Nama tahun ajaran wajib diisi").max(120).optional(),
    startDate: z
      .string()
      .regex(ymdRegex, "Format tanggal mulai tidak valid (YYYY-MM-DD)")
      .optional(),
    endDate: z
      .string()
      .regex(ymdRegex, "Format tanggal selesai tidak valid (YYYY-MM-DD)")
      .optional(),
    status: statusSchema.optional(),
  })
  // Only checkable here when both ends are sent; the PUT route re-checks the
  // effective range against the stored value when just one end changes.
  .refine(
    (v) => v.startDate === undefined || v.endDate === undefined || v.endDate >= v.startDate,
    { message: END_BEFORE_START_MESSAGE, path: ["endDate"] },
  );

export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;
export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>;

// Client form schema. The admin dialog already cross-links the two
// DatePickers (start's `max` = the current end value, end's `min` = the
// current start value); the end >= start rule now lives on the create schema
// itself (ADM-13), so the form reuses it as-is and the client and the API
// reject exactly the same ranges with the same message.
export const academicYearFormSchema = createAcademicYearSchema;
