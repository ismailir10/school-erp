/**
 * F-09 expansion (Task 4) — self-service attendance/leave routes are gated by
 * permission, not by `session.role === "TEACHER"`. Three routes covered here:
 *
 *   POST /api/attendance/check-in   — needs `attendance.checkin`
 *   POST /api/attendance/check-out  — needs `attendance.checkin`
 *   POST /api/leave/requests        — needs `leave.submit`
 *
 * Acceptance: a non-TEACHER role (e.g. SCHOOL_ADMIN) with a linked Employee
 * row AND the matching permission gets through to the success path. A caller
 * with a linked Employee but missing the permission is rejected. A caller
 * without `employeeId` is rejected.
 *
 * GET /api/attendance/my has its own dedicated test file
 * (`attendance-my.test.ts`) that already covers permission-gating coverage,
 * so we don't duplicate it here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const findUniqueAttendance = vi.fn();
const createAttendance = vi.fn();
const updateAttendance = vi.fn();
const findUniqueOrgConfig = vi.fn();
const findUniqueEmployee = vi.fn();
const aggregateLeave = vi.fn();
const findFirstLeaveRequest = vi.fn();
const createLeaveRequest = vi.fn();

const findManyHoliday = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    attendanceRecord: {
      findUnique: findUniqueAttendance,
      create: createAttendance,
      update: updateAttendance,
    },
    orgConfig: {
      findUnique: findUniqueOrgConfig,
    },
    employee: {
      findUnique: findUniqueEmployee,
      findFirst: findUniqueEmployee,
    },
    leaveRequest: {
      aggregate: aggregateLeave,
      findFirst: findFirstLeaveRequest,
      create: createLeaveRequest,
    },
    holiday: {
      findMany: findManyHoliday,
    },
    $transaction: transactionMock,
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

function makeSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role: "SCHOOL_ADMIN",
    tenantId: "t1",
    employeeId: "emp-1",
    parentId: null,
    permissions: [],
    customRoleCode: null,
    ...overrides,
  };
}

async function mockSession(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing attendance record, default org config (ID-Jakarta TZ).
  findUniqueAttendance.mockResolvedValue(null);
  findUniqueOrgConfig.mockResolvedValue({
    timezone: "Asia/Jakarta",
    workStartTime: "08:00",
    gracePeriodMinutes: 15,
    workingDays: JSON.stringify(["MON", "TUE", "WED", "THU", "FRI"]),
  });
  findManyHoliday.mockResolvedValue([]);
  transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      employee: { findUnique: findUniqueEmployee, findFirst: findUniqueEmployee },
      leaveRequest: {
        aggregate: aggregateLeave,
        findFirst: findFirstLeaveRequest,
        create: createLeaveRequest,
      },
    })
  );
  createAttendance.mockResolvedValue({
    id: "att-1",
    date: "2026-05-02",
    status: "PRESENT",
  });
  updateAttendance.mockResolvedValue({
    id: "att-1",
    date: "2026-05-02",
    checkOutTime: new Date(),
  });
  findUniqueEmployee.mockResolvedValue({
    status: "ACTIVE",
    leaveBalanceAnnual: 12,
    leaveBalanceSick: 12,
  });
  aggregateLeave.mockResolvedValue({ _sum: { days: 0 } });
  findFirstLeaveRequest.mockResolvedValue(null);
  createLeaveRequest.mockResolvedValue({
    id: "lr-1",
    employeeId: "emp-1",
    leaveType: "ANNUAL",
    startDate: "2026-05-04",
    endDate: "2026-05-04",
    days: 1,
    status: "PENDING",
  });
});

// ---------------------------------------------------------------------------
// POST /api/attendance/check-in
// ---------------------------------------------------------------------------
describe("POST /api/attendance/check-in — F-09 permission gate", () => {
  it("403 when session has no employeeId (admin user without linked employee)", async () => {
    await mockSession(
      makeSession({ employeeId: null, permissions: ["attendance.checkin"] })
    );
    const { POST } = await import("../attendance/check-in/route");
    const req = new Request("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(createAttendance).not.toHaveBeenCalled();
  });

  it("403 when caller has employeeId but lacks attendance.checkin permission", async () => {
    await mockSession(makeSession({ permissions: ["attendance.view"] }));
    const { POST } = await import("../attendance/check-in/route");
    const req = new Request("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(createAttendance).not.toHaveBeenCalled();
  });

  it("200 for non-TEACHER with linked Employee and attendance.checkin (e.g. ADMIN_TU)", async () => {
    await mockSession(
      makeSession({ role: "SCHOOL_ADMIN", permissions: ["attendance.checkin"] })
    );
    const { POST } = await import("../attendance/check-in/route");
    const req = new Request("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(createAttendance).toHaveBeenCalledOnce();
  });

  it("200 for SUPER_ADMIN owner short-circuit even with empty permissions", async () => {
    await mockSession(
      makeSession({ role: "SUPER_ADMIN", permissions: [] })
    );
    const { POST } = await import("../attendance/check-in/route");
    const req = new Request("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });

  it("400 when lat is sent as a string (Zod rejects non-finite-number)", async () => {
    await mockSession(makeSession({ permissions: ["attendance.checkin"] }));
    const { POST } = await import("../attendance/check-in/route");
    const req = new Request("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({ lat: "-6.2", lng: "106.8" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(createAttendance).not.toHaveBeenCalled();
  });

  it("400 when lat is out of range (e.g. 200)", async () => {
    await mockSession(makeSession({ permissions: ["attendance.checkin"] }));
    const { POST } = await import("../attendance/check-in/route");
    const req = new Request("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({ lat: 200, lng: 0 }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(createAttendance).not.toHaveBeenCalled();
  });

  it("200 with valid numeric lat/lng — passes them through to prisma.create", async () => {
    await mockSession(makeSession({ permissions: ["attendance.checkin"] }));
    const { POST } = await import("../attendance/check-in/route");
    const req = new Request("http://localhost/api/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({ lat: -6.2088, lng: 106.8456 }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(createAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkInLat: -6.2088,
          checkInLng: 106.8456,
        }),
      })
    );
  });

  it("200 when body is missing entirely — empty body treated as {}", async () => {
    await mockSession(makeSession({ permissions: ["attendance.checkin"] }));
    const { POST } = await import("../attendance/check-in/route");
    const req = new Request("http://localhost/api/attendance/check-in", {
      method: "POST",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(createAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkInLat: null,
          checkInLng: null,
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/attendance/check-out
// ---------------------------------------------------------------------------
describe("POST /api/attendance/check-out — F-09 permission gate", () => {
  beforeEach(() => {
    // Check-out needs an existing record to flip to checkOutTime.
    findUniqueAttendance.mockResolvedValue({
      id: "att-1",
      date: "2026-05-02",
      checkOutTime: null,
      status: "PRESENT",
    });
  });

  it("403 when session has no employeeId", async () => {
    await mockSession(
      makeSession({ employeeId: null, permissions: ["attendance.checkin"] })
    );
    const { POST } = await import("../attendance/check-out/route");
    const req = new Request("http://localhost/api/attendance/check-out", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(updateAttendance).not.toHaveBeenCalled();
  });

  it("403 when caller has employeeId but lacks attendance.checkin permission", async () => {
    await mockSession(makeSession({ permissions: ["attendance.view"] }));
    const { POST } = await import("../attendance/check-out/route");
    const req = new Request("http://localhost/api/attendance/check-out", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(updateAttendance).not.toHaveBeenCalled();
  });

  it("200 for non-TEACHER with linked Employee and attendance.checkin", async () => {
    await mockSession(
      makeSession({ role: "SCHOOL_ADMIN", permissions: ["attendance.checkin"] })
    );
    const { POST } = await import("../attendance/check-out/route");
    const req = new Request("http://localhost/api/attendance/check-out", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(updateAttendance).toHaveBeenCalledOnce();
  });

  it("400 when lng is sent as a string", async () => {
    await mockSession(makeSession({ permissions: ["attendance.checkin"] }));
    const { POST } = await import("../attendance/check-out/route");
    const req = new Request("http://localhost/api/attendance/check-out", {
      method: "POST",
      body: JSON.stringify({ lat: 0, lng: "106.8" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(updateAttendance).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/leave/requests
// ---------------------------------------------------------------------------
describe("POST /api/leave/requests — F-09 permission gate", () => {
  const validBody = {
    leaveType: "ANNUAL",
    // Far-future Monday: ANNUAL cannot start in the past, and a single weekday
    // keeps the inclusive-day count at 1 regardless of when the test runs.
    startDate: "2099-05-04",
    endDate: "2099-05-04",
    reason: "Acara keluarga di luar kota",
  };

  it("403 when session has no employeeId", async () => {
    await mockSession(
      makeSession({ employeeId: null, permissions: ["leave.submit"] })
    );
    const { POST } = await import("../leave/requests/route");
    const req = new Request("http://localhost/api/leave/requests", {
      method: "POST",
      body: JSON.stringify(validBody),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(createLeaveRequest).not.toHaveBeenCalled();
  });

  it("403 when caller has employeeId but lacks leave.submit permission", async () => {
    await mockSession(makeSession({ permissions: ["leave.view"] }));
    const { POST } = await import("../leave/requests/route");
    const req = new Request("http://localhost/api/leave/requests", {
      method: "POST",
      body: JSON.stringify(validBody),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(createLeaveRequest).not.toHaveBeenCalled();
  });

  it("201 for non-TEACHER (e.g. SCHOOL_ADMIN) with linked Employee and leave.submit", async () => {
    await mockSession(
      makeSession({ role: "SCHOOL_ADMIN", permissions: ["leave.submit"] })
    );
    const { POST } = await import("../leave/requests/route");
    const req = new Request("http://localhost/api/leave/requests", {
      method: "POST",
      body: JSON.stringify(validBody),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    expect(createLeaveRequest).toHaveBeenCalledOnce();
  });

  it("201 for SUPER_ADMIN owner short-circuit even with empty permissions", async () => {
    await mockSession(makeSession({ role: "SUPER_ADMIN", permissions: [] }));
    const { POST } = await import("../leave/requests/route");
    const req = new Request("http://localhost/api/leave/requests", {
      method: "POST",
      body: JSON.stringify(validBody),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(201);
  });
});
