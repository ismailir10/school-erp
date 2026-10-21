import { beforeEach, describe, expect, it, vi } from "vitest";

const groupBy = vi.hoisted(() => vi.fn());
const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  prisma: { invoice: { groupBy }, $queryRaw: queryRaw },
}));

import { loadFinanceAnalytics } from "../finance";

const dec = (n: number) => String(n); // Prisma Decimal stringifies

describe("loadFinanceAnalytics", () => {
  beforeEach(() => {
    groupBy.mockReset();
    queryRaw.mockReset();
  });

  function setup() {
    groupBy.mockImplementation(async (args: { where: { status: { in?: string[]; notIn?: string[] } } }) => {
      if (args.where.status.notIn) {
        return [
          { dueDate: "2026-10-05", _sum: { totalDue: dec(3000000), totalPaid: dec(1000000) } },
          { dueDate: "2026-10-25", _sum: { totalDue: dec(1000000), totalPaid: dec(1000000) } },
          { dueDate: "2026-08-10", _sum: { totalDue: dec(2000000), totalPaid: dec(2000000) } },
        ];
      }
      return [
        { dueDate: "2026-10-25", _count: { _all: 2 }, _sum: { totalDue: dec(500000), totalPaid: dec(0) } },
        { dueDate: "2026-10-05", _count: { _all: 3 }, _sum: { totalDue: dec(3000000), totalPaid: dec(1000000) } },
        { dueDate: "2026-06-01", _count: { _all: 1 }, _sum: { totalDue: dec(700000), totalPaid: dec(200000) } },
      ];
    });
    queryRaw.mockResolvedValue([
      { month: "2026-10", total: dec(2000000) },
      { month: "2026-08", total: dec(2000000) },
      { month: "2026-04", total: dec(1) }, // outside the window
    ]);
  }

  it("shapes months, this month and aging", async () => {
    setup();
    const out = await loadFinanceAnalytics("t-1", "2026-10-21");
    expect(out.months.map((m) => m.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(out.months[5]).toEqual({ month: "2026-10", billed: 4000000, collected: 2000000 });
    expect(out.months[3]).toEqual({ month: "2026-08", billed: 2000000, collected: 2000000 });
    expect(out.months[0]).toEqual({ month: "2026-05", billed: 0, collected: 0 });
    expect(out.thisMonth).toEqual({ billed: 4000000, paid: 2000000, rate: 50 });
    expect(out.aging.map((a) => a.key)).toEqual(["current", "d1_30", "d31_60", "d61_90", "d90_plus"]);
    expect(out.aging).toEqual([
      { key: "current", amount: 500000, count: 2 },
      { key: "d1_30", amount: 2000000, count: 3 },
      { key: "d31_60", amount: 0, count: 0 },
      { key: "d61_90", amount: 0, count: 0 },
      { key: "d90_plus", amount: 500000, count: 1 }, // due 2026-06-01, 142 days late
    ]);
    expect(out.outstandingTotal).toBe(3000000);
  });

  it("scopes invoice and payment queries to the tenant and excludes draft / cancelled / reversed", async () => {
    setup();
    await loadFinanceAnalytics("t-1", "2026-10-21");
    expect(groupBy).toHaveBeenCalledTimes(2);
    for (const [args] of groupBy.mock.calls) {
      expect(args.where.tenantId).toBe("t-1");
    }
    const billed = groupBy.mock.calls.find(([a]) => a.where.status.notIn)![0];
    expect(billed.where.status.notIn).toEqual(["DRAFT", "CANCELLED"]);
    expect(billed.where.dueDate).toEqual({ gte: "2026-05-01", lte: "2026-10-31" });
    const aging = groupBy.mock.calls.find(([a]) => a.where.status.in)![0];
    expect(aging.where.status.in).toEqual(["SENT", "PARTIALLY_PAID", "OVERDUE"]);

    const [strings, ...values] = queryRaw.mock.calls[0];
    const sql = (strings as readonly string[]).join("?");
    expect(sql).toContain(`i."tenantId" = ?`);
    expect(sql).toContain(`<> 'REVERSED'`);
    expect(sql).toContain("Asia/Jakarta");
    expect(values[0]).toBe("t-1");
    expect((values[1] as Date).toISOString()).toBe("2026-04-30T17:00:00.000Z"); // 2026-05-01 00:00 WIB
    expect((values[2] as Date).toISOString()).toBe("2026-10-31T17:00:00.000Z"); // 2026-11-01 00:00 WIB
  });

  it("returns zeroed, null-rate output for an empty tenant", async () => {
    groupBy.mockResolvedValue([]);
    queryRaw.mockResolvedValue([]);
    const out = await loadFinanceAnalytics("t-1", "2026-10-21");
    expect(out.months).toHaveLength(6);
    expect(out.months.every((m) => m.billed === 0 && m.collected === 0)).toBe(true);
    expect(out.thisMonth).toEqual({ billed: 0, paid: 0, rate: null });
    expect(out.aging).toHaveLength(5);
    expect(out.outstandingTotal).toBe(0);
  });
});
