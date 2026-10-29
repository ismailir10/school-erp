import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { loadBundleFees } from "../bundle-fees";

const D = (v: number | string) => new Prisma.Decimal(v);

function dbWith(rows: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { db: { programBundleFee: { findMany } } as never, findMany };
}

describe("loadBundleFees", () => {
  it.each([[[]], [["p-school"]]])("does not query with fewer than two programs (%j)", async (programIds) => {
    const { db, findMany } = dbWith();
    const out = await loadBundleFees(db, { tenantId: "t-1", academicYearId: "ay-1", programIds });
    expect(out).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("reads only active, same-tenant, correctly typed pairs of a billable component in the year", async () => {
    const { db, findMany } = dbWith();
    await loadBundleFees(db, { tenantId: "t-1", academicYearId: "ay-1", programIds: ["p-school", "p-dc"] });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "t-1",
        academicYearId: "ay-1",
        status: "ACTIVE",
        schoolProgramId: { in: ["p-school", "p-dc"] },
        daycareProgramId: { in: ["p-school", "p-dc"] },
        schoolProgram: { type: "SEMESTER", tenantId: "t-1" },
        daycareProgram: { type: "YEAR_ROUND", tenantId: "t-1" },
        feeComponent: { isEnabled: true, isRecurring: true },
      },
      select: { schoolProgramId: true, daycareProgramId: true, feeComponentId: true, amount: true },
    });
  });

  it("returns the rows mapped to the pair, component and amount", async () => {
    const { db } = dbWith([
      // Extra columns a loose mock might carry must not leak through.
      { schoolProgramId: "p-school", daycareProgramId: "p-dc", feeComponentId: "fc-spp", amount: D(1_560_000), id: "x" },
    ]);
    const out = await loadBundleFees(db, { tenantId: "t-1", academicYearId: "ay-1", programIds: ["p-school", "p-dc"] });
    expect(out).toEqual([
      { schoolProgramId: "p-school", daycareProgramId: "p-dc", feeComponentId: "fc-spp", amount: D(1_560_000) },
    ]);
    expect(out[0].amount.toString()).toBe("1560000");
  });
});
