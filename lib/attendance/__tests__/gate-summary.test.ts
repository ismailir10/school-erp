import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  campusFindMany: vi.fn(),
  employeeFindFirst: vi.fn(),
  enrollmentFindMany: vi.fn(),
  attendanceFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    campus: { findMany: mocks.campusFindMany },
    employee: { findFirst: mocks.employeeFindFirst },
    studentEnrollment: { findMany: mocks.enrollmentFindMany },
    studentAttendance: { findMany: mocks.attendanceFindMany },
  },
}));

import { getGateRoster, getGateSummary } from "../gate-summary";

const enrollment = (id: string, section = "cs1") => ({
  student: { id, name: id, nickname: null },
  classSection: { id: section, name: "TK A" },
});

const attendance = (
  studentId: string,
  classSectionId: string,
  checkInTime: Date | null,
  checkOutTime: Date | null,
) => ({
  studentId,
  classSectionId,
  status: "PRESENT",
  checkInTime,
  checkOutTime,
  pickedUpByRelation: null,
  pickedUpByName: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.campusFindMany.mockResolvedValue([
    { id: "c1", name: "A" },
    { id: "c2", name: "B" },
  ]);
  mocks.employeeFindFirst.mockResolvedValue({ campusId: "c2" });
  mocks.enrollmentFindMany.mockResolvedValue([]);
  mocks.attendanceFindMany.mockResolvedValue([]);
});

describe("getGateSummary", () => {
  it("counts arrivals and pickups among the campus's active children", async () => {
    mocks.enrollmentFindMany.mockResolvedValue([enrollment("s1"), enrollment("s2"), enrollment("s3")]);
    mocks.attendanceFindMany.mockResolvedValue([
      attendance("s1", "cs1", new Date(), new Date()),
      attendance("s2", "cs1", new Date(), null),
    ]);
    const out = await getGateSummary({ tenantId: "t1", employeeId: "e1" });
    expect(out).toEqual({ total: 3, arrived: 2, pickedUp: 1 });
  });

  it("uses the caller's own campus by default and an explicit one when given", async () => {
    await getGateSummary({ tenantId: "t1", employeeId: "e1" });
    expect(mocks.enrollmentFindMany.mock.calls[0][0].where.classSection).toMatchObject({ tenantId: "t1", campusId: "c2" });
    await getGateSummary({ tenantId: "t1", employeeId: "e1", campusId: "c1" });
    expect(mocks.enrollmentFindMany.mock.calls[1][0].where.classSection).toMatchObject({ campusId: "c1" });
  });

  it("scopes both enrollment and attendance queries to the active classes of this campus", async () => {
    await getGateSummary({ tenantId: "t1", employeeId: "e1" });
    const classScope = {
      tenantId: "t1",
      campusId: "c2",
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
    };
    expect(mocks.enrollmentFindMany.mock.calls[0][0].where.classSection).toEqual(classScope);
    expect(mocks.attendanceFindMany.mock.calls[0][0].where.classSection).toEqual(classScope);
  });

  it("falls back to the first active campus when the caller's campus is not active", async () => {
    mocks.employeeFindFirst.mockResolvedValue({ campusId: "gone" });
    await getGateSummary({ tenantId: "t1", employeeId: "e1" });
    expect(mocks.enrollmentFindMany.mock.calls[0][0].where.classSection).toMatchObject({ campusId: "c1" });
  });

  it("ignores voided attendance rows and counts a child in two placements once", async () => {
    mocks.enrollmentFindMany.mockResolvedValue([enrollment("s1", "cs1"), enrollment("s1", "cs2")]);
    await getGateSummary({ tenantId: "t1", employeeId: "e1" });
    const where = mocks.attendanceFindMany.mock.calls[0][0].where;
    expect(where.isVoided).toBe(false);
    expect(where.studentId).toEqual({ in: ["s1"] });
    expect(mocks.enrollmentFindMany).toHaveBeenCalledTimes(1);
  });

  it("returns zeros for a campus with no active children", async () => {
    expect(await getGateSummary({ tenantId: "t1", employeeId: "e1" })).toEqual({ total: 0, arrived: 0, pickedUp: 0 });
  });

  it("returns zeros when the tenant has no active campus", async () => {
    mocks.campusFindMany.mockResolvedValue([]);
    mocks.employeeFindFirst.mockResolvedValue(null);
    expect(await getGateSummary({ tenantId: "t1", employeeId: "e1" })).toEqual({ total: 0, arrived: 0, pickedUp: 0 });
    expect(mocks.enrollmentFindMany).not.toHaveBeenCalled();
  });
});

describe("getGateRoster", () => {
  const date = "2026-11-07";
  const arrival = new Date(`${date}T07:15:00+07:00`);
  const pickup = new Date(`${date}T15:30:00+07:00`);

  it("ignores attendance from a student's archived, other-campus or ended placements", async () => {
    mocks.enrollmentFindMany.mockResolvedValue([enrollment("s1"), enrollment("s2", "cs2")]);
    mocks.attendanceFindMany.mockResolvedValue([
      attendance("s1", "cs1", arrival, null),
      attendance("s1", "archived", arrival, pickup),
      attendance("s1", "other-campus", arrival, pickup),
      // cs2 is in scope for s2, but s1 no longer has a placement in it.
      attendance("s1", "cs2", arrival, pickup),
      attendance("s2", "other-campus", arrival, pickup),
    ]);

    const { byStudent } = await getGateRoster("t1", "c2", date);

    expect(byStudent.get("s1")).toMatchObject({ checkInTime: arrival, checkOutTime: null });
    expect(byStudent.has("s2")).toBe(false);
  });

  it("keeps the first arrival and last pickup across active placements and sessions", async () => {
    const laterArrival = new Date(`${date}T09:00:00+07:00`);
    const earlierPickup = new Date(`${date}T12:00:00+07:00`);
    mocks.enrollmentFindMany.mockResolvedValue([enrollment("s1"), enrollment("s1", "cs2")]);
    mocks.attendanceFindMany.mockResolvedValue([
      { ...attendance("s1", "cs2", null, null), status: "ABSENT" },
      {
        ...attendance("s1", "cs2", laterArrival, pickup),
        pickedUpByRelation: "OTHER",
        pickedUpByName: "Test pickup",
      },
      { ...attendance("s1", "cs1", null, earlierPickup), pickedUpByRelation: "PARENT" },
      attendance("s1", "cs1", arrival, null),
    ]);

    const { students, byStudent } = await getGateRoster("t1", "c2", date);

    expect(students).toHaveLength(1);
    expect(byStudent.get("s1")).toMatchObject({
      status: "PRESENT",
      checkInTime: arrival,
      checkOutTime: pickup,
      pickedUpByRelation: "OTHER",
      pickedUpByName: "Test pickup",
    });
    await expect(getGateSummary({ tenantId: "t1", employeeId: "e1" })).resolves.toEqual({
      total: 1,
      arrived: 1,
      pickedUp: 1,
    });
  });
});
