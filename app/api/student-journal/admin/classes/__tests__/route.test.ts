/**
 * GET /api/student-journal/admin/classes — ACAD-8: `lastFilledAt` must be
 * derived from the same *checked* entries as `checkedCount`, so a class whose
 * entries were all toggled off again does not show a fill date next to 0
 * entries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  db: {
    studentJournalTemplate: { findUnique: vi.fn() },
    studentJournalIndicator: { count: vi.fn() },
    academicYear: { findFirst: vi.fn() },
    classSection: { findMany: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    studentJournalEntry: { groupBy: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/student-journal/guards", () => ({ requireAdmin }));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ session: { tenantId: "t1" } });
  db.studentJournalTemplate.findUnique.mockResolvedValue({ id: "tpl" });
  db.studentJournalIndicator.count.mockResolvedValue(4);
  db.academicYear.findFirst.mockResolvedValue({ id: "ay" });
  db.classSection.findMany.mockResolvedValue([{ id: "kb", name: "KB", program: { name: "KB" }, campus: { name: "Taman Aster" } }]);
  db.studentEnrollment.findMany.mockResolvedValue([{ studentId: "s1", classSectionId: "kb" }]);
});

describe("GET /api/student-journal/admin/classes", () => {
  it("scopes lastFilledAt to checked entries, the same predicate as checkedCount", async () => {
    db.studentJournalEntry.groupBy
      .mockResolvedValueOnce([{ classSectionId: "kb", _count: { id: 4 } }])
      .mockResolvedValueOnce([{ classSectionId: "kb", _max: { updatedAt: new Date("2026-09-29T03:00:00Z") } }]);

    const res = await GET({
      nextUrl: new URL("http://t/api/student-journal/admin/classes?weekStart=2026-09-28"),
    } as never);
    const body = await res.json();

    expect(body.data[0]).toMatchObject({ checkedCount: 4, lastFilledAt: "2026-09-29T03:00:00.000Z" });
    const [countCall, lastFilledCall] = db.studentJournalEntry.groupBy.mock.calls;
    expect(countCall![0].where.checked).toBe(true);
    expect(lastFilledCall![0].where.checked).toBe(true);
  });

  it("returns the campus name and includes it in the query", async () => {
    db.studentJournalEntry.groupBy.mockResolvedValue([]);
    const res = await GET({
      nextUrl: new URL("http://t/api/student-journal/admin/classes?weekStart=2026-09-28"),
    } as never);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ campusName: "Taman Aster" });
    expect(db.classSection.findMany.mock.calls[0]![0].include.campus).toEqual({ select: { name: true } });
  });

  it("reports no fill date for a class with no checked entries", async () => {
    db.studentJournalEntry.groupBy.mockResolvedValue([]);
    const res = await GET({
      nextUrl: new URL("http://t/api/student-journal/admin/classes?weekStart=2026-09-28"),
    } as never);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ checkedCount: 0, lastFilledAt: null });
  });
});
