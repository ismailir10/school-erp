import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * "Hari tanpa buku penghubung" write route. The guard (teacher of the class OR
 * school admin of the tenant, nobody else) is the security seam, so it runs for
 * real against mocked getSession/prisma; the audit writes are asserted on the
 * transaction client.
 */
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  assignmentFindFirst: vi.fn(),
  classFindFirst: vi.fn(),
  markFindFirst: vi.fn(),
  markUpsert: vi.fn(),
  markDeleteMany: vi.fn(),
  auditCreate: vi.fn(),
  rateLimit: vi.fn(),
  today: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
  isAdminRole: (r: string) => r === "SUPER_ADMIN" || r === "SCHOOL_ADMIN",
}));
vi.mock("@/lib/db", () => {
  const tx = {
    studentJournalDayMark: {
      findFirst: mocks.markFindFirst,
      upsert: mocks.markUpsert,
      deleteMany: mocks.markDeleteMany,
    },
    studentJournalAudit: { create: mocks.auditCreate },
  };
  return {
    prisma: {
      teachingAssignment: { findFirst: mocks.assignmentFindFirst },
      classSection: { findFirst: mocks.classFindFirst },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/attendance/timezone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attendance/timezone")>()),
  getTodayInTimezone: mocks.today,
}));

import { PUT, DELETE } from "@/app/api/student-journal/day-marks/route";

const req = (body: unknown): NextRequest =>
  ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;

const TUESDAY = "2026-10-27";
const valid = { classSectionId: "c1", date: TUESDAY, reason: "Renang" };

const teacher = { id: "u-t", role: "TEACHER", tenantId: "t1", employeeId: "e1" };
const admin = { id: "u-a", role: "SCHOOL_ADMIN", tenantId: "t1" };
const parent = { id: "u-p", role: "PARENT", tenantId: "t1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockReturnValue({ success: true });
  mocks.today.mockReturnValue(TUESDAY);
  mocks.getSession.mockResolvedValue(teacher);
  mocks.assignmentFindFirst.mockResolvedValue({ id: "ta" });
  mocks.classFindFirst.mockResolvedValue({ id: "c1" });
  mocks.markFindFirst.mockResolvedValue(null);
  mocks.markUpsert.mockResolvedValue({ id: "m1" });
  mocks.markDeleteMany.mockResolvedValue({ count: 1 });
});

describe("PUT /day-marks — who may write", () => {
  it("lets the class's own guru mark a day and writes a CREATE audit row", async () => {
    const res = await PUT(req(valid));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(valid);
    expect(mocks.markUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ tenantId: "t1", classSectionId: "c1", date: TUESDAY, reason: "Renang", markedByUserId: "u-t" }) }),
    );
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    expect(mocks.auditCreate.mock.calls[0][0].data).toMatchObject({
      tenantId: "t1", entityType: "DAY_MARK", entityId: "m1", action: "CREATE", changedByUserId: "u-t",
    });
  });

  it("403s a guru who is not assigned to the class", async () => {
    mocks.assignmentFindFirst.mockResolvedValue(null);
    const res = await PUT(req(valid));
    expect(res.status).toBe(403);
    expect(mocks.markUpsert).not.toHaveBeenCalled();
  });

  it("lets a school admin mark any class of their tenant", async () => {
    mocks.getSession.mockResolvedValue(admin);
    const res = await PUT(req(valid));
    expect(res.status).toBe(200);
    expect(mocks.classFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", tenantId: "t1" } }));
    expect(mocks.assignmentFindFirst).not.toHaveBeenCalled();
  });

  it("404s an admin reaching for a class of another tenant", async () => {
    mocks.getSession.mockResolvedValue(admin);
    mocks.classFindFirst.mockResolvedValue(null);
    const res = await PUT(req(valid));
    expect(res.status).toBe(404);
    expect(mocks.markUpsert).not.toHaveBeenCalled();
  });

  it("403s a wali and 401s a signed-out caller", async () => {
    mocks.getSession.mockResolvedValue(parent);
    expect((await PUT(req(valid))).status).toBe(403);
    expect((await DELETE(req(valid))).status).toBe(403);
    mocks.getSession.mockResolvedValue(null);
    expect((await PUT(req(valid))).status).toBe(401);
    expect(mocks.markUpsert).not.toHaveBeenCalled();
    expect(mocks.markDeleteMany).not.toHaveBeenCalled();
  });
});

