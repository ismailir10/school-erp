import { beforeEach, describe, expect, it, vi } from "vitest";

const groupBy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { invoice: { groupBy } } }));

import { loadReceivables } from "../receivables";

describe("loadReceivables (R2-ADMIN-3)", () => {
  beforeEach(() => groupBy.mockReset());

  it("sums the unpaid balance across SENT / PARTIALLY_PAID / OVERDUE, tenant-scoped, and counts overdue", async () => {
    groupBy.mockResolvedValue([
      { status: "SENT", _count: { _all: 3 }, _sum: { totalDue: "3000000", totalPaid: "0" } },
      { status: "PARTIALLY_PAID", _count: { _all: 1 }, _sum: { totalDue: "1000000", totalPaid: "400000" } },
      { status: "OVERDUE", _count: { _all: 16 }, _sum: { totalDue: "52000000", totalPaid: "350000" } },
    ]);
    const out = await loadReceivables("t-1");
    expect(out).toEqual({ overdueCount: 16, receivable: 3000000 + 600000 + 51650000 });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t-1", status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      }),
    );
  });

  it("returns zeros when nothing is outstanding", async () => {
    groupBy.mockResolvedValue([]);
    expect(await loadReceivables("t-1")).toEqual({ overdueCount: 0, receivable: 0 });
  });
});
