import type { Prisma } from "@/lib/generated/prisma/client";
import { parsePeriodMonth } from "@/lib/finance/period-label";
import { leaveCoversMonth, parseYearMonth } from "./months";

export type AffectedRun = { id: string; periodLabel: string; status: string };

/** Billing-run states that can still commit a stored amount (DRAFT, or mid-commit). */
export const OPEN_BILLING_RUN_STATUSES = ["DRAFT", "COMMITTING"] as const;

/** The placement a leave belongs to: decides which runs could ever bill it. */
export type LeavePlacement = { studentId: string; classSectionId: string; academicYearId: string };

const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Open billing runs of the tenant whose period label is a single month inside
 * the leave, and (when `placement` is given) that are for the placement's
 * academic year and cover it: its class is in scope, or the student is
 * explicitly included. A run scoped only to the student's school class never
 * billed the daycare placement, so a daycare leave must not touch it. A label
 * that is not a single month never matches (a leave only ever affects
 * single-month runs). Read-only.
 */
export async function findOpenRunsCoveredByLeave(
  db: Pick<Prisma.TransactionClient, "billingRun">,
  input: { tenantId: string; startMonth: string; endMonth: string; placement?: LeavePlacement },
): Promise<AffectedRun[]> {
  const start = parseYearMonth(input.startMonth);
  const end = parseYearMonth(input.endMonth);
  if (!start || !end) return [];
  const runs = await db.billingRun.findMany({
    where: { tenantId: input.tenantId, status: { in: [...OPEN_BILLING_RUN_STATUSES] } },
    select: { id: true, periodLabel: true, status: true, academicYearId: true, scope: true },
    orderBy: { createdAt: "asc" },
  });
  const { placement } = input;
  return runs
    .filter((run) => {
      const period = parsePeriodMonth(run.periodLabel);
      if (period === null || !leaveCoversMonth({ start, end }, period)) return false;
      if (!placement) return true;
      if (run.academicYearId !== placement.academicYearId) return false;
      const scope = (run.scope ?? {}) as { classSectionIds?: unknown; includeStudentIds?: unknown };
      return (
        idsOf(scope.classSectionIds).includes(placement.classSectionId) ||
        idsOf(scope.includeStudentIds).includes(placement.studentId)
      );
    })
    .map(({ id, periodLabel, status }) => ({ id, periodLabel, status }));
}