describe("PUT /day-marks — validation", () => {
  it.each([
    ["empty keterangan", { ...valid, reason: "   " }],
    ["keterangan over 60 characters", { ...valid, reason: "x".repeat(61) }],
    ["impossible date", { ...valid, date: "2026-02-31" }],
    ["missing class", { date: TUESDAY, reason: "Renang" }],
  ])("400s %s before touching auth-scoped data", async (_label, body) => {
    const res = await PUT(req(body));
    expect(res.status).toBe(400);
    expect(mocks.markUpsert).not.toHaveBeenCalled();
  });

  it("trims the keterangan", async () => {
    await PUT(req({ ...valid, reason: "  Renang  " }));
    expect(mocks.markUpsert.mock.calls[0][0].create.reason).toBe("Renang");
  });

  it("refuses a future day and a weekend", async () => {
    const future = await PUT(req({ ...valid, date: "2026-10-28" }));
    expect(future.status).toBe(400);
    const saturday = await PUT(req({ ...valid, date: "2026-10-24" }));
    expect(saturday.status).toBe(400);
    expect((await saturday.json()).error).toContain("Senin");
    expect(mocks.markUpsert).not.toHaveBeenCalled();
  });

  it("accepts a past school day", async () => {
    expect((await PUT(req({ ...valid, date: "2026-10-26" }))).status).toBe(200);
  });
});

describe("PUT /day-marks — editing", () => {
  it("writes an UPDATE audit row with the previous reason when the keterangan changes", async () => {
    mocks.markFindFirst.mockResolvedValue({ id: "m1", reason: "Renang" });
    await PUT(req({ ...valid, reason: "Libur" }));
    expect(mocks.auditCreate.mock.calls[0][0].data).toMatchObject({
      action: "UPDATE", beforeJson: { reason: "Renang" }, afterJson: { reason: "Libur" },
    });
  });

  it("writes no audit row when the same keterangan is saved again", async () => {
    mocks.markFindFirst.mockResolvedValue({ id: "m1", reason: "Renang" });
    await PUT(req(valid));
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});

describe("DELETE /day-marks", () => {
  it("removes the mark and audits the DELETE with the old reason", async () => {
    mocks.markFindFirst.mockResolvedValue({ id: "m1", reason: "Renang" });
    const res = await DELETE(req({ classSectionId: "c1", date: TUESDAY }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ removed: true });
    expect(mocks.markDeleteMany).toHaveBeenCalledWith({ where: { id: "m1", tenantId: "t1" } });
    expect(mocks.auditCreate.mock.calls[0][0].data).toMatchObject({
      entityType: "DAY_MARK", entityId: "m1", action: "DELETE", beforeJson: expect.objectContaining({ reason: "Renang" }),
    });
  });

  it("is a harmless no-op when the day was not marked", async () => {
    const res = await DELETE(req({ classSectionId: "c1", date: TUESDAY }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ removed: false });
    expect(mocks.markDeleteMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("403s a guru of another class", async () => {
    mocks.assignmentFindFirst.mockResolvedValue(null);
    expect((await DELETE(req({ classSectionId: "c2", date: TUESDAY }))).status).toBe(403);
    expect(mocks.markDeleteMany).not.toHaveBeenCalled();
  });
});

describe("auth and abuse limits", () => {
  it("answers 429 and writes nothing once the per-user limit is hit", async () => {
    mocks.rateLimit.mockReturnValue({ success: false });
    expect((await PUT(req(valid))).status).toBe(429);
    expect((await DELETE(req({ classSectionId: "c1", date: TUESDAY }))).status).toBe(429);
    expect(mocks.markUpsert).not.toHaveBeenCalled();
    expect(mocks.markDeleteMany).not.toHaveBeenCalled();
  });

  it("401s a signed-out DELETE and 404s an admin deleting in another tenant's class", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await DELETE(req({ classSectionId: "c1", date: TUESDAY }))).status).toBe(401);
    mocks.getSession.mockResolvedValue(admin);
    mocks.classFindFirst.mockResolvedValue(null);
    expect((await DELETE(req({ classSectionId: "c9", date: TUESDAY }))).status).toBe(404);
    expect(mocks.markDeleteMany).not.toHaveBeenCalled();
  });

  it("scopes a guru's assignment lookup to their tenant's class", async () => {
    await PUT(req(valid));
    expect(mocks.assignmentFindFirst).toHaveBeenCalledWith({
      where: { employeeId: "e1", classSectionId: "c1", classSection: { tenantId: "t1" } },
    });
  });

  it("treats a concurrent removal that lost the race as nothing to remove, not a 500", async () => {
    mocks.markFindFirst.mockResolvedValue({ id: "m1", reason: "Renang" });
    mocks.markDeleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(req({ classSectionId: "c1", date: TUESDAY }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ removed: false });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
