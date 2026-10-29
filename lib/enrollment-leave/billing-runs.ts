import type { Prisma } from "@/lib/generated/prisma/client";
import { parsePeriodMonth } from "@/lib/finance/period-label";
import { leaveCoversMonth, parseYearMonth } from "./months";

export type AffectedRun = { id: string; periodLabel: string; status: string };

/** Billing-run states that can still commit a stored amount (DRAFT, or mid-commit). */
export const OPEN_BILLING_RUN_STATUSES = ["DRAFT", "COMMITTING"] as const;

/**
 * Open billing runs of the tenant whose period label is a single month inside
 * the leave. A label that is not a single month never matches (a leave only
 * ever affects single-month runs). Read-only.
 */
export async function findOpenRunsCoveredByLeave(
  db: Pick<Prisma.TransactionClient, "billingRun">,
  input: { tenantId: string; startMonth: string; endMonth: string },
): Promise<AffectedRun[]> {
  const start = parseYearMonth(input.startMonth);
  const end = parseYearMonth(input.endMonth);
  if (!start || !end) return [];
  const runs = await db.billingRun.findMany({
    where: { tenantId: input.tenantId, status: { in: [...OPEN_BILLING_RUN_STATUSES] } },
    select: { id: true, periodLabel: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  return runs.filter((run) => {
    const period = parsePeriodMonth(run.periodLabel);
    return period !== null && leaveCoversMonth({ start, end }, period);
  });
}
