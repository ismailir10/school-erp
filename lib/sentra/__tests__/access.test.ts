import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  assignmentFindFirst: vi.fn(),
  rotationClassFindFirst: vi.fn(),
  rotationFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    teachingAssignment: { findFirst: mocks.assignmentFindFirst },
    sentraRotationClass: { findFirst: mocks.rotationClassFindFirst },
    sentraRotation: { findMany: mocks.rotationFindMany },
  },
}));

import {
  getSentraClassIds,
  getStudentSentraAccess,
  getTeacherSentraToday,
  teacherCanAccessClass,
} from "../access";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assignmentFindFirst.mockResolvedValue(null);
  mocks.rotationClassFindFirst.mockResolvedValue(null);
  mocks.rotationFindMany.mockResolvedValue([]);
});

describe("teacherCanAccessClass", () => {
  it("short-circuits on a teaching assignment", async () => {
    mocks.assignmentFindFirst.mockResolvedValue({ id: "ta" });
    expect(await teacherCanAccessClass("e1", "t1", "c1")).toBe(true);
    expect(mocks.rotationClassFindFirst).not.toHaveBeenCalled();
    expect(mocks.assignmentFindFirst.mock.calls[0][0].where).toMatchObject({
      employeeId: "e1",
      classSectionId: "c1",
      classSection: { tenantId: "t1" },
    });
  });

  it("allows via sentra with active/tenant/year scoping", async () => {
    mocks.rotationClassFindFirst.mockResolvedValue({ id: "rc" });
    expect(await teacherCanAccessClass("e1", "t1", "c1")).toBe(true);
    const where = mocks.rotationClassFindFirst.mock.calls[0][0].where;
    expect(where.classSectionId).toBe("c1");
    expect(where.classSection).toEqual({ tenantId: "t1" });
    expect(where.rotation).toMatchObject({
      status: "ACTIVE",
      tenantId: "t1",
      academicYear: { status: "ACTIVE" },
      slots: {
        some: {
          sentra: { status: "ACTIVE", teachers: { some: { employeeId: "e1" } } },
        },
      },
    });
  });

  it("denies an outsider", async () => {
    expect(await teacherCanAccessClass("e9", "t1", "c1")).toBe(false);
  });
});

describe("getStudentSentraAccess", () => {
  it("is false for no classes without querying", async () => {
    expect(await getStudentSentraAccess("e1", "t1", [])).toBe(false);
    expect(mocks.assignmentFindFirst).not.toHaveBeenCalled();
  });
  it("short-circuits on assignment", async () => {
    mocks.assignmentFindFirst.mockResolvedValue({ id: "ta" });
    expect(await getStudentSentraAccess("e1", "t1", ["c1", "c2"])).toBe(true);
    expect(mocks.assignmentFindFirst.mock.calls[0][0].where.classSectionId).toEqual({
      in: ["c1", "c2"],
    });
    expect(mocks.rotationClassFindFirst).not.toHaveBeenCalled();
  });
  it("falls back to sentra with an `in` filter", async () => {
    mocks.rotationClassFindFirst.mockResolvedValue({ id: "rc" });
    expect(await getStudentSentraAccess("e1", "t1", ["c1", "c2"])).toBe(true);
    expect(mocks.rotationClassFindFirst.mock.calls[0][0].where.classSectionId).toEqual({
      in: ["c1", "c2"],
    });
  });
  it("is false for an outsider", async () => {
    expect(await getStudentSentraAccess("e9", "t1", ["c1"])).toBe(false);
  });
});

describe("getSentraClassIds", () => {
  it("returns distinct class ids and scopes the query", async () => {
    mocks.rotationFindMany.mockResolvedValue([
      { classes: [{ classSectionId: "c1" }, { classSectionId: "c2" }] },
      { classes: [{ classSectionId: "c2" }, { classSectionId: "c3" }] },
    ]);
    expect(await getSentraClassIds("e1", "t1")).toEqual(["c1", "c2", "c3"]);
    expect(mocks.rotationFindMany.mock.calls[0][0].where).toMatchObject({
      status: "ACTIVE",
      tenantId: "t1",
      academicYear: { status: "ACTIVE" },
      slots: { some: { sentra: { status: "ACTIVE" } } },
    });
  });
});

describe("getTeacherSentraToday", () => {
  // Monday start, 2-day cycle: day 0 -> class A, day 1 -> class B.
  const rotation = {
    id: "r1",
    startDate: "2026-11-02",
    cycleDays: 2,
    slots: [
      {
        dayIndex: 0,
        sentra: { id: "s1", name: "Balok" },
        classSection: { id: "cA", name: "TK A 3" },
      },
      {
        dayIndex: 1,
        sentra: { id: "s1", name: "Balok" },
        classSection: { id: "cB", name: "TK B 4" },
      },
    ],
  };
  beforeEach(() => mocks.rotationFindMany.mockResolvedValue([rotation]));

  it("returns class A on day 0 and B on day 1", async () => {
    expect(await getTeacherSentraToday("e1", "t1", "2026-11-02")).toEqual([
      { sentraId: "s1", sentraName: "Balok", classSectionId: "cA", className: "TK A 3", rotationId: "r1" },
    ]);
    const day1 = await getTeacherSentraToday("e1", "t1", "2026-11-03");
    expect(day1.map((x) => x.classSectionId)).toEqual(["cB"]);
  });

  it("returns [] on Saturday and before start", async () => {
    expect(await getTeacherSentraToday("e1", "t1", "2026-11-07")).toEqual([]);
    expect(await getTeacherSentraToday("e1", "t1", "2026-10-30")).toEqual([]);
  });
});
