/**
 * Which Kelengkapan Berkas items a school makes mandatory before a parent can
 * submit the pendaftaran form. Stored per tenant on
 * `Tenant.enrollmentRequiredDocuments` (deliberately not on OrgConfig: that row
 * is optional and other modules read "no row" as "use legacy behaviour");
 * empty, the default, means every upload stays optional.
 *
 * Server-only (Prisma). Client code that needs the "what is missing" check
 * imports the pure `missingUploads` from ./documents instead.
 */

import { prisma } from "@/lib/db";
import { DOCUMENT_KEYS, isDocumentKey, type DocumentKey } from "./documents";

/** Filter to known keys, dedupe, and put them in `DOCUMENT_ITEMS` order. */
export function normalizeRequiredDocuments(raw: unknown): DocumentKey[] {
  if (!Array.isArray(raw)) return [];
  const want = new Set<string>(raw.filter(isDocumentKey));
  return DOCUMENT_KEYS.filter((k) => want.has(k));
}

export async function getRequiredDocuments(
  tenantId: string,
  db: Pick<typeof prisma, "tenant"> = prisma,
): Promise<DocumentKey[]> {
  const row = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { enrollmentRequiredDocuments: true },
  });
  return normalizeRequiredDocuments(row?.enrollmentRequiredDocuments);
}
