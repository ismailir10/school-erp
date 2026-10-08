import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  weekFindFirst,
  studentEnrollmentFindMany,
  achievementIndicatorFindMany,
  assessmentEntryFindMany,
  teachingAssignmentFindMany,
} = vi.hoisted(() => ({
  weekFindFirst: vi.fn(),
  studentEnrollmentFindMany: vi.fn(),
  achievementIndicatorFindMany: vi.fn(),
  assessmentEntryFindMany: vi.fn(),
  teachingAssignmentFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    week: { findFirst: weekFindFirst },
    studentEnrollment: { findMany: studentEnrollmentFindMany },
    achievementIndicator: { findMany: achievementIndicatorFindMany },
    assessmentEntry: { findMany: assessmentEntryFindMany },
    teachingAssignment: { findMany: teachingAssignmentFindMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

import { GET } from "@/app/api/teacher/assessment-entries/center/[center]/route";
import { getSession } from "@/lib/auth";

const teacher = {
  id: "u1",
  email: "sentra@demo.local",
  name: "Sentra",
  role: "TEACHER" as const,
  tenantId: "t1",
  employeeId: "emp1",
  parentId: null,
  permissions: ["assessments.read", "assessments.write"],
  customRoleCode: null,
};

function req(
  centerSlug = "WORSHIP",
  qs = "date=2026-05-14&ageGroup=A",
): Request {
  return new Request(
    `http://localhost/api/teacher/assessment-entries/center/${centerSlug}?${qs}`,
  );
}

const happy = () => {
  weekFindFirst.mockResolvedValue({
    id: "wk1",
    number: 3,
    startDate: new Date("2026-05-11T00:00:00Z"),
    endDate: new Date("2026-05-15T00:00:00Z"),
    subTheme: {
      id: "st1",
      name: "Sub",
      theme: { id: "th1", name: "Theme", semesterId: "sem1" },
    },
  });
  // ClassSection.ageGroup is now a DB-side filter (column added
  // 2026-05-20 in feat/curriculum-cutover-prep T1). The route's where
  // clause already constrains classSection.ageGroup === requested
  // ageGroup, so the mock returns only the matching subset; the prior
  // post-query name-heuristic that excluded TKIT B is gone.
  studentEnrollmentFindMany.mockResolvedValue([
    {
      classSection: { id: "cs1", name: "TKIT A" },
      student: { id: "stu1", name: "Ali", nickname: "Ali", status: "ACTIVE" },
    },
  ]);
  teachingAssignmentFindMany.mockResolvedValue([{ classSectionId: "cs1" }]);
  achievementIndicatorFindMany.mockResolvedValue([
    {
      id: "ind1",
      content: "Indicator 1",
      order: 0,
      objective: { id: "obj1", ageGroup: "A", element: "RELIGIOUS_MORAL" },
    },
  ]);
  assessmentEntryFindMany.mockResolvedValue([
    {
      id: "e1",
      studentId: "stu1",
      indicatorId: "ind1",
      level: "CONSISTENT",
      note: null,
      activity: "Doa pagi",
    },
  ]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/teacher/assessment-entries/center/[center]", () => {
  it("401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 when caller lacks assessments.read", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...teacher, permissions: [] });
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    expect(res.status).toBe(403);
  });

  it("404 when the center segment is unknown", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    const res = await GET(req("UNKNOWN") as never, {
      params: Promise.resolve({ center: "UNKNOWN" }),
    });
    expect(res.status).toBe(404);
  });

  it("400 when ageGroup query param is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    const res = await GET(req("WORSHIP", "date=2026-05-14") as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    expect(res.status).toBe(400);
  });

  it("422 when no active week brackets the date", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    weekFindFirst.mockResolvedValue(null);
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.reason).toBe("no_active_week");
  });

  it("200 happy path — payload echoes center + ageGroup + week + filtered roster", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.center).toBe("WORSHIP");
    expect(body.ageGroup).toBe("A");
    expect(body.week.number).toBe(3);
    // Only TKIT A student survived the ageGroup filter.
    expect(body.students.map((s: { id: string }) => s.id)).toEqual(["stu1"]);
    expect(body.indicators).toHaveLength(1);
    expect(body.entries[0].activity).toBe("Doa pagi");
    expect(body.lastActivity).toBe("Doa pagi");
    expect(body.writable).toBe(true);
  });

  it("returns a read-only payload when the caller may read but not write", async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...teacher,
      permissions: ["assessments.read"],
    });
    happy();
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).writable).toBe(false);
  });

  it("200 entries query is scoped to source CENTER + center + date", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    await GET(req() as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    const callArgs = assessmentEntryFindMany.mock.calls[0][0];
    expect(callArgs.where.source).toBe("CENTER");
    expect(callArgs.where.center).toBe("WORSHIP");
    expect(callArgs.where.weekId).toBe("wk1");
  });

  it("200 indicator query is filtered to ageGroup", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    await GET(req() as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    const callArgs = achievementIndicatorFindMany.mock.calls[0][0];
    expect(callArgs.where.objective).toEqual({ ageGroup: "A" });
  });
  it("R2-T-7: each student carries class label + id, and the payload lists the teacher's own class ids (tenant-scoped)", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    studentEnrollmentFindMany.mockResolvedValue([
      {
        classSection: { id: "cs1", name: "TKIT A" },
        student: { id: "stu1", name: "Abdul Zahra", nickname: null, status: "ACTIVE" },
      },
      {
        classSection: { id: "cs2", name: "POPUP Weekend" },
        student: { id: "stu2", name: "Abdul Zahra", nickname: null, status: "ACTIVE" },
      },
    ]);
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "WORSHIP" }),
    });
    const body = await res.json();
    expect(body.students).toEqual([
      expect.objectContaining({ id: "stu1", classSectionId: "cs1", className: "TKIT A" }),
      expect.objectContaining({ id: "stu2", classSectionId: "cs2", className: "POPUP Weekend" }),
    ]);
    expect(body.myClassSectionIds).toEqual(["cs1"]);
    expect(teachingAssignmentFindMany.mock.calls[0][0].where).toEqual({
      employeeId: "emp1",
      classSection: { tenantId: "t1" },
    });
  });
});
