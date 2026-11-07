import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  weekFindFirst,
  studentEnrollmentFindMany,
  achievementIndicatorFindMany,
  assessmentEntryFindMany,
  teachingAssignmentFindMany,
  sentraFindFirst,
  classSectionFindFirst,
  sentraRotationFindMany,
  employeeFindFirst,
} = vi.hoisted(() => ({
  weekFindFirst: vi.fn(),
  studentEnrollmentFindMany: vi.fn(),
  achievementIndicatorFindMany: vi.fn(),
  assessmentEntryFindMany: vi.fn(),
  teachingAssignmentFindMany: vi.fn(),
  sentraFindFirst: vi.fn(),
  classSectionFindFirst: vi.fn(),
  sentraRotationFindMany: vi.fn(),
  employeeFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    week: { findFirst: weekFindFirst },
    employee: { findFirst: employeeFindFirst },
    sentra: { findFirst: sentraFindFirst },
    classSection: { findFirst: classSectionFindFirst },
    sentraRotation: { findMany: sentraRotationFindMany },
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
  centerSlug = "sen1",
  qs = "date=2026-05-14&ageGroup=A",
): Request {
  return new Request(
    `http://localhost/api/teacher/assessment-entries/center/${centerSlug}?${qs}`,
  );
}

const activeWeek = {
  id: "wk1",
  number: 3,
  startDate: new Date("2026-05-11T00:00:00Z"),
  endDate: new Date("2026-05-15T00:00:00Z"),
  subTheme: {
    id: "st1",
    name: "Sub",
    theme: { id: "th1", name: "Theme", semesterId: "sem1" },
  },
};

const happy = () => {
  employeeFindFirst.mockResolvedValue({ campusId: "cam1" });
  sentraFindFirst.mockResolvedValue({ id: "sen1", name: "Ibadah", legacyCenter: "WORSHIP", campusId: "cam1" });
  classSectionFindFirst.mockResolvedValue({ id: "cs1", ageGroup: "A" });
  sentraRotationFindMany.mockResolvedValue([]);
  weekFindFirst.mockResolvedValue(activeWeek);
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
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 when caller lacks assessments.read", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...teacher, permissions: [] });
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(403);
  });

  it("404 when the sentra is unknown or foreign to the tenant", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    sentraFindFirst.mockResolvedValue(null);
    const res = await GET(req("UNKNOWN") as never, {
      params: Promise.resolve({ center: "UNKNOWN" }),
    });
    expect(res.status).toBe(404);
  });

  it("400 when ageGroup query param is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    const res = await GET(req("sen1", "date=2026-05-14") as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(400);
  });

  it("422 when no active week brackets the date", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    weekFindFirst.mockResolvedValue(null);
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.reason).toBe("no_active_week");
  });

  it("200 happy path — payload echoes center + ageGroup + week + filtered roster", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sentra).toEqual({ id: "sen1", name: "Ibadah" });
    expect(body.todayClassSectionId).toBeNull();
    expect(body.rotationClasses).toEqual([]);
    expect(body.ageGroup).toBe("A");
    expect(body.week.number).toBe(3);
    expect(studentEnrollmentFindMany.mock.calls[0][0].where.classSection).toEqual({
      tenantId: "t1",
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
      ageGroup: "A",
    });
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
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).writable).toBe(false);
  });

  it("200 entries query is scoped to source CENTER + sentra + date", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    await GET(req() as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    const callArgs = assessmentEntryFindMany.mock.calls[0][0];
    expect(callArgs.where.source).toBe("CENTER");
    expect(callArgs.where.OR).toEqual([
      { sentraId: "sen1" },
      { sentraId: null, center: "WORSHIP" },
    ]);
    expect(callArgs.where.weekId).toBe("wk1");
  });

  it("200 indicator query is filtered to ageGroup", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    await GET(req() as never, {
      params: Promise.resolve({ center: "sen1" }),
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
      params: Promise.resolve({ center: "sen1" }),
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

  it("rotation: classSectionId rosters that class and reports today's class + rotation classes", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    // 2026-05-14 is Thursday; putaran starts Mon 2026-05-11 → day index 3.
    sentraRotationFindMany.mockResolvedValue([
      {
        startDate: "2026-05-11",
        cycleDays: 10,
        slots: [
          { dayIndex: 0, classSectionId: "cs2" },
          { dayIndex: 3, classSectionId: "cs1" },
        ],
        classes: [
          { classSection: { id: "cs1", name: "TK A 1" } },
          { classSection: { id: "cs2", name: "TK A 2" } },
        ],
      },
    ]);
    const res = await GET(
      req("sen1", "date=2026-05-14&classSectionId=cs1") as never,
      { params: Promise.resolve({ center: "sen1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.todayClassSectionId).toBe("cs1");
    expect(body.rotationClasses).toEqual([
      { id: "cs1", name: "TK A 1" },
      { id: "cs2", name: "TK A 2" },
    ]);
    expect(classSectionFindFirst.mock.calls[0][0].where).toEqual({
      id: "cs1",
      tenantId: "t1",
      campusId: "cam1",
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
    });
    expect(studentEnrollmentFindMany.mock.calls[0][0].where.classSection).toEqual({
      id: "cs1",
      tenantId: "t1",
      campusId: "cam1",
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
    });
    expect(body.ageGroup).toBe("A");
  });

  it("rotation: no today class on a weekend", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    sentraRotationFindMany.mockResolvedValue([
      {
        startDate: "2026-05-11",
        cycleDays: 10,
        slots: [{ dayIndex: 3, classSectionId: "cs1" }],
        classes: [{ classSection: { id: "cs1", name: "TK A 1" } }],
      },
    ]);
    const res = await GET(req("sen1", "date=2026-05-16&ageGroup=A&defaultToVisitingClass=true") as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    const body = await res.json();
    expect(body.todayClassSectionId).toBeNull();
    expect(body.classSectionId).toBeNull();
    expect(body.ageGroup).toBe("A");
    expect(body.rotationClasses).toHaveLength(1);
  });

  it("loads the visiting TK B class when only TK B has an active week", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    weekFindFirst.mockImplementation(({ where }) =>
      where.subTheme.theme.OR[0].ageGroup === "B" ? activeWeek : null,
    );
    sentraRotationFindMany.mockResolvedValue([
      {
        startDate: "2026-05-11",
        cycleDays: 10,
        slots: [{ dayIndex: 3, classSectionId: "cs2" }],
        classes: [{ classSection: { id: "cs2", name: "TK B 1", ageGroup: "B" } }],
      },
    ]);
    studentEnrollmentFindMany.mockResolvedValue([
      {
        classSection: { id: "cs2", name: "TK B 1" },
        student: { id: "stu2", name: "Aisyah", nickname: null, status: "ACTIVE" },
      },
    ]);

    const res = await GET(
      req("sen1", "date=2026-05-14&ageGroup=A&defaultToVisitingClass=true") as never,
      { params: Promise.resolve({ center: "sen1" }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ageGroup: "B",
      classSectionId: "cs2",
      todayClassSectionId: "cs2",
      students: [{ id: "stu2" }],
    });
    expect(weekFindFirst).toHaveBeenCalledTimes(1);
    expect(studentEnrollmentFindMany.mock.calls[0][0].where.classSection).toEqual({
      id: "cs2",
      tenantId: "t1",
      campusId: "cam1",
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
    });
  });

  it("404 when classSectionId is not in the tenant", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    classSectionFindFirst.mockResolvedValue(null);
    const res = await GET(req("sen1", "date=2026-05-14&classSectionId=zzz") as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(404);
  });

  it("404 for a sentra on another campus or inactive (query pins campus + ACTIVE)", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    sentraFindFirst.mockResolvedValue(null);
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(404);
    expect(sentraFindFirst.mock.calls[0][0].where).toEqual({
      id: "sen1",
      tenantId: "t1",
      status: "ACTIVE",
      campusId: "cam1",
    });
  });

  it("404 when the teacher has no campus", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    employeeFindFirst.mockResolvedValue({ campusId: null });
    const res = await GET(req() as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(404);
    expect(sentraFindFirst).not.toHaveBeenCalled();
  });

  it("404 when the class is on another campus (class query pins the sentra campus)", async () => {
    vi.mocked(getSession).mockResolvedValue(teacher);
    happy();
    classSectionFindFirst.mockResolvedValue(null);
    const res = await GET(req("sen1", "date=2026-05-14&classSectionId=other") as never, {
      params: Promise.resolve({ center: "sen1" }),
    });
    expect(res.status).toBe(404);
    expect(classSectionFindFirst.mock.calls[0][0].where.campusId).toBe("cam1");
  });

  it("admin readers skip the campus pin but keep tenant + ACTIVE", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...teacher, role: "SCHOOL_ADMIN" as never });
    happy();
    await GET(req() as never, { params: Promise.resolve({ center: "sen1" }) });
    expect(employeeFindFirst).not.toHaveBeenCalled();
    expect(sentraFindFirst.mock.calls[0][0].where).toEqual({
      id: "sen1",
      tenantId: "t1",
      status: "ACTIVE",
    });
  });
});
