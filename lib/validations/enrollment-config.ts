import { z } from "zod";
import { DOCUMENT_ITEMS, isDocumentKey } from "@/lib/enrollment/documents";

/**
 * PUT /api/config/enrollment — the Kelengkapan Berkas keys a parent must upload
 * before submitting. Every entry must be a known key. Duplicates are collapsed
 * BEFORE the length cap, so a repeated key is not mistaken for an unknown one;
 * the route then orders the result by `DOCUMENT_ITEMS`.
 */
export const enrollmentConfigSchema = z.object({
  requiredDocuments: z
    .array(z.string().refine(isDocumentKey, { message: "Jenis berkas tidak dikenal" }), {
      message: "Jenis berkas tidak dikenal",
    })
    .transform((keys) => [...new Set(keys)])
    .refine((keys) => keys.length <= DOCUMENT_ITEMS.length, { message: "Jenis berkas tidak dikenal" }),
});

export type EnrollmentConfigInput = z.infer<typeof enrollmentConfigSchema>;
