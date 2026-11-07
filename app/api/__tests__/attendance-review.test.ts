/**
 * Admin review of geofence check-ins (docs/cycles/2026-11-07-attendance-geofence-gate.md):
 * approve / reject / approve-all / pending list — permission, tenant scope, PENDING-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const findFirst = vi.fn();
const findUnique = vi.fn();
const findMany = vi.fn();
const updateMany = vi.fn();
const campusFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    attendanceRecord: { findFirst, findUnique, findMany, updateMany },
    campus: { findMany: campusFindMany },
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
const ctx = (id = "att-1") => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request("http://localhost/api/attendance/x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue({ id: "att-1", approvalStatus: "PENDING", isLocked: false });
  updateMany.mockResolvedValue({ count: 1 });
  findUnique.mockResolvedValue({ id: "att-1", approvalStatus: "APPROVED" });
  campusFindMany.mockResolvedValue([]);
});

describe("POST /api/attendance/[id]/approve", () => {
  it("403 without attendance.override", async () => {
    await as({ ...admin, permissions: ["attendance.view"] });
    const { POST } = await import("../attendance/[id]/approve/route");
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("404 when the record belongs to another tenant (lookup is tenant-scoped)", async () => {
    await as(admin);
    findFirst.mockResolvedValue(null);
    const { POST } = await import("../attendance/[id]/approve/route");
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: "att-1", employee: { tenantId: "t1" } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("409 when the record is not PENDING", async () => {
    await as(admin);
    findFirst.mockResolvedValue({ id: "att-1", approvalStatus: "APPROVED", isLocked: false });
    const { POST } = await import("../attendance/[id]/approve/route");
    expect((await POST(req(), ctx())).status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("409 when a concurrent decision wins the conditional update", async () => {
    await as(admin);
    updateMany.mockResolvedValue({ count: 0 });
    const { POST } = await import("../attendance/[id]/approve/route");
    expect((await POST(req(), ctx())).status).toBe(409);
  });

  it("approves with an empty body, stamping reviewer and keeping the status", async () => {
    await as(admin);
    const { POST } = await import("../attendance/[id]/approve/route");
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "att-1", approvalStatus: "PENDING", employee: { tenantId: "t1" } });
    expect(arg.data).toMatchObject({ approvalStatus: "APPROVED", reviewedBy: "admin-1", reviewNote: null });
    expect(arg.data.status).toBeUndefined();
  });
});

describe("POST /api/attendance/[id]/reject", () => {
  it("rejects to ABSENT and stores the note", async () => {
    await as(admin);
    const { POST } = await import("../attendance/[id]/reject/route");
    const res = await POST(req({ note: "  Tidak sesuai jadwal " }), ctx());
    expect(res.status).toBe(200);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      approvalStatus: "REJECTED",
      status: "ABSENT",
      reviewedBy: "admin-1",
      reviewNote: "Tidak sesuai jadwal",
    });
  });

  it("works without a note", async () => {
    await as(admin);
    const { POST } = await import("../attendance/[id]/reject/route");
    expect((await POST(req(), ctx())).status).toBe(200);
    expect(updateMany.mock.calls[0][0].data.reviewNote).toBeNull();
  });

  it("400 on an over-long note; 403 without permission", async () => {
    await as(admin);
    const { POST } = await import("../attendance/[id]/reject/route");
    expect((await POST(req({ note: "x".repeat(501) }), ctx())).status).toBe(400);
    await as({ ...admin, permissions: [] });
    expect((await POST(req(), ctx())).status).toBe(403);
  });

  it("400 for a payroll-locked record", async () => {
    await as(admin);
    findFirst.mockResolvedValue({ id: "att-1", approvalStatus: "PENDING", isLocked: true });
    const { POST } = await import("../attendance/[id]/reject/route");
    expect((await POST(req(), ctx())).status).toBe(400);
  });
});

describe("POST /api/attendance/approve-all", () => {
  it("approves every pending, unlocked record in the tenant", async () => {
    await as(admin);
    updateMany.mockResolvedValue({ count: 4 });
    const { POST } = await import("../attendance/approve-all/route");
    const res = await POST(req({}));
    expect(await res.json()).toEqual({ count: 4 });
    expect(updateMany.mock.calls[0][0].where).toEqual({
      approvalStatus: "PENDING",
      isLocked: false,
      employee: { tenantId: "t1" },
    });
  });

  it("limits to the given ids, still tenant-scoped", async () => {
    await as(admin);
    const { POST } = await import("../attendance/approve-all/route");
    await POST(req({ ids: ["a", "b"] }));
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ id: { in: ["a", "b"] }, employee: { tenantId: "t1" } });
  });

  it("403 without permission and 400 for an empty ids array", async () => {
    const { POST } = await import("../attendance/approve-all/route");
    await as({ ...admin, permissions: [] });
    expect((await POST(req({}))).status).toBe(403);
    await as(admin);
    expect((await POST(req({ ids: [] }))).status).toBe(400);
  });
});

describe("GET /api/attendance/pending", () => {
  it("lists pending rows for the tenant with name, campus, time, distance and note", async () => {
    await as(admin);
    findMany.mockResolvedValue([
      {
        id: "att-1", date: "2026-11-07", status: "PRESENT", checkInTime: new Date("2026-11-07T00:10:00Z"),
        distanceMeters: 312, checkInNote: "Antar murid", checkInAccuracy: 20, nearestCampusId: "c1",
        employee: { id: "e1", kode: "G-01", nama: "Sari", jabatan: "Guru", campus: { name: "Home" } },
      },
    ]);
    campusFindMany.mockResolvedValue([{ id: "c1", name: "Taman Aster" }]);
    const { GET } = await import("../attendance/pending/route");
    const res = await GET();
    expect(findMany.mock.calls[0][0].where).toEqual({ approvalStatus: "PENDING", employee: { tenantId: "t1" } });
    expect(await res.json()).toEqual([
      expect.objectContaining({ id: "att-1", distanceMeters: 312, note: "Antar murid", campusName: "Taman Aster", employee: expect.objectContaining({ nama: "Sari" }) }),
    ]);
  });

  it("403 without attendance.override", async () => {
    await as({ ...admin, permissions: ["attendance.view"] });
    const { GET } = await import("../attendance/pending/route");
    expect((await GET()).status).toBe(403);
  });
});
