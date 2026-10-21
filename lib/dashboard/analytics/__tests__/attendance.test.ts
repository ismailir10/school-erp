import { beforeEach, describe, expect, it, vi } from "vitest";

const groupBy = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  prisma: { studentAttendance: { groupBy }, classSection: { findMany } },
}));

import { loadAttendanceAnalytics } from "../attendance";

const c = (n: number) => ({ _count: { _all: n } });

describe("loadAttendanceAnalytics", () => {
  beforeEach(() => {
    groupBy.mockReset();
    findMany.mockReset();
  });

  function setup() {
    groupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.join() === "date,status") {
        return [
          { date: "2026-10-20", status: "PRESENT", ...c(8) },
          { date: "2026-10-20", status: "ABSENT", ...c(2) },
          { date: "2026-10-19", status: "PRESENT", ...c(10) },
        ];
      }
      if (args.by.join() === "status") {
        return [
          { status: "PRESENT", ...c(3) },
          { status: "SICK", ...c(1) },
        ];
      }
      return [
        { classSectionId: "c1", status: "PRESENT", ...c(10) },
        { classSectionId: "c1", status: "ABSENT", ...c(10) },
        { classSectionId: "c2", status: "PRESENT", ...c(8) },
        { classSectionId: "c2", status: "SICK", ...c(2) },
        { classSectionId: "gone", status: "ABSENT", ...c(9) },
      ];
    });
    findMany.mockResolvedValue([
      { id: "c1", name: "TK A" },
      { id: "c2", name: "TK B" },
    ]);
  }

  it("shapes the window, deltas and lowest classes", async () => {
    setup();
    const out = await loadAttendanceAnalytics("t-1", "2026-10-21");
    expect(out.windowStart).toBe("2026-09-22");
    expect(out.windowEnd).toBe("2026-10-21");
    expect(out.days.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-20"]);
    expect(out.days[1]).toMatchObject({ present: 8, absent: 2, total: 10, rate: 80 });
    expect(out.totalRecords).toBe(20);
    expect(out.rate).toBe(90);
    expect(out.previousRate).toBe(75);
    expect(out.lowestClasses).toEqual([
      { classSectionId: "c1", name: "TK A", rate: 50, total: 20 },
      { classSectionId: "c2", name: "TK B", rate: 80, total: 10 },
    ]);
  });

  it("scopes every query to the tenant, excludes voided rows and bounds the dates", async () => {
    setup();
    await loadAttendanceAnalytics("t-1", "2026-10-21");
    expect(groupBy).toHaveBeenCalledTimes(3);
    for (const [args] of groupBy.mock.calls) {
      expect(args.where.classSection).toEqual({ tenantId: "t-1" });
      expect(args.where.isVoided).toBe(false);
      expect(args.where.date.gte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.where.date.lte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const prev = groupBy.mock.calls.find(([a]) => a.by.join() === "status")![0];
    expect(prev.where.date).toEqual({ gte: "2026-08-23", lte: "2026-09-21" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["c1", "c2", "gone"] }, tenantId: "t-1", status: "ACTIVE" },
      }),
    );
  });

  it("returns an empty, null-rate result when there are no records", async () => {
    groupBy.mockResolvedValue([]);
    const out = await loadAttendanceAnalytics("t-1", "2026-10-21");
    expect(out).toMatchObject({
      days: [],
      rate: null,
      previousRate: null,
      totalRecords: 0,
      lowestClasses: [],
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("propagates a query failure", async () => {
    groupBy.mockRejectedValue(new Error("db down"));
    await expect(loadAttendanceAnalytics("t-1", "2026-10-21")).rejects.toThrow("db down");
  });
});
