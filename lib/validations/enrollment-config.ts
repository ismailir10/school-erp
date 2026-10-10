import { z } from "zod";
import { DOCUMENT_ITEMS, isDocumentKey, type DocumentKey } from "@/lib/enrollment/documents";

const UNKNOWN = "Jenis berkas tidak dikenal";

/** Upper bound for one program's pendaftaran fee, in whole rupiah. */
export const MAX_ENROLLMENT_FEE = 100_000_000;

const programFeeSchema = z.object({
  programId: z.string({ error: "Program tidak valid" }).trim().min(1, "Program tidak valid"),
  fee: z
    .number({ error: "Biaya pendaftaran harus berupa angka" })
    .int("Biaya pendaftaran harus berupa angka bulat")
    .min(0, "Biaya pendaftaran tidak boleh negatif")
    .max(MAX_ENROLLMENT_FEE, "Biaya pendaftaran terlalu besar"),
});

/**
 * PUT /api/config/enrollment — the Kelengkapan Berkas keys a parent must upload
 * before submitting, and (optionally) the pendaftaran fee of each program.
 *
 * `requiredDocuments`: every entry must be a known key. Issues are raised on the
 * array itself (not per element) so `validateBody` reports them under field
 * `requiredDocuments`. Duplicates are collapsed BEFORE the length cap, so a
 * repeated key is not mistaken for an unknown one; the route then orders the
 * result by `DOCUMENT_ITEMS`.
 *
 * `programFees`: omitted = leave every fee untouched (older clients that only
 * know about documents keep working). Present = each listed program's fee is
 * set; programs not listed keep theirs. The route checks that every id belongs
 * to the caller's tenant.
 */
export const enrollmentConfigSchema = z.object({
  requiredDocuments: z
    .array(z.unknown(), { message: UNKNOWN })
    .refine((keys) => keys.every(isDocumentKey), { message: UNKNOWN })
    .transform((keys) => [...new Set(keys as DocumentKey[])])
    .refine((keys) => keys.length <= DOCUMENT_ITEMS.length, { message: UNKNOWN }),
  programFees: z
    .array(programFeeSchema, { error: "Biaya program tidak valid" })
    .max(100, "Terlalu banyak program")
    .refine((rows) => new Set(rows.map((r) => r.programId)).size === rows.length, {
      message: "Program tidak boleh dobel",
    })
    .optional(),
});

export type EnrollmentConfigInput = z.infer<typeof enrollmentConfigSchema>;
