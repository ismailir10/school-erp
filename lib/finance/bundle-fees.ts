import type { Prisma } from "@/lib/generated/prisma/client";
import { BILLABLE_FEE_COMPONENT_WHERE } from "@/lib/finance/billable-fees";

/**
 * Harga paket sekolah + daycare (docs/cycles/2026-10-29-school-daycare-bundle-price.md).
 *
 * A bundle fee is an explicit total for ONE fee component, for one school program
 * (Program.type SEMESTER) + one daycare program (YEAR_ROUND), for one academic year.
 * `buildBillingRunRows` uses it in place of the summed component when a student's
 * billed placements include both programs. This is the single read of those rows,
 * shared by the Billing Run materializer and the "Catat SPP di muka" loader so both
 * price a child the same.
 */

export type BundleFee = {
  schoolProgramId: string;
  daycareProgramId: string;
  feeComponentId: string;
  amount: Prisma.Decimal;
};

/**
 * Active bundle prices whose BOTH programs are among `programIds`. The program types
 * and the billable component are re-checked here (not only when the price is saved),
 * so a later Program.type edit or a disabled / one-time component turns a bundle off
 * instead of mispricing. Fewer than two programs can never form a pair: no query.
 */
export async function loadBundleFees(
  db: Pick<Prisma.TransactionClient, "programBundleFee">,
  input: { tenantId: string; academicYearId: string; programIds: string[] },
): Promise<ReadonlyArray<BundleFee>> {
  const { tenantId, academicYearId, programIds } = input;
  if (programIds.length < 2) return [];

  const rows = await db.programBundleFee.findMany({
    where: {
      tenantId,
      academicYearId,
      status: "ACTIVE",
      schoolProgramId: { in: programIds },
      daycareProgramId: { in: programIds },
      schoolProgram: { type: "SEMESTER", tenantId },
      daycareProgram: { type: "YEAR_ROUND", tenantId },
      feeComponent: BILLABLE_FEE_COMPONENT_WHERE,
    },
    select: { schoolProgramId: true, daycareProgramId: true, feeComponentId: true, amount: true },
  });

  return rows.map((r) => ({
    schoolProgramId: r.schoolProgramId,
    daycareProgramId: r.daycareProgramId,
    feeComponentId: r.feeComponentId,
    amount: r.amount,
  }));
}
