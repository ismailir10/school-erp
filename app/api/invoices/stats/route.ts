import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { ACTIVE_PAYMENT_FILTER } from "@/lib/finance/invoice-payment-state";
import { jakartaMonthRangeUtc } from "@/lib/finance/jakarta-month";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { owingInvoiceWhere, owingWithoutLinkWhere } from "@/lib/finance/invoice-owes";
import { needsReviewInvoiceIds } from "@/lib/payments/needs-review-invoices";

/**
 * GET /api/invoices/stats
 *
 * Returns aggregate counts + totals for the invoice stat cards in a single
 * Prisma `groupBy`. Replaces the prior pattern of firing four `pageSize=1`
 * list queries in parallel from the client to read only `pagination.total`.
 * The four-card sum also missed `PARTIALLY_PAID` + `PENDING_PAYMENT_LINK`
 * before, so the totals never reconciled.
 *
 * FIN-13: also returns Rupiah totals — `outstanding` (sum of remaining on
 * SENT / PARTIALLY_PAID / OVERDUE) and `collectedThisMonth` (non-reversed
 * payments whose `paidAt` falls in the current Jakarta month).
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = session.tenantId; // narrowed here; the closure below would lose it
  const month = jakartaMonthRangeUtc();
  const [groups, collected, unpaidWithoutLink, owing, needsReview] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["status"],
      where: { tenantId: session.tenantId },
      _count: { _all: true },
      _sum: { totalDue: true, totalPaid: true },
    }),
    prisma.payment.aggregate({
      where: {
        ...ACTIVE_PAYMENT_FILTER,
        paidAt: { gte: month.start, lt: month.end },
        invoice: { tenantId: session.tenantId },
      },
      _sum: { amount: true },
    }),
    // Unpaid invoices with no payment link (an expired one is cleared by the sweep):
    // the admin's "Buat link baru (N)" button. Same rule as the list's "Perlu link" filter
    // and the pick behind the button (`lib/finance/invoice-owes`).
    prisma.invoice.count({
      where: { tenantId: session.tenantId, ...owingWithoutLinkWhere() },
    }),
    // Invoices still owing: the list's "Belum lunas (N)".
    prisma.invoice.count({
      where: { tenantId: session.tenantId, ...owingInvoiceWhere() },
    }),
    // Invoices with a flagged gateway payment: the list's "Perlu dicek (N)". Same rule as the
    // list filter (`status=NEEDS_REVIEW`): event-log ids, narrowed to this school's invoices.
    needsReviewInvoiceIds().then((ids) =>
      ids.length === 0
        ? 0
        : prisma.invoice.count({ where: { tenantId, id: { in: ids } } }),
    ),
  ]);

  const byStatus: Record<string, number> = {};
  let totalDue = 0;
  let totalPaid = 0;
  let total = 0;
  let outstanding = 0;

  for (const g of groups) {
    const count = g._count._all ?? 0;
    byStatus[g.status] = count;
    total += count;
    totalDue += Number(g._sum.totalDue ?? 0);
    totalPaid += Number(g._sum.totalPaid ?? 0);
    if ((UNPAID_INVOICE_STATUSES as readonly string[]).includes(g.status)) {
      outstanding += Number(g._sum.totalDue ?? 0) - Number(g._sum.totalPaid ?? 0);
    }
  }

  return NextResponse.json({
    total,
    draft: byStatus.DRAFT ?? 0,
    sent: byStatus.SENT ?? 0,
    partiallyPaid: byStatus.PARTIALLY_PAID ?? 0,
    paid: byStatus.PAID ?? 0,
    overdue: byStatus.OVERDUE ?? 0,
    cancelled: byStatus.CANCELLED ?? 0,
    pendingPaymentLink: byStatus.PENDING_PAYMENT_LINK ?? 0,
    unpaidWithoutLink,
    owing,
    needsReview,
    totalDue,
    totalPaid,
    outstanding,
    collectedThisMonth: Number(collected._sum.amount ?? 0),
  });
}
