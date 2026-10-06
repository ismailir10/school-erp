import { z } from "zod";
import { DOCUMENT_ITEMS, isDocumentKey, type DocumentKey } from "@/lib/enrollment/documents";

const UNKNOWN = "Jenis berkas tidak dikenal";

/**
 * PUT /api/config/enrollment — the Kelengkapan Berkas keys a parent must upload
 * before submitting. Every entry must be a known key. Issues are raised on the
 * array itself (not per element) so `validateBody` reports them under field
 * `requiredDocuments`. Duplicates are collapsed BEFORE the length cap, so a
 * repeated key is not mistaken for an unknown one; the route then orders the
 * result by `DOCUMENT_ITEMS`.
 */
export const enrollmentConfigSchema = z.object({
  requiredDocuments: z
    .array(z.unknown(), { message: UNKNOWN })
    .refine((keys) => keys.every(isDocumentKey), { message: UNKNOWN })
    .transform((keys) => [...new Set(keys as DocumentKey[])])
    .refine((keys) => keys.length <= DOCUMENT_ITEMS.length, { message: UNKNOWN }),
});

export type EnrollmentConfigInput = z.infer<typeof enrollmentConfigSchema>;
