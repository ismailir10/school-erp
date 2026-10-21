import { prisma } from "@/lib/db";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import {
  addDaysYmd,
  bucketAging,
  bucketByMonth,
  nextMonthStart,
  rateOf,
  sixMonths,
} from "./helpers";
import type { FinanceAnalytics } from "./types";

const JAKARTA_OFFSET = "+07:00"; // Asia/Jakarta has no DST

/**
 * Billing and collection for the admin Dasbor.
 * - Billed per month: invoices bucketed by dueDate (draft + cancelled excluded).
 * - Collected per month: payments bucketed by paidAt in Asia/Jakarta, scoped
 *   through `invoice.tenantId` (Payment has no tenantId), REVERSED excluded.
 * - thisMonth: invoices due in the current month, sum totalDue / totalPaid.
 * - Aging: SENT / PARTIALLY_PAID / OVERDUE by days past dueDate. Outstanding is
 *   summed per dueDate group, so a group whose net balance is <= 0 is skipped
 *   as a whole rather than per invoice (unpaid statuses never overpay).
 */
export async function loadFinanceAnalytics(
  tenantId: string,
  today: string,
): Promise<FinanceAnalytics> {
  const months = sixMonths(today);
  const windowStart = `${months[0]}-01`;
  const windowEndExclusive = nextMonthStart(months[5]);
  const windowEnd = addDaysYmd(windowEndExclusive, -1);
  const paidFrom = new Date(`${windowStart}T00:00:00${JAKARTA_OFFSET}`);
  const paidTo = new Date(`${windowEndExclusive}T00:00:00${JAKARTA_OFFSET}`);

  const [billedRows, agingRows, paymentRows] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["dueDate"],
      where: {
        tenantId,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        dueDate: { gte: windowStart, lte: windowEnd },
      },
      _sum: { totalDue: true, totalPaid: true },
    }),
    prisma.invoice.groupBy({
      by: ["dueDate"],
      where: { tenantId, status: { in: [...UNPAID_INVOICE_STATUSES] } },
      _count: { _all: true },
      _sum: { totalDue: true, totalPaid: true },
    }),
    prisma.$queryRaw<Array<{ month: string; total: unknown }>>`
      SELECT
        to_char((p."paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month,
        SUM(p."amount") AS total
      FROM "Payment" p
      JOIN "Invoice" i ON i."id" = p."invoiceId"
      WHERE i."tenantId" = ${tenantId}
        AND p."status" <> 'REVERSED'
        AND p."paidAt" >= ${paidFrom}
        AND p."paidAt" < ${paidTo}
      GROUP BY 1
    `,
  ]);

  const billed = bucketByMonth(
    billedRows.map((r) => ({ key: r.dueDate, amount: Number(r._sum.totalDue ?? 0) })),
    months,
  );
  const collected = bucketByMonth(
    paymentRows.map((r) => ({ key: r.month, amount: Number(r.total ?? 0) })),
    months,
  );

  const currentMonth = months[5];
  let monthBilled = 0;
  let monthPaid = 0;
  for (const r of billedRows) {
    if (r.dueDate.slice(0, 7) !== currentMonth) continue;
    monthBilled += Number(r._sum.totalDue ?? 0);
    monthPaid += Number(r._sum.totalPaid ?? 0);
  }

  const aging = bucketAging(
    agingRows.map((r) => ({
      dueDate: r.dueDate,
      outstanding: Number(r._sum.totalDue ?? 0) - Number(r._sum.totalPaid ?? 0),
      count: r._count._all,
    })),
    today,
  );

  return {
    months: months.map((month, i) => ({ month, billed: billed[i], collected: collected[i] })),
    thisMonth: { billed: monthBilled, paid: monthPaid, rate: rateOf(monthPaid, monthBilled) },
    aging,
    outstandingTotal: aging.reduce((n, a) => n + a.amount, 0),
  };
}
