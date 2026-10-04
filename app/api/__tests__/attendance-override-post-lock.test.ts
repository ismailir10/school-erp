/**
 * Blocker B4 (2026-05-17 review): the PUT handler on
 * `/api/attendance/[id]/override` correctly rejects updates when the existing
 * record's `isLocked` is true (payroll already approved), but the POST handler
 * — which `upsert`s by the `{employeeId, date}` composite key — was missing
 * the same guard. A caller could overwrite a payroll-locked record by hitting
 * POST instead of PUT, breaking the payroll audit trail.
 *
 * This test pins the new pre-upsert `findUnique({...isLocked...})` guard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const attendanceFindUnique = vi.fn();
const attendanceUpsert = vi.fn();
const attendanceUpdate = vi.fn();
const orgConfigFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    attendanceRecord: {
      findUnique: attendanceFindUnique,
      upsert: attendanceUpsert,
      update: attendanceUpdate,
    },
    orgConfig: { findUnique: orgConfigFindUnique },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

const verifyTenantOwnership = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/auth-guard", () => ({
  verifyTenantOwnership: (...args: unknown[]) => verifyTenantOwnership(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

function makeSession(): SessionUser {
  return {
    id: "user-1",
    email: "admin@school.test",
    name: "Admin",
    role: "SCHOOL_ADMIN",
    tenantId: "tenant-1",
    employeeId: null,
    parentId: null,
    permissions: ["attendance.override"],
    customRoleCode: null,
  };
}

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/attendance/emp-1/override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  date: "2026-04-20",
  status: "PRESENT",
  reason: "Manual override test",
};

describe("POST /api/attendance/[id]/override — payroll-lock guard (B4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyTenantOwnership.mockResolvedValue(true);
    orgConfigFindUnique.mockResolvedValue({ timezone: "Asia/Jakarta" });
  });

  it("rejects with 400 when the existing record is payroll-locked", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    attendanceFindUnique.mockResolvedValue({
      id: "att-1",
      employeeId: "emp-1",
      date: "2026-04-20",
      isLocked: true,
    });

    const { POST } = await import("../attendance/[id]/override/route");
    const res = await POST(makeReq(validBody) as never, {
      params: Promise.resolve({ id: "emp-1" }),
    } as never);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "Record terkunci (payroll sudah disetujui)" });
    expect(attendanceUpsert).not.toHaveBeenCalled();
  });

  it("proceeds with upsert when no existing record blocks", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    attendanceFindUnique.mockResolvedValue(null);
    attendanceUpsert.mockResolvedValue({
      id: "att-new",
      employeeId: "emp-1",
      date: "2026-04-20",
      status: "PRESENT",
    });

    const { POST } = await import("../attendance/[id]/override/route");
    const res = await POST(makeReq(validBody) as never, {
      params: Promise.resolve({ id: "emp-1" }),
    } as never);

    expect(res.status).toBe(200);
    expect(attendanceUpsert).toHaveBeenCalledOnce();
  });

  it("proceeds with upsert when existing record is not locked", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    attendanceFindUnique.mockResolvedValue({
      id: "att-2",
      employeeId: "emp-1",
      date: "2026-04-20",
      isLocked: false,
    });
    attendanceUpsert.mockResolvedValue({
      id: "att-2",
      employeeId: "emp-1",
      date: "2026-04-20",
      status: "LATE",
    });

    const { POST } = await import("../attendance/[id]/override/route");
    const res = await POST(
      makeReq({ ...validBody, status: "LATE" }) as never,
      { params: Promise.resolve({ id: "emp-1" }) } as never,
    );

    expect(res.status).toBe(200);
    expect(attendanceUpsert).toHaveBeenCalledOnce();
  });
});

describe("override check-in time (HH:MM in school timezone)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    verifyTenantOwnership.mockResolvedValue(true);
    orgConfigFindUnique.mockResolvedValue({ timezone: "Asia/Jakarta" });
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
  });

  it("POST persists checkInTime as the UTC instant of local Jakarta time", async () => {
    attendanceFindUnique.mockResolvedValue(null);
    attendanceUpsert.mockResolvedValue({ id: "att-new" });
    const { POST } = await import("../attendance/[id]/override/route");
    const res = await POST(
      makeReq({ ...validBody, date: "2026-10-05", checkInTime: "07:30" }) as never,
      { params: Promise.resolve({ id: "emp-1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(orgConfigFindUnique).toHaveBeenCalledWith({ where: { tenantId: "tenant-1" } });
    const arg = attendanceUpsert.mock.calls[0][0];
    expect(arg.create.checkInTime).toEqual(new Date("2026-10-05T00:30:00.000Z"));
    expect(arg.update.checkInTime).toEqual(new Date("2026-10-05T00:30:00.000Z"));
  });

  it("POST uses the tenant timezone when it is not Jakarta", async () => {
    orgConfigFindUnique.mockResolvedValue({ timezone: "Asia/Makassar" });
    attendanceFindUnique.mockResolvedValue(null);
    attendanceUpsert.mockResolvedValue({ id: "att-new" });
    const { POST } = await import("../attendance/[id]/override/route");
    await POST(
      makeReq({ ...validBody, date: "2026-10-05", checkInTime: "07:30" }) as never,
      { params: Promise.resolve({ id: "emp-1" }) } as never,
    );
    const arg = attendanceUpsert.mock.calls[0][0];
    expect(arg.create.checkInTime).toEqual(new Date("2026-10-04T23:30:00.000Z"));
  });

  it("POST falls back to Asia/Jakarta when the tenant has no OrgConfig", async () => {
    orgConfigFindUnique.mockResolvedValue(null);
    attendanceFindUnique.mockResolvedValue(null);
    attendanceUpsert.mockResolvedValue({ id: "att-new" });
    const { POST } = await import("../attendance/[id]/override/route");
    await POST(
      makeReq({ ...validBody, date: "2026-10-05", checkInTime: "07:30" }) as never,
      { params: Promise.resolve({ id: "emp-1" }) } as never,
    );
    expect(attendanceUpsert.mock.calls[0][0].create.checkInTime).toEqual(
      new Date("2026-10-05T00:30:00.000Z"),
    );
  });

  it("POST without a time leaves checkInTime unset", async () => {
    attendanceFindUnique.mockResolvedValue(null);
    attendanceUpsert.mockResolvedValue({ id: "att-new" });
    const { POST } = await import("../attendance/[id]/override/route");
    await POST(
      makeReq({ ...validBody, checkInTime: "" }) as never,
      { params: Promise.resolve({ id: "emp-1" }) } as never,
    );
    const arg = attendanceUpsert.mock.calls[0][0];
    expect(arg.create.checkInTime).toBeUndefined();
    expect(arg.update.checkInTime).toBeUndefined();
  });

  it("POST rejects a malformed time with 400", async () => {
    const { POST } = await import("../attendance/[id]/override/route");
    const res = await POST(
      makeReq({ ...validBody, checkInTime: "25:00" }) as never,
      { params: Promise.resolve({ id: "emp-1" }) } as never,
    );
    expect(res.status).toBe(400);
    expect(attendanceUpsert).not.toHaveBeenCalled();
  });

  function putReq(body: unknown) {
    return new Request("http://localhost:3000/api/attendance/att-1/override", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("PUT with HH:MM persists the converted instant on the record's date", async () => {
    attendanceFindUnique.mockResolvedValue({ id: "att-1", date: "2026-10-05", isLocked: false });
    attendanceUpdate.mockResolvedValue({ id: "att-1" });
    const { PUT } = await import("../attendance/[id]/override/route");
    const res = await PUT(
      putReq({ status: "LATE", reason: "Koreksi", checkInTime: "07:30" }) as never,
      { params: Promise.resolve({ id: "att-1" }) } as never,
    );
    expect(res.status).toBe(200);
    expect(attendanceUpdate.mock.calls[0][0].data.checkInTime).toEqual(
      new Date("2026-10-05T00:30:00.000Z"),
    );
  });

  it("PUT still rejects a locked record", async () => {
    attendanceFindUnique.mockResolvedValue({ id: "att-1", date: "2026-10-05", isLocked: true });
    const { PUT } = await import("../attendance/[id]/override/route");
    const res = await PUT(
      putReq({ status: "LATE", reason: "Koreksi", checkInTime: "07:30" }) as never,
      { params: Promise.resolve({ id: "att-1" }) } as never,
    );
    expect(res.status).toBe(400);
    expect(attendanceUpdate).not.toHaveBeenCalled();
  });

  it("PUT without a time leaves checkInTime unchanged", async () => {
    attendanceFindUnique.mockResolvedValue({ id: "att-1", date: "2026-10-05", isLocked: false });
    attendanceUpdate.mockResolvedValue({ id: "att-1" });
    const { PUT } = await import("../attendance/[id]/override/route");
    await PUT(
      putReq({ status: "LATE", reason: "Koreksi" }) as never,
      { params: Promise.resolve({ id: "att-1" }) } as never,
    );
    expect(attendanceUpdate.mock.calls[0][0].data.checkInTime).toBeUndefined();
  });

  it("POST rejects a nonexistent DST-gap local time with 400 and writes nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T00:00:00Z"));
    try {
      orgConfigFindUnique.mockResolvedValue({ timezone: "America/New_York" });
      attendanceFindUnique.mockResolvedValue(null);
      const { POST } = await import("../attendance/[id]/override/route");
      const res = await POST(
        makeReq({ ...validBody, date: "2026-03-08", checkInTime: "02:30" }) as never,
        { params: Promise.resolve({ id: "emp-1" }) } as never,
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/tidak ada/);
      expect(attendanceUpsert).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("PUT rejects a nonexistent DST-gap local time with 400 and writes nothing", async () => {
    orgConfigFindUnique.mockResolvedValue({ timezone: "America/New_York" });
    attendanceFindUnique.mockResolvedValue({ id: "att-1", date: "2026-03-08", isLocked: false });
    const { PUT } = await import("../attendance/[id]/override/route");
    const res = await PUT(
      putReq({ status: "LATE", reason: "Koreksi", checkInTime: "02:30" }) as never,
      { params: Promise.resolve({ id: "att-1" }) } as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/tidak ada/);
    expect(attendanceUpdate).not.toHaveBeenCalled();
  });
});
