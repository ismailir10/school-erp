import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sections: vi.fn(), config: vi.fn(), holidays: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { classSection: { findMany: mocks.sections }, orgConfig: { findUnique: mocks.config }, holiday: { findMany: mocks.holidays } } }));
import { scheduledClassIds } from "../scheduled-day";
const section = (id: string, sessions: string[] = [], inTerm = true) => ({ id, sessions: sessions.map(id => ({ id })), academicYear: { semesters: inTerm ? [{ id: "term" }] : [] } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sections.mockResolvedValue([section("school")]);
  mocks.config.mockResolvedValue({ workingDays: '["MON","TUE","WED","THU","FRI"]' });
  mocks.holidays.mockResolvedValue([]);
});
describe("scheduled class availability", () => {
  it("keeps a real weekend session available even outside a semester", async () => {
    mocks.sections.mockResolvedValue([section("care", ["saturday"], false), section("school", [], false)]);
    expect([...await scheduledClassIds("t1", ["care", "school"], "2026-11-14")]).toEqual(["care"]);
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it("allows a missing weekday session that POST can lazily reconcile", async () => {
    expect([...await scheduledClassIds("t1", ["school"], "2026-11-13")]).toEqual(["school"]);
  });
  it("does not advertise unavailable weekend or full-holiday actions", async () => {
    expect([...await scheduledClassIds("t1", ["school"], "2026-11-14")]).toEqual([]);
    mocks.holidays.mockResolvedValue([{ isHalfDay: false }]);
    expect([...await scheduledClassIds("t1", ["school"], "2026-11-13")]).toEqual([]);
  });
  it("matches reconcile's half-day holiday rule, including weekends", async () => {
    mocks.holidays.mockResolvedValue([{ isHalfDay: true }]);
    expect([...await scheduledClassIds("t1", ["school"], "2026-11-14")]).toEqual(["school"]);
  });
  it("bounds class, semester and holiday queries to the tenant and date", async () => {
    await scheduledClassIds("t1", ["school", "school"], "2026-11-13");
    expect(mocks.sections).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["school"] }, tenantId: "t1", status: "ACTIVE", academicYear: { status: "ACTIVE" } },
      select: expect.objectContaining({ academicYear: { select: { semesters: { where: { startDate: { lte: new Date("2026-11-13") }, endDate: { gte: new Date("2026-11-13") } }, select: { id: true } } } } }),
    }));
    expect(mocks.holidays).toHaveBeenCalledWith({ where: { tenantId: "t1", date: "2026-11-13" }, select: { isHalfDay: true } });
  });
  it("does not invent a closed day when calendar configuration is missing", async () => {
    mocks.config.mockResolvedValue(null);
    await expect(scheduledClassIds("t1", ["school"], "2026-11-13")).rejects.toThrow("org_config_not_found");
  });
});
