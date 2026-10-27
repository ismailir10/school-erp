import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * X-5 — the teacher week route also returns the parent's "Di rumah" (HOME
 * scope) ticks, kept apart from the school grid so the two are never mixed.
 */

const mocks = vi.hoisted(() => ({
  enrollmentFindMany: vi.fn(),
  assignmentFindMany: vi.fn(),
  templateFindUnique: vi.fn(),
  categoryFindMany: vi.fn(),
  entryFindMany: vi.fn(),
  noteFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    studentEnrollment: { findMany: mocks.enrollmentFindMany },
    teachingAssignment: { findMany: mocks.assignmentFindMany },
    studentJournalTemplate: { findUnique: mocks.templateFindUnique },
    studentJournalCategory: { findMany: mocks.categoryFindMany },
    studentJournalEntry: { findMany: mocks.entryFindMany },
    studentJournalNote: { findMany: mocks.noteFindMany },
    studentJournalAudit: { findMany: mocks.auditFindMany },
    studentJournalDayMark: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: mocks.userFindMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

import { getSession } from "@/lib/auth";
import { GET } from "@/app/api/student-journal/students/[id]/week/route";

const req = (): NextRequest =>
  ({
    url: "http://localhost/api/student-journal/students/stu-1/week?weekStart=2026-09-28",
    headers: new Headers(),
  }) as unknown as NextRequest;

const category = (id: string, scope: "SCHOOL" | "HOME", indicators: string[]) => ({
  id,
  name: id,
  scope,
  order: 1,
  indicators: indicators.map((label, i) => ({ id: `${id}-${i}`, label, order: i })),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({
    id: "t1",
    role: "TEACHER",
    tenantId: "tenant-1",
    employeeId: "emp-1",
  } as never);
  mocks.enrollmentFindMany.mockResolvedValue([
    { classSectionId: "c1", classSection: { name: "TKIT A" }, student: { id: "stu-1", name: "Bilal", nickname: null } },
  ]);
  mocks.assignmentFindMany.mockResolvedValue([{ classSectionId: "c1" }]);
  mocks.templateFindUnique.mockResolvedValue({ id: "tmpl-1" });
  mocks.auditFindMany.mockResolvedValue([]);
  mocks.noteFindMany.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.categoryFindMany.mockResolvedValue([
    category("school", "SCHOOL", ["Sholat"]),
    category("home", "HOME", ["Sholat 5 waktu", "Doa harian"]),
    category("home-empty", "HOME", []),
  ]);
  mocks.entryFindMany.mockResolvedValue([
    { id: "e1", indicatorId: "school-0", date: "2026-09-29", checked: true, scope: "SCHOOL" },
    { id: "e2", indicatorId: "home-0", date: "2026-09-29", checked: true, scope: "HOME" },
    { id: "e3", indicatorId: "home-1", date: "2026-09-28", checked: false, scope: "HOME" },
  ]);
});

describe("GET /api/student-journal/students/[id]/week — Di rumah (X-5)", () => {
  it("returns the parent's HOME ticks separately from the school grid", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: "stu-1" }) });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.categories.map((c: { id: string }) => c.id)).toEqual(["school"]);
    expect(data.entries.map((e: { id: string }) => e.id)).toEqual(["e1"]);
    // HOME categories without an active indicator are dropped.
    expect(data.homeCategories.map((c: { id: string }) => c.id)).toEqual(["home"]);
    expect(data.homeEntries).toEqual([
      { id: "e2", indicatorId: "home-0", date: "2026-09-29", checked: true },
      { id: "e3", indicatorId: "home-1", date: "2026-09-28", checked: false },
    ]);
  });

  it("scopes the read to this tenant and student, for both scopes", async () => {
    await GET(req(), { params: Promise.resolve({ id: "stu-1" }) });
    const where = mocks.entryFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: "tenant-1", studentId: "stu-1", scope: { in: ["SCHOOL", "HOME"] } });
  });

  it("still refuses a teacher who is not assigned to the student's class", async () => {
    mocks.assignmentFindMany.mockResolvedValue([]);
    const res = await GET(req(), { params: Promise.resolve({ id: "stu-1" }) });
    expect(res.status).toBe(403);
    expect(mocks.entryFindMany).not.toHaveBeenCalled();
  });

  it("returns empty home fields when the school has no template", async () => {
    mocks.templateFindUnique.mockResolvedValue(null);
    const { data } = await (await GET(req(), { params: Promise.resolve({ id: "stu-1" }) })).json();
    expect(data.homeCategories).toEqual([]);
    expect(data.homeEntries).toEqual([]);
  });
});
