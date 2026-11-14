import { describe, it, expect, vi, beforeEach } from "vitest";

// Weeks admin: overlap is checked within the theme's kelompok scope
// (cycle 2026-11-06-theme-age-group). TK A and TK B weeks may share dates;
// a shared theme (ageGroup null) overlaps both.

const { subThemeFindFirst, weekFindMany, weekFindFirst, weekCreate, weekUpdate, auditLogCreate } =
  vi.hoisted(() => ({
    subThemeFindFirst: vi.fn(),
    weekFindMany: vi.fn(),
    weekFindFirst: vi.fn(),
    weekCreate: vi.fn(),
    weekUpdate: vi.fn(),
    auditLogCreate: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    subTheme: { findFirst: subThemeFindFirst },
    week: {
      findMany: weekFindMany,
      findFirst: weekFindFirst,
      create: weekCreate,
      update: weekUpdate,
    },
    auditLog: { create: auditLogCreate },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { POST } from "@/app/api/admin/curriculum/weeks/route";
import { PUT } from "@/app/api/admin/curriculum/weeks/[id]/route";
import { getSession } from "@/lib/auth";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const admin = {
  id: "u1",
  email: "a@demo.local",
  name: "Admin",
  role: "SUPER_ADMIN" as const,
  tenantId: "t1",
  employeeId: null,
  parentId: null,
  permissions: [],
  customRoleCode: null,
};

function jsonReq(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/admin/curriculum/weeks", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const body = { subThemeId: "st1", number: 2, startDate: "2026-08-03", endDate: "2026-08-07" };
const otherGroupWeek = {
  id: "w-other",
  startDate: new Date("2026-08-03T00:00:00Z"),
  endDate: new Date("2026-08-07T00:00:00Z"),
  status: "ACTIVE",
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  vi.mocked(getSession).mockResolvedValue(admin);
  auditLogCreate.mockResolvedValue({ id: "a1" });
  weekCreate.mockResolvedValue({
    id: "w-new", subThemeId: "st1", number: 2,
    startDate: new Date("2026-08-03T00:00:00Z"),
    endDate: new Date("2026-08-07T00:00:00Z"),
    status: "ACTIVE",
  });
});

/** findMany #1 = same-subtheme siblings, #2 = scoped lookup. */
function mockWeeks(siblings: unknown[], scoped: unknown[]) {
  weekFindMany.mockResolvedValueOnce(siblings).mockResolvedValueOnce(scoped);
}

describe("POST /weeks — kelompok scope", () => {
  it("409 with scope label when a week in the same kelompok overlaps", async () => {
    subThemeFindFirst.mockResolvedValue({ id: "st1", theme: { semester: { startDate: new Date("2026-07-01"), endDate: new Date("2026-12-31") }, semesterId: "sem1", ageGroup: "A" } });
    mockWeeks([], [otherGroupWeek]);
    const res = await POST(jsonReq(body) as never);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("Pekan bertumpang tindih dengan pekan lain di TK A.");
    expect(json.conflictingWeekId).toBe("w-other");
    expect(weekCreate).not.toHaveBeenCalled();
  });

  it("scopes the lookup to themes sharing viewers with the new theme", async () => {
    subThemeFindFirst.mockResolvedValue({ id: "st1", theme: { semester: { startDate: new Date("2026-07-01"), endDate: new Date("2026-12-31") }, semesterId: "sem1", ageGroup: "A" } });
    mockWeeks([], []);
    await POST(jsonReq(body) as never);
    const where = weekFindMany.mock.calls[1][0].where;
    expect(where.subTheme.theme.semesterId).toBe("sem1");
    expect(where.subTheme.theme.OR).toEqual([{ ageGroup: "A" }, { ageGroup: null }]);
  });

  it("201 for TK B week on the same dates as a TK A week (disjoint scopes)", async () => {
    subThemeFindFirst.mockResolvedValue({ id: "st1", theme: { semester: { startDate: new Date("2026-07-01"), endDate: new Date("2026-12-31") }, semesterId: "sem1", ageGroup: "B" } });
    // The scoped query (A excluded by the where) returns nothing.
    mockWeeks([], []);
    const res = await POST(jsonReq(body) as never);
    expect(res.status).toBe(201);
    expect(weekCreate).toHaveBeenCalled();
  });

  it("shared theme checks against every kelompok (no ageGroup filter)", async () => {
    subThemeFindFirst.mockResolvedValue({ id: "st1", theme: { semester: { startDate: new Date("2026-07-01"), endDate: new Date("2026-12-31") }, semesterId: "sem1", ageGroup: null } });
    mockWeeks([], [otherGroupWeek]);
    const res = await POST(jsonReq(body) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Semua kelompok");
    const where = weekFindMany.mock.calls[1][0].where;
    expect(where.subTheme.theme.OR).toBeUndefined();
  });
});

describe("PUT /weeks/[id] — kelompok scope", () => {
  const before = {
    id: "w1",
    subThemeId: "st1",
    number: 1,
    startDate: new Date("2026-08-03T00:00:00Z"),
    endDate: new Date("2026-08-07T00:00:00Z"),
    status: "INACTIVE",
  };

  it("409 when reactivating into a slot taken within the kelompok; excludes self", async () => {
    weekFindFirst.mockResolvedValue(before);
    subThemeFindFirst.mockResolvedValue({ id: "st1", theme: { semester: { startDate: new Date("2026-07-01"), endDate: new Date("2026-12-31") }, semesterId: "sem1", ageGroup: "B" } });
    mockWeeks([], [otherGroupWeek]);
    const res = await PUT(
      jsonReq({ status: "ACTIVE" }, "PUT") as never,
      { params: Promise.resolve({ id: "w1" }) } as never,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Pekan bertumpang tindih dengan pekan lain di TK B.");
    expect(weekFindMany.mock.calls[1][0].where.id).toEqual({ notIn: ["w1"] });
    expect(weekUpdate).not.toHaveBeenCalled();
  });

  it("200 when the same dates exist only in the other kelompok", async () => {
    weekFindFirst.mockResolvedValue(before);
    subThemeFindFirst.mockResolvedValue({ id: "st1", theme: { semester: { startDate: new Date("2026-07-01"), endDate: new Date("2026-12-31") }, semesterId: "sem1", ageGroup: "B" } });
    mockWeeks([], []);
    weekUpdate.mockResolvedValue({ ...before, status: "ACTIVE" });
    const res = await PUT(
      jsonReq({ status: "ACTIVE" }, "PUT") as never,
      { params: Promise.resolve({ id: "w1" }) } as never,
    );
    expect(res.status).toBe(200);
  });
});
