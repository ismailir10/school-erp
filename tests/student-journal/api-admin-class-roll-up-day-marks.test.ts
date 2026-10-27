import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/** The admin class page lists the week's "hari tanpa buku penghubung" marks beside the roll-up. */
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  classFindFirst: vi.fn(),
  templateFindUnique: vi.fn(),
  indicatorCount: vi.fn(),
  enrollmentFindMany: vi.fn(),
  entryGroupBy: vi.fn(),
  markFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    classSection: { findFirst: mocks.classFindFirst },
    studentJournalTemplate: { findUnique: mocks.templateFindUnique },
    studentJournalIndicator: { count: mocks.indicatorCount },
    studentEnrollment: { findMany: mocks.enrollmentFindMany },
    studentJournalEntry: { groupBy: mocks.entryGroupBy },
    studentJournalDayMark: { findMany: mocks.markFindMany },
  },
}));
vi.mock("@/lib/student-journal/guards", () => ({ requireAdmin: mocks.guard }));

import { GET } from "@/app/api/student-journal/admin/class-roll-up/route";

const req = (): NextRequest =>
  ({ nextUrl: new URL("http://localhost/api/student-journal/admin/class-roll-up?classSectionId=c1&weekStart=2026-10-26") }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ session: { id: "a1", tenantId: "t1", role: "SCHOOL_ADMIN" } });
  mocks.classFindFirst.mockResolvedValue({ id: "c1" });
  mocks.templateFindUnique.mockResolvedValue({ id: "tmpl" });
  mocks.indicatorCount.mockResolvedValue(3);
  mocks.enrollmentFindMany.mockResolvedValue([{ student: { id: "s1", name: "A" } }]);
  mocks.entryGroupBy.mockResolvedValue([]);
  mocks.markFindMany.mockResolvedValue([{ date: "2026-10-27", reason: "Renang" }]);
});

describe("GET /admin/class-roll-up — dayMarks", () => {
  it("returns the week's marks keyed by date, scoped to this tenant and class", async () => {
    const res = await GET(req());
    expect((await res.json()).data.dayMarks).toEqual({ "2026-10-27": "Renang" });
    expect(mocks.markFindMany.mock.calls[0][0].where).toEqual({
      tenantId: "t1", classSectionId: "c1",
      date: { in: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"] },
    });
  });

  it("still returns the marks for a class with no active pupils", async () => {
    mocks.enrollmentFindMany.mockResolvedValue([]);
    const res = await GET(req());
    expect((await res.json()).data).toMatchObject({ students: [], dayMarks: { "2026-10-27": "Renang" } });
  });

  it("looks up no marks for a class outside the tenant", async () => {
    mocks.classFindFirst.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(404);
    expect(mocks.markFindMany).not.toHaveBeenCalled();
  });

  it("refuses a non-admin before touching any data", async () => {
    mocks.guard.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    expect((await GET(req())).status).toBe(403);
    expect(mocks.markFindMany).not.toHaveBeenCalled();
  });
});
