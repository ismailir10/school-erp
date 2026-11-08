/**
 * Absensi Staf Harian (docs/cycles/2026-11-07-attendance-geofence-gate.md):
 * GET list, bulk "Tandai semua hadir", per-row PUT, undo DELETE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const empFindMany = vi.fn();
const empFindFirst = vi.fn();
const attFindMany = vi.fn();
const attFindUnique = vi.fn();
const attCreateMany = vi.fn();
const attUpsert = vi.fn();
const attDeleteMany = vi.fn();
const orgFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    employee: { findMany: empFindMany, findFirst: empFindFirst },
    attendanceRecord: {
      findMany: attFindMany,
      findUnique: attFindUnique,
      createMany: attCreateMany,
      upsert: attUpsert,
      deleteMany: attDeleteMany,
    },
    orgConfig: { findUnique: orgFindUnique },
  },
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/attendance/timezone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/attendance/timezone")>();
  return { ...actual, getTodayInTimezone: () => "2026-11-07" };
});

const admin: SessionUser = {
  id: "admin-1",
  email: "a@a",
  name: "Admin",
  role: "SCHOOL_ADMIN",
  tenantId: "t1",
  employeeId: null,
  parentId: null,
  permissions: ["attendance.override"],
  customRoleCode: null,
};

async function as(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}
const json = (method: string, body?: unknown, url = "http://localhost/api/attendance/daily") =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  orgFindUnique.mockResolvedValue({ timezone: "Asia/Jakarta", workStartTime: "07:00" });
  empFindMany.mockResolvedValue([]);
  empFindFirst.mockResolvedValue({ id: "e1" });
  attFindMany.mockResolvedValue([]);
  attFindUnique.mockResolvedValue(null);
  attCreateMany.mockResolvedValue({ count: 0 });
  attUpsert.mockResolvedValue({
    id: "a1", status: "SICK", checkInTime: null, source: "ADMIN", approvalStatus: "APPROVED", isLocked: false,
  });
  attDeleteMany.mockResolvedValue({ count: 0 });
});

describe("GET /api/attendance/daily", () => {
  it("403 without attendance.override", async () => {
    await as({ ...admin, permissions: ["attendance.view"] });
    const { GET } = await import("../attendance/daily/route");
    const res = await GET(json("GET", undefined, "http://localhost/api/attendance/daily"));
    expect(res.status).toBe(403);
    expect(empFindMany).not.toHaveBeenCalled();
  });

  it("defaults to today and lists only ACTIVE employees of the caller's tenant", async () => {
    await as(admin);
    empFindMany.mockResolvedValue([
      {
        id: "e1", kode: "E1", nama: "Budi", jabatan: "Satpam", campusId: "c1", campus: { name: "A" },
        attendanceRecords: [],
      },
    ]);
    const { GET } = await import("../attendance/daily/route");
    const res = await GET(json("GET", undefined, "http://localhost/api/attendance/daily?campusId=c1"));
    const body = await res.json();
    expect(body.date).toBe("2026-11-07");
    expect(body.rows[0].attendance).toBeNull();
    const where = empFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: "t1", status: "ACTIVE", campusId: "c1" });
  });

  it("400 on a malformed date", async () => {
    await as(admin);
    const { GET } = await import("../attendance/daily/route");
    const res = await GET(json("GET", undefined, "http://localhost/api/attendance/daily?date=nope"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/attendance/daily/bulk", () => {
  it("403 without attendance.override", async () => {
    await as({ ...admin, permissions: [] });
    const { POST } = await import("../attendance/daily/bulk/route");
    const res = await POST(json("POST", { date: "2026-11-07" }));
    expect(res.status).toBe(403);
  });

  it("only targets tenant employees with no record, and creates PRESENT/ADMIN/APPROVED rows", async () => {
    await as(admin);
    empFindMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    attFindMany.mockResolvedValue([{ id: "n1" }, { id: "n2" }]);
    const { POST } = await import("../attendance/daily/bulk/route");
    const res = await POST(json("POST", { date: "2026-11-07", campusId: "c1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2, ids: ["n1", "n2"] });

    const where = empFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      tenantId: "t1",
      status: "ACTIVE",
      campusId: "c1",
      attendanceRecords: { none: { date: "2026-11-07" } },
    });
    const { data, skipDuplicates } = attCreateMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      employeeId: "e1", date: "2026-11-07", status: "PRESENT", source: "ADMIN",
      recordedBy: "admin-1", approvalStatus: "APPROVED",
    });
    // 07:00 WIB = 00:00 UTC
    expect(data[0].checkInTime.toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  it("never overwrites: no unmarked staff means no write at all", async () => {
    await as(admin);
    empFindMany.mockResolvedValue([]);
    const { POST } = await import("../attendance/daily/bulk/route");
    const res = await POST(json("POST", { date: "2026-11-07" }));
    expect(await res.json()).toEqual({ count: 0, ids: [] });
    expect(attCreateMany).not.toHaveBeenCalled();
    expect(attUpsert).not.toHaveBeenCalled();
  });

  it("refuses a future date", async () => {
    await as(admin);
    const { POST } = await import("../attendance/daily/bulk/route");
    const res = await POST(json("POST", { date: "2026-11-08" }));
    expect(res.status).toBe(400);
    expect(attCreateMany).not.toHaveBeenCalled();
  });
});

describe("PUT /api/attendance/daily", () => {
  it("404 for an employee outside the tenant (lookup is tenant-scoped)", async () => {
    await as(admin);
    empFindFirst.mockResolvedValue(null);
    const { PUT } = await import("../attendance/daily/route");
    const res = await PUT(json("PUT", { employeeId: "x", date: "2026-11-07", status: "SICK" }));
    expect(res.status).toBe(404);
    expect(empFindFirst.mock.calls[0][0].where).toMatchObject({ id: "x", tenantId: "t1" });
    expect(attUpsert).not.toHaveBeenCalled();
  });

  it("refuses a payroll-locked record", async () => {
    await as(admin);
    attFindUnique.mockResolvedValue({ id: "a1", isLocked: true, checkInTime: null });
    const { PUT } = await import("../attendance/daily/route");
    const res = await PUT(json("PUT", { employeeId: "e1", date: "2026-11-07", status: "SICK" }));
    expect(res.status).toBe(400);
    expect(attUpsert).not.toHaveBeenCalled();
  });

  it("rejects a status outside Hadir/Sakit/Izin/Alpa", async () => {
    await as(admin);
    const { PUT } = await import("../attendance/daily/route");
    const res = await PUT(json("PUT", { employeeId: "e1", date: "2026-11-07", status: "LATE" }));
    expect(res.status).toBe(400);
  });

  it("upserts with source ADMIN and recordedBy; Hadir gets work-start check-in", async () => {
    await as(admin);
    const { PUT } = await import("../attendance/daily/route");
    const res = await PUT(json("PUT", { employeeId: "e1", date: "2026-11-07", status: "PRESENT" }));
    expect(res.status).toBe(200);
    const arg = attUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ employeeId_date: { employeeId: "e1", date: "2026-11-07" } });
    expect(arg.create).toMatchObject({ source: "ADMIN", recordedBy: "admin-1", approvalStatus: "APPROVED", status: "PRESENT" });
    expect(arg.create.checkInTime.toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });

  it("Sakit sets no check-in time", async () => {
    await as(admin);
    const { PUT } = await import("../attendance/daily/route");
    await PUT(json("PUT", { employeeId: "e1", date: "2026-11-07", status: "SICK" }));
    expect(attUpsert.mock.calls[0][0].create).not.toHaveProperty("checkInTime");
  });
});

describe("DELETE /api/attendance/daily (undo)", () => {
  it("deletes only unlocked, admin-created, non-override rows of the tenant among the given ids", async () => {
    await as(admin);
    attDeleteMany.mockResolvedValue({ count: 2 });
    const { DELETE } = await import("../attendance/daily/route");
    const res = await DELETE(json("DELETE", { ids: ["n1", "n2"] }));
    expect(await res.json()).toEqual({ count: 2 });
    expect(attDeleteMany.mock.calls[0][0].where).toEqual({
      id: { in: ["n1", "n2"] },
      source: "ADMIN",
      isManualOverride: false,
      isLocked: false,
      employee: { tenantId: "t1" },
    });
  });

  it("400 on empty ids; 403 without permission", async () => {
    await as(admin);
    const { DELETE } = await import("../attendance/daily/route");
    expect((await DELETE(json("DELETE", { ids: [] }))).status).toBe(400);
    await as({ ...admin, permissions: [] });
    expect((await DELETE(json("DELETE", { ids: ["a"] }))).status).toBe(403);
    expect(attDeleteMany).not.toHaveBeenCalled();
  });
});
