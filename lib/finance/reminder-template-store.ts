/**
 * Server-only read of the school's reminder wording. Null = the school never wrote one
 * (callers pass it straight to `invoiceReminderText`, which falls back to the default).
 */

import { prisma } from "@/lib/db";

export async function getInvoiceReminderTemplate(
  tenantId: string,
  db: Pick<typeof prisma, "tenant"> = prisma,
): Promise<string | null> {
  const row = await db.tenant.findUnique({ where: { id: tenantId }, select: { invoiceReminderTemplate: true } });
  return row?.invoiceReminderTemplate?.trim() ? row.invoiceReminderTemplate : null;
}
