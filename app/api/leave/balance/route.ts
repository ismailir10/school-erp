import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { sumLeaveDays } from "@/lib/leave/balance";

// Teacher: get my leave balance
export async function GET() {
  const session = await getSession();
  if (!session?.employeeId || !session.tenantId) {
    return NextResponse.json(null, { status: 401 });
  }

  // F-24: defense-in-depth tenant scoping. session.employeeId is set at
  // login from the user's tenant context, but we still verify the employee
  // row belongs to session.tenantId so a session-injection bug or future
  // cross-tenant lookup cannot leak balance state.
  const employee = await prisma.employee.findFirst({
    where: { id: session.employeeId, tenantId: session.tenantId },
    select: { leaveBalanceAnnual: true, leaveBalanceSick: true },
  });

  if (!employee) return NextResponse.json(null, { status: 404 });

  // Used = APPROVED days this year (shared with submit/approve so the numbers agree).
  const [usedAnnual, usedSick] = await Promise.all([
    sumLeaveDays(prisma, { employeeId: session.employeeId, leaveType: "ANNUAL", statuses: ["APPROVED"] }),
    sumLeaveDays(prisma, { employeeId: session.employeeId, leaveType: "SICK", statuses: ["APPROVED"] }),
  ]);

  return NextResponse.json({
    annual: { total: employee.leaveBalanceAnnual, used: usedAnnual, remaining: employee.leaveBalanceAnnual - usedAnnual },
    sick: { total: employee.leaveBalanceSick, used: usedSick, remaining: employee.leaveBalanceSick - usedSick },
  });
}
