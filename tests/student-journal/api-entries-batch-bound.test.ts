import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * TCH-7: the class-level bulk fill reuses POST /entries/batch, so the endpoint
 * is bounded — one request may not carry an unbounded transaction.
 */
const mocks = vi.hoisted(() => ({
  templateFindUnique: vi.fn(),
  indicatorFindMany: vi.fn(),
  enrollmentFindMany: vi.fn(),
  upsert: vi.fn(),
  guard: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    studentJournalTemplate: { findUnique: mocks.templateFindUnique },
    studentJournalIndicator: { findMany: mocks.indicatorFindMany },
    studentEnrollment: { findMany: mocks.enrollmentFindMany },
  },
}));
vi.mock("@/lib/student-journal/guards", () => ({ requireTeacherForClass: mocks.guard }));
vi.mock("@/lib/student-journal/entry-writes", () => ({ upsertJournalEntriesWithAudit: mocks.upsert }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));

import { POST } from "@/app/api/student-journal/entries/batch/route";
import { JOURNAL_BATCH_MAX_ENTRIES } from "@/lib/validations/student-journal";

const req = (body: unknown): NextRequest =>
  ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;

const entries = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ studentId: "s1", indicatorId: `ind-${i}`, checked: true }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ session: { id: "u1", tenantId: "t1", role: "TEACHER" } });
  mocks.rateLimit.mockReturnValue({ success: true });
  mocks.templateFindUnique.mockResolvedValue({ id: "tmpl" });
  mocks.enrollmentFindMany.mockResolvedValue([{ studentId: "s1" }]);
  mocks.upsert.mockResolvedValue(1);
});

describe("POST /entries/batch bound", () => {
  it("rejects a request over the cap before touching auth-scoped data", async () => {
    const res = await POST(req({ classSectionId: "c1", date: "2026-09-29", entries: entries(JOURNAL_BATCH_MAX_ENTRIES + 1) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(String(JOURNAL_BATCH_MAX_ENTRIES));
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("accepts exactly the cap and still runs the class-assignment guard + rate limit", async () => {
    mocks.indicatorFindMany.mockResolvedValue(entries(JOURNAL_BATCH_MAX_ENTRIES).map((e) => ({ id: e.indicatorId })));
    const res = await POST(req({ classSectionId: "c1", date: "2026-09-29", entries: entries(JOURNAL_BATCH_MAX_ENTRIES) }));
    expect(res.status).toBe(200);
    expect(mocks.guard).toHaveBeenCalledWith("c1", { viaSentra: true });
    expect(mocks.rateLimit).toHaveBeenCalledWith("sj-teacher-u1", 300, 60_000);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
});
