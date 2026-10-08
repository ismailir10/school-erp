import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Leave-balance arithmetic shared by `GET /api/leave/balance`, submit and
 * approve so the three can never disagree (STR-5, 2026-10-07).
 *
 * Only ANNUAL and SICK carry a balance (`Employee.leaveBalanceAnnual/Sick` is
 * the year's allowance). Days used = sum of requests of that type whose
 * `startDate` falls in the current calendar year.
 */

export type BalancedLeaveType = "ANNUAL" | "SICK";

export function isBalancedLeaveType(t: string): t is BalancedLeaveType {
  return t === "ANNUAL" || t === "SICK";
}

export function leaveTypeLabel(t: BalancedLeaveType): string {
  return t === "ANNUAL" ? "tahunan" : "sakit";
}

export function balancePeriodStart(now: Date = new Date()): string {
  return `${now.getFullYear()}-01-01`;
}

/** Sum of `days` for one employee + leave type in the balance period, for the given statuses. */
export async function sumLeaveDays(
  db: Pick<Prisma.TransactionClient, "leaveRequest">,
  args: {
    employeeId: string;
    leaveType: BalancedLeaveType;
    statuses: string[];
    periodStart?: string;
    excludeId?: string;
  },
): Promise<number> {
  const agg = await db.leaveRequest.aggregate({
    _sum: { days: true },
    where: {
      employeeId: args.employeeId,
      leaveType: args.leaveType,
      status: args.statuses.length === 1 ? args.statuses[0] : { in: args.statuses },
      startDate: { gte: args.periodStart ?? balancePeriodStart() },
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
  });
  return agg._sum.days ?? 0;
}
