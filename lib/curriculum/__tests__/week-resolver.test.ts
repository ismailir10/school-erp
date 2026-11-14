import { describe, it, expect, vi, beforeEach } from "vitest";

const { weekFindFirst } = vi.hoisted(() => ({
  weekFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { week: { findFirst: weekFindFirst } },
}));

import { getCurrentWeek } from "@/lib/curriculum/week-resolver";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentWeek", () => {
  it("returns the active week containing the target date", async () => {
    weekFindFirst.mockResolvedValue({
      id: "wk1",
      number: 3,
      startDate: new Date("2026-05-11T00:00:00Z"),
      endDate: new Date("2026-05-15T00:00:00Z"),
      subTheme: {
        id: "st1",
        name: "Sub Theme",
        theme: { id: "th1", name: "Theme", semesterId: "sem1" },
      },
    });
    const r = await getCurrentWeek("t1", new Date("2026-05-14T00:00:00Z"), "A");
    expect(r?.id).toBe("wk1");
    const callArgs = weekFindFirst.mock.calls[0][0];
    expect(callArgs.where.tenantId).toBe("t1");
    expect(callArgs.where.status).toBe("ACTIVE");
    expect(callArgs.where.startDate.lte).toEqual(
      new Date("2026-05-14T00:00:00Z"),
    );
    expect(callArgs.where.endDate.gte).toEqual(
      new Date("2026-05-14T00:00:00Z"),
    );
  });

  it("filters to themes visible to the class kelompok (own group + shared)", async () => {
    weekFindFirst.mockResolvedValue(null);
    await getCurrentWeek("t1", new Date("2026-05-14T00:00:00Z"), "B");
    const where = weekFindFirst.mock.calls[0][0].where;
    expect(where.subTheme.status).toBe("ACTIVE");
    expect(where.subTheme.theme).toMatchObject({
      status: "ACTIVE",
      semester: { status: "ACTIVE", startDate: { lte: new Date("2026-05-14T00:00:00Z") }, endDate: { gte: new Date("2026-05-14T00:00:00Z") } },
      OR: [{ ageGroup: "B" }, { ageGroup: null }],
    });
  });

  it("selects theme.ageGroup", async () => {
    weekFindFirst.mockResolvedValue(null);
    await getCurrentWeek("t1", new Date("2026-05-14T00:00:00Z"), "A");
    const select = weekFindFirst.mock.calls[0][0].select;
    expect(select.subTheme.select.theme.select.ageGroup).toBe(true);
  });

  it("resolves the A week for an A class and the B week for a B class on the same date; shared visible to both", async () => {
    const mk = (id: string, ageGroup: "A" | "B" | null) => ({
      id,
      number: 1,
      startDate: new Date("2026-05-11T00:00:00Z"),
      endDate: new Date("2026-05-15T00:00:00Z"),
      subTheme: { id: `st-${id}`, name: "S", theme: { id: `th-${id}`, name: "T", semesterId: "sem1", ageGroup } },
    });
    const weeks = [mk("wkA", "A"), mk("wkB", "B"), mk("wkShared", null)];
    // Emulate the DB applying the theme OR filter.
    weekFindFirst.mockImplementation(
      async ({ where }: { where: { subTheme: { theme: { OR: Array<{ ageGroup: string | null }> } } } }) =>
        weeks.find((w) =>
          where.subTheme.theme.OR.some((c) => c.ageGroup === w.subTheme.theme.ageGroup),
        ) ?? null,
    );
    const d = new Date("2026-05-14T00:00:00Z");
    expect((await getCurrentWeek("t1", d, "A"))?.id).toBe("wkA");
    expect((await getCurrentWeek("t1", d, "B"))?.id).toBe("wkB");
    // With only the shared week present, both groups see it.
    weeks.splice(0, 2);
    expect((await getCurrentWeek("t1", d, "A"))?.id).toBe("wkShared");
    expect((await getCurrentWeek("t1", d, "B"))?.id).toBe("wkShared");
  });

  it("returns null when no active week brackets the date", async () => {
    weekFindFirst.mockResolvedValue(null);
    const r = await getCurrentWeek("t1", new Date("2026-05-14T00:00:00Z"), "A");
    expect(r).toBeNull();
  });
});
