import { prisma } from "@/lib/db";
import { NEEDS_REVIEW_ERROR_CODES } from "@/lib/payments/needs-review";

/**
 * Ids of every invoice with a webhook event that needs a person to reconcile it
 * (`status: "ERROR"` and one of {@link NEEDS_REVIEW_ERROR_CODES}). Distinct, non-null.
 *
 * `WebhookEvent` has no relation to `Invoice` and no `tenantId`, so callers MUST apply their
 * own tenant scoping when they use these ids (`{ tenantId, id: { in: ids } }`). Enrollment-fee
 * events keep a fee id in `invoiceId`; those ids never match an invoice, so they drop out there.
 *
 * Volume is small (~200 invoices, few flagged events), so reading the ids first is fine.
 * Revisit with a real relation if volume grows.
 *
 * Lives apart from `needs-review.ts` on purpose: that module is pure constants, imported by
 * client-safe code and label mappers, and must not pull in the database client.
 */
export async function needsReviewInvoiceIds(db: Pick<typeof prisma, "webhookEvent"> = prisma): Promise<string[]> {
  const rows = await db.webhookEvent.findMany({
    where: {
      status: "ERROR",
      errorMessage: { in: [...NEEDS_REVIEW_ERROR_CODES] },
      invoiceId: { not: null },
    },
    select: { invoiceId: true },
    distinct: ["invoiceId"],
  });
  const ids: string[] = [];
  for (const r of rows) if (r.invoiceId) ids.push(r.invoiceId);
  return ids;
}
