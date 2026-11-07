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

import { getGateSummary } from "../gate-summary";

const enrollment = (id: string, section = "cs1") => ({
  student: { id, name: id, nickname: null },
  classSection: { id: section, name: "TK A" },
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
      { studentId: "s1", status: "PRESENT", checkInTime: new Date(), checkOutTime: new Date() },
      { studentId: "s2", status: "PRESENT", checkInTime: new Date(), checkOutTime: null },
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
