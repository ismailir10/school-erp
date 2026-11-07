/**
 * Geofenced staff check-in (docs/cycles/2026-11-07-attendance-geofence-gate.md).
 * Inside / no pinned campus → APPROVED; outside or no location → 422 until a
 * note is sent, then a PENDING record.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const findUniqueAttendance = vi.fn();
const createAttendance = vi.fn();
const findUniqueOrgConfig = vi.fn();
const findManyCampus = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    attendanceRecord: { findUnique: findUniqueAttendance, create: createAttendance },
    orgConfig: { findUnique: findUniqueOrgConfig },
    campus: { findMany: findManyCampus },
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

const session: SessionUser = {
  id: "u1",
  email: "t@t",
  name: "T",
  role: "TEACHER",
  tenantId: "t1",
  employeeId: "emp-1",
  parentId: null,
  permissions: ["attendance.checkin"],
  customRoleCode: null,
};

const campus = { id: "c1", name: "Taman Aster", lat: -6.2, lng: 106.8, radiusMeters: 50 };

async function post(body: unknown) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(session);
  const { POST } = await import("../attendance/check-in/route");
  return POST(new Request("http://localhost/api/attendance/check-in", { method: "POST", body: JSON.stringify(body) }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueAttendance.mockResolvedValue(null);
  findUniqueOrgConfig.mockResolvedValue(null);
  findManyCampus.mockResolvedValue([campus]);
  createAttendance.mockImplementation(async ({ data }) => ({ id: "att-1", ...data }));
});

describe("POST /api/attendance/check-in — geofence", () => {
  it("loads only the tenant's ACTIVE campuses", async () => {
    await post({ lat: -6.2, lng: 106.8 });
    expect(findManyCampus.mock.calls[0][0].where).toEqual({ tenantId: "t1", status: "ACTIVE" });
  });

  it("inside: records as before with distance, no approval flag", async () => {
    const res = await post({ lat: -6.2, lng: 106.8, accuracy: 12.4 });
    expect(res.status).toBe(200);
    const data = createAttendance.mock.calls[0][0].data;
    expect(data).toMatchObject({ distanceMeters: 0, nearestCampusId: "c1", checkInAccuracy: 12 });
    expect(data.approvalStatus).toBeUndefined();
  });

  it("accuracy lets a near-miss pass", async () => {
    const res = await post({ lat: -6.199, lng: 106.8, accuracy: 70 });
    expect(res.status).toBe(200);
    expect(createAttendance.mock.calls[0][0].data.approvalStatus).toBeUndefined();
  });

  it("outside without note: 422 OUTSIDE_GEOFENCE, nothing created", async () => {
    const res = await post({ lat: -6.199, lng: 106.8 });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "OUTSIDE_GEOFENCE", distanceMeters: 111, campusName: "Taman Aster" });
    expect(createAttendance).not.toHaveBeenCalled();
  });

  it("outside with a too-short note is still refused", async () => {
    const res = await post({ lat: -6.199, lng: 106.8, note: " ok " });
    expect(res.status).toBe(422);
    expect(createAttendance).not.toHaveBeenCalled();
  });

  it("outside with a note: PENDING record keeps note, distance and campus", async () => {
    const res = await post({ lat: -6.199, lng: 106.8, accuracy: 20, note: "  Antar murid ke dokter  " });
    expect(res.status).toBe(200);
    expect(createAttendance.mock.calls[0][0].data).toMatchObject({
      approvalStatus: "PENDING",
      checkInNote: "Antar murid ke dokter",
      distanceMeters: 111,
      nearestCampusId: "c1",
      checkInAccuracy: 20,
    });
  });

  it("no location: 422 with null distance, then PENDING with a note", async () => {
    const refused = await post({});
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: "OUTSIDE_GEOFENCE", distanceMeters: null });
    const ok = await post({ note: "GPS mati di dalam gedung" });
    expect(ok.status).toBe(200);
    expect(createAttendance.mock.calls[0][0].data).toMatchObject({ approvalStatus: "PENDING", distanceMeters: null });
  });

  it("no pinned campus: plain APPROVED check-in even without location", async () => {
    findManyCampus.mockResolvedValue([{ ...campus, lat: null, lng: null }]);
    const res = await post({});
    expect(res.status).toBe(200);
    const data = createAttendance.mock.calls[0][0].data;
    expect(data.approvalStatus).toBeUndefined();
    expect(data.distanceMeters).toBeUndefined();
  });

  it("rejects a note over 500 characters", async () => {
    const res = await post({ lat: -6.199, lng: 106.8, note: "x".repeat(501) });
    expect(res.status).toBe(400);
  });
});
