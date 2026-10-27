import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The wali's week payload carries the "hari tanpa buku penghubung" keterangan
 * for the child's own classes, keyed by date, so the grid can say "Renang"
 * instead of a row of strips.
 */
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  templateFindUnique: vi.fn(),
  dayMarks: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    studentJournalTemplate: { findUnique: mocks.templateFindUnique },
    studentJournalCategory: { findMany: vi.fn().mockResolvedValue([]) },
    studentJournalEntry: { findMany: vi.fn().mockResolvedValue([]) },
    studentJournalNote: { findMany: vi.fn().mockResolvedValue([]) },
    studentJournalAudit: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/student-journal/guards", () => ({ requireGuardianForStudent: mocks.guard }));
vi.mock("@/lib/student-journal/day-marks", () => ({ getDayMarksForStudentWeek: mocks.dayMarks }));

import { GET } from "@/app/api/student-journal/children/[id]/week/route";

const req = (): NextRequest =>
  ({ url: "http://localhost/api/student-journal/children/stu-1/week?weekStart=2026-10-26", headers: new Headers() }) as unknown as NextRequest;
const ctx = { params: Promise.resolve({ id: "stu-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ session: { id: "p1", tenantId: "t1", role: "PARENT" } });
  mocks.templateFindUnique.mockResolvedValue({ id: "tmpl" });
  mocks.dayMarks.mockResolvedValue({ "2026-10-27": "Renang" });
});

describe("GET /children/[id]/week — dayMarks", () => {
  it("returns the keterangan for the child's week, looked up for this tenant and child", async () => {
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.dayMarks).toEqual({ "2026-10-27": "Renang" });
    expect(mocks.dayMarks).toHaveBeenCalledWith("t1", "stu-1", ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  });

  it("returns an empty map when the school has no template, without a mark lookup", async () => {
    mocks.templateFindUnique.mockResolvedValue(null);
    const res = await GET(req(), ctx);
    expect((await res.json()).data.dayMarks).toEqual({});
    expect(mocks.dayMarks).not.toHaveBeenCalled();
  });

  it("is refused for a guardian of another child, before any mark lookup", async () => {
    mocks.guard.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(403);
    expect(mocks.dayMarks).not.toHaveBeenCalled();
  });
});
