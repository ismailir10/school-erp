import { prisma } from "@/lib/db";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";

export type ReceivablesSummary = {
  /** Invoices past their due date and still unpaid (status OVERDUE). */
  overdueCount: number;
  /** Sum of the unpaid balance (totalDue - totalPaid) across SENT / PARTIALLY_PAID / OVERDUE. */
  receivable: number;
};

/**
 * Cash position for the admin dashboard: the same "Piutang" definition as
 * `GET /api/invoices/stats` (unpaid balance on the statuses in
 * `UNPAID_INVOICE_STATUSES`), tenant-scoped, plus the overdue count.
 */
export async function loadReceivables(tenantId: string): Promise<ReceivablesSummary> {
  const groups = await prisma.invoice.groupBy({
    by: ["status"],
    where: { tenantId, status: { in: [...UNPAID_INVOICE_STATUSES] } },
    _count: { _all: true },
    _sum: { totalDue: true, totalPaid: true },
  });

  let overdueCount = 0;
  let receivable = 0;
  for (const g of groups) {
    if (g.status === "OVERDUE") overdueCount = g._count._all ?? 0;
    receivable += Number(g._sum.totalDue ?? 0) - Number(g._sum.totalPaid ?? 0);
  }
  return { overdueCount, receivable };
}
