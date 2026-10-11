import { z } from "zod";
import { programIdSchema } from "@/lib/validations/program-id";
import { isDocumentKey } from "@/lib/enrollment/documents";
import { staffConsentSchema, staffParentSchema, staffStudentSchema } from "@/lib/enrollment/submit-validation";
import { splitClears, type EditSection } from "@/lib/enrollment/staff-edit";

/**
 * PATCH /api/enrollments/[id] — what staff may change on an application.
 *
 * `studentData` / `ayahData` / `ibuData` are the relaxed "staff" variants of the
 * parent's submit schemas (every field optional, every provided value format-
 * checked the same way). `consentData` only carries `onlyParent`; signatures and
 * the agreement are evidence the parent writes. Blank values mean "clear" and are
 * split off by `parseEnrollmentEdit` before validation.
 */
export const enrollmentEditSchema = z
  .object({
    status: z.enum(["UNDER_REVIEW", "ACCEPTED", "REJECTED", "SUBMITTED"]).optional(),
    studentData: staffStudentSchema.optional(),
    ayahData: staffParentSchema.optional(),
    ibuData: staffParentSchema.optional(),
    consentData: staffConsentSchema.optional(),
    programId: z.union([programIdSchema, z.literal(""), z.null()]).optional(),
    dcareAddon: z.boolean({ error: "Day Care harus Ya atau Tidak" }).optional(),
    // Kelengkapan Berkas: staff ticks "diterima (fisik)". Merged key-by-key in
    // SQL (never a blob replace) and the ONLY field allowed after conversion.
    documentsReceived: z
      .record(z.string(), z.boolean())
      .refine((o) => Object.keys(o).every(isDocumentKey), "Jenis berkas tidak dikenal")
      .optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), "Tidak ada perubahan");

export type EnrollmentEdit = z.infer<typeof enrollmentEditSchema>;

const SECTIONS: EditSection[] = ["studentData", "ayahData", "ibuData", "consentData"];

export type EnrollmentEditField = { field: string; message: string };

export type ParsedEnrollmentEdit =
  | { success: true; data: EnrollmentEdit; clears: Record<EditSection, string[]> }
  | { success: false; errors: EnrollmentEditField[] };

/** Validate a raw PATCH body: split clears, then run the schema. Field paths are dotted (`ayahData.phone`). */
export function parseEnrollmentEdit(raw: unknown): ParsedEnrollmentEdit {
  const body: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as object) } : {};
  const clears: Record<EditSection, string[]> = { studentData: [], ayahData: [], ibuData: [], consentData: [] };
  for (const section of SECTIONS) {
    if (!(section in body)) continue;
    const split = splitClears(section, body[section]);
    body[section] = split.value;
    clears[section] = split.clears;
  }
  const parsed = enrollmentEditSchema.safeParse(body);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    };
  }
  return { success: true, data: parsed.data, clears };
}
