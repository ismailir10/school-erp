import { beforeEach, describe, expect, it, vi } from "vitest";

const indicatorCount = vi.hoisted(() => vi.fn());
const sectionFindMany = vi.hoisted(() => vi.fn());
const enrollmentGroupBy = vi.hoisted(() => vi.fn());
const entryGroupBy = vi.hoisted(() => vi.fn());
const noteGroupBy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  prisma: {
    studentJournalIndicator: { count: indicatorCount },
    classSection: { findMany: sectionFindMany },
    studentEnrollment: { groupBy: enrollmentGroupBy },
    studentJournalEntry: { groupBy: entryGroupBy },
    studentJournalNote: { groupBy: noteGroupBy },
  },
}));

import { loadJournalAnalytics } from "../journal";

const c = (n: number) => ({ _count: { _all: n } });

describe("loadJournalAnalytics", () => {
  beforeEach(() => {
    for (const m of [indicatorCount, sectionFindMany, enrollmentGroupBy, entryGroupBy, noteGroupBy]) m.mockReset();
  });

  function setup() {
    indicatorCount.mockResolvedValue(2);
    sectionFindMany.mockResolvedValue([
      { id: "c1", name: "TK A" },
      { id: "c2", name: "TK B" },
    ]);
    // c1: 5 students, c2: 5 students -> possible = 10 * 2 * 5 = 100 per week
    enrollmentGroupBy.mockResolvedValue([
      { classSectionId: "c1", ...c(5) },
      { classSectionId: "c2", ...c(5) },
    ]);
    entryGroupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by[0] === "date") {
        return [
          { date: "2026-10-19", ...c(30) }, // current week
          { date: "2026-10-20", ...c(30) },
          { date: "2026-10-12", ...c(500) }, // over-checked: capped
          { date: "2026-10-17", ...c(99) }, // Saturday, ignored
          { date: "2026-08-31", ...c(10) }, // oldest week
        ];
      }
      return [
        { classSectionId: "c1", ...c(50) },
        { classSectionId: "c2", ...c(10) },
        { classSectionId: null, ...c(7) },
      ];
    });
    noteGroupBy.mockResolvedValue([
      { date: "2026-10-20", authorRole: "TEACHER", ...c(4) },
      { date: "2026-10-21", authorRole: "GUARDIAN", ...c(2) },
      { date: "2026-10-17", authorRole: "GUARDIAN", ...c(1) }, // Saturday still counts
      { date: "2026-09-01", authorRole: "TEACHER", ...c(3) },
      { date: "2026-09-01", authorRole: "SCHOOL_ADMIN", ...c(8) }, // ignored role
      { date: "2026-08-01", authorRole: "TEACHER", ...c(50) }, // before window
    ]);
  }

  it("builds 8 weeks with capped completion, notes and least complete classes", async () => {
    setup();
    const out = await loadJournalAnalytics("t-1", "2026-10-21");
    expect(out.weeks).toHaveLength(8);
    expect(out.weeks[0].weekStart).toBe("2026-08-31");
    expect(out.weeks[7].weekStart).toBe("2026-10-19");
    expect(out.weeks[7]).toMatchObject({ checked: 60, possible: 100, completionPct: 60, teacherNotes: 4, guardianNotes: 2 });
    expect(out.thisWeekPct).toBe(60);
    expect(out.weeks[6]).toMatchObject({ checked: 500, completionPct: 100, guardianNotes: 1 });
    expect(out.weeks[0]).toMatchObject({ checked: 10, completionPct: 10, teacherNotes: 3 });
    expect(out.weeks[3].completionPct).toBe(0);
    expect(out.teacherNotes).toBe(7);
    expect(out.guardianNotes).toBe(3);
    expect(out.leastCompleteClasses).toEqual([
      { classSectionId: "c2", name: "TK B", completionPct: 20 },
      { classSectionId: "c1", name: "TK A", completionPct: 100 },
    ]);
  });

  it("scopes every query to the tenant and the SCHOOL / ACTIVE definitions", async () => {
    setup();
    await loadJournalAnalytics("t-1", "2026-10-21");
    expect(indicatorCount.mock.calls[0][0].where).toMatchObject({
      status: "ACTIVE",
      category: { scope: "SCHOOL", status: "ACTIVE", template: { tenantId: "t-1" } },
    });
    expect(sectionFindMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t-1", status: "ACTIVE" });
    expect(enrollmentGroupBy.mock.calls[0][0].where).toMatchObject({
      status: "ACTIVE",
      classSection: { tenantId: "t-1" },
    });
    expect(entryGroupBy).toHaveBeenCalledTimes(2);
    for (const [args] of entryGroupBy.mock.calls) {
      expect(args.where).toMatchObject({
        tenantId: "t-1",
        scope: "SCHOOL",
        checked: true,
        classSectionId: { in: ["c1", "c2"] },
      });
    }
    expect(noteGroupBy.mock.calls[0][0].where).toMatchObject({ tenantId: "t-1", status: "ACTIVE" });
  });

  it("returns null completion everywhere when no class has anything possible", async () => {
    indicatorCount.mockResolvedValue(0);
    sectionFindMany.mockResolvedValue([{ id: "c1", name: "TK A" }]);
    enrollmentGroupBy.mockResolvedValue([{ classSectionId: "c1", ...c(5) }]);
    entryGroupBy.mockResolvedValue([]);
    noteGroupBy.mockResolvedValue([]);
    const out = await loadJournalAnalytics("t-1", "2026-10-21");
    expect(out.thisWeekPct).toBeNull();
    expect(out.weeks.every((w) => w.completionPct === null && w.checked === 0)).toBe(true);
    expect(out.leastCompleteClasses).toEqual([]);
    expect(out.teacherNotes + out.guardianNotes).toBe(0);
  });

  it("skips entry queries when the tenant has no active classes", async () => {
    indicatorCount.mockResolvedValue(3);
    sectionFindMany.mockResolvedValue([]);
    enrollmentGroupBy.mockResolvedValue([]);
    noteGroupBy.mockResolvedValue([]);
    const out = await loadJournalAnalytics("t-1", "2026-10-21");
    expect(entryGroupBy).not.toHaveBeenCalled();
    expect(out.weeks).toHaveLength(8);
    expect(out.thisWeekPct).toBeNull();
  });
});
