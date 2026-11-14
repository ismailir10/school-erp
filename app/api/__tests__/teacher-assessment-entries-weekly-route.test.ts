import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  academicYearFindFirst,
  teachingAssignmentFindFirst,
  weekFindFirst,
  studentEnrollmentFindMany,
  achievementIndicatorFindMany,
  assessmentEntryFindMany,
} = vi.hoisted(() => ({
  academicYearFindFirst: vi.fn(),
  teachingAssignmentFindFirst: vi.fn(),
  weekFindFirst: vi.fn(),
  studentEnrollmentFindMany: vi.fn(),
  achievementIndicatorFindMany: vi.fn(),
  assessmentEntryFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    academicYear: { findFirst: academicYearFindFirst },
    teachingAssignment: { findFirst: teachingAssignmentFindFirst },
    week: { findFirst: weekFindFirst },
    studentEnrollment: { findMany: studentEnrollmentFindMany },
    achievementIndicator: { findMany: achievementIndicatorFindMany },
    assessmentEntry: { findMany: assessmentEntryFindMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

import { GET } from "@/app/api/teacher/assessment-entries/weekly/route";
import { getSession } from "@/lib/auth";

const teacher = {
  id: "u1",
  email: "walas@demo.local",
  name: "Walas",
  role: "TEACHER" as const,
  tenantId: "t1",
  employeeId: "emp1",
  parentId: null,
  permissions: ["assessments.read", "assessments.write"],
  customRoleCode: null,
};

function req(date = "2026-05-14"): Request {
  return new Request(
    `http://localhost/api/teacher/assessment-entries/weekly?date=${date}`,
  );
}

const setHomeroomActiveWeek = () => {
  academicYearFindFirst.mockResolvedValue({ id: "ay1" });
  teachingAssignmentFindFirst.mockResolvedValue({
    classSection: {
      id: "cs1",
      name: "TKIT A",
      ageGroup: "A",
      programId: "prog1",
      campusId: "campus1",
      academicYearId: "ay1",
    },
  });
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
  studentEnrollmentFindMany.mockResolvedValue([
    { student: { id: "stu1", name: "Ali", nickname: "Ali", status: "ACTIVE" } },
    { student: { id: "stu2", name: "Budi", nickname: "Bud", status: "ACTIVE" } },
  ]);
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
      date: new Date("2026-05-13T00:00:00Z"),
      level: "EMERGING",
      note: null,
    },
  ]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/teacher/assessment-entries/weekly", () => {
  it("401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET(req() as never);
    expect(res.status).toBe(401);
  });

  it("403 when caller lacks assessments.read", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...teacher, permissions: [] });
    const res = await GET(req() as never);
    expect(res.status).toBe(403);
  });

  it("404 when no active academic year", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    academicYearFindFirst.mockResolvedValue(null);
    const res = await GET(req() as never);
    expect(res.status).toBe(404);
  });

  it("404 when caller is not a walas (no HOMEROOM assignment)", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    academicYearFindFirst.mockResolvedValue({ id: "ay1" });
    teachingAssignmentFindFirst.mockResolvedValue(null);
    const res = await GET(req() as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.reason).toBe("not_homeroom");
  });

  it("404 when no active week brackets the date", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    academicYearFindFirst.mockResolvedValue({ id: "ay1" });
    teachingAssignmentFindFirst.mockResolvedValue({
      classSection: {
        id: "cs1",
        name: "TKIT A",
        programId: "prog1",
        campusId: "campus1",
        academicYearId: "ay1",
      },
    });
    weekFindFirst.mockResolvedValue(null);
    const res = await GET(req() as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.reason).toBe("no_active_week");
    expect(body.classSection.name).toBe("TKIT A");
  });

  it("200 with full payload on the happy path", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    setHomeroomActiveWeek();
    const res = await GET(req() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.week.number).toBe(3);
    expect(body.week.startDate).toBe("2026-05-11");
    expect(body.classSection.ageGroup).toBe("A");
    expect(body.students).toHaveLength(2);
    expect(body.indicators).toHaveLength(1);
    expect(body.entries[0].level).toBe("EMERGING");
    expect(body.entries[0].date).toBe("2026-05-13");
  });

  it("200 indicators are filtered by walas's ageGroup when derivable", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    setHomeroomActiveWeek();
    await GET(req() as never);
    const callArgs = achievementIndicatorFindMany.mock.calls[0][0];
    expect(callArgs.where.objective).toEqual({ ageGroup: "A", status: "ACTIVE", semester: { status: "ACTIVE" } });
  });

  it("200 indicators are ageGroup-filtered for every class (heuristic null path removed 2026-05-20)", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    setHomeroomActiveWeek();
    // Pre-2026-05-20 the loader called deriveAgeGroup(homeroom.name) and
    // returned null for non-A/B names like "KB Aster", which collapsed
    // the indicator picker to "show all ageGroups". ClassSection.ageGroup
    // is now a NOT NULL schema column, so every class — including
    // KB Aster, D'Care, etc. — applies the filter.
    teachingAssignmentFindFirst.mockResolvedValue({
      classSection: {
        id: "cs1",
        name: "KB Aster",
        ageGroup: "B",
        programId: "prog1",
        campusId: "campus1",
        academicYearId: "ay1",
      },
    });
    await GET(req() as never);
    const callArgs = achievementIndicatorFindMany.mock.calls[0][0];
    expect(callArgs.where.objective).toEqual({ ageGroup: "B", status: "ACTIVE", semester: { status: "ACTIVE" } });
  });

  it("200 entries are scoped to source HOMEROOM + this week", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    setHomeroomActiveWeek();
    await GET(req() as never);
    const callArgs = assessmentEntryFindMany.mock.calls[0][0];
    expect(callArgs.where.source).toBe("HOMEROOM");
    expect(callArgs.where.voidedAt).toBeNull();
    expect(callArgs.where.weekId).toBe("wk1");
    expect(callArgs.where.studentId).toEqual({ in: ["stu1", "stu2"] });
  });
});
