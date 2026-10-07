/**
 * F-27 coverage for `POST /api/leave/requests/[id]/cancel`.
 *
 * Two cancel paths share one handler:
 *   - PENDING — owner cancels their own pending request (status flip only).
 *   - APPROVED — owner OR admin (`leave.approve`) reverses the approval:
 *     restore balance + delete generated LEAVE attendance rows + flip status.
 *
 * Tests below cover authorization (owner vs admin vs other), status guards
 * (PENDING / APPROVED → 200, CANCELLED / REJECTED → 409), tenant isolation
 * (404), and the side-effects on the APPROVED path (balance restored,
 * generated attendance rows deleted via `deleteMany`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const leaveRequestFindUnique = vi.fn();
const leaveRequestUpdate = vi.fn();
const employeeUpdate = vi.fn();
const attendanceDeleteMany = vi.fn();
const auditCreate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    leaveRequest: {
      findUnique: leaveRequestFindUnique,
      update: leaveRequestUpdate,
    },
    employee: {
      update: employeeUpdate,
    },
    attendanceRecord: {
      deleteMany: attendanceDeleteMany,
    },
    auditLog: {
      create: auditCreate,
    },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function makeSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-1",
    email: "u@u",
    name: "User",
    role: "TEACHER",
    tenantId: "t1",
    employeeId: "emp-1",
    parentId: null,
    permissions: getSystemRolePermissions("TEACHER"),
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
  // Default: $transaction passes through with a tx that proxies to our
  // top-level mocks. Each test that needs a different shape (e.g. the
  // "find vanished" race) overrides this implementation.
  transaction.mockImplementation(
    async (
      cb: (tx: unknown) => unknown,
      _opts?: { isolationLevel?: string }
    ) =>
      cb({
        leaveRequest: {
          findUnique: leaveRequestFindUnique,
          update: leaveRequestUpdate,
        },
        employee: { update: employeeUpdate },
        attendanceRecord: { deleteMany: attendanceDeleteMany },
        auditLog: { create: auditCreate },
      })
  );
  leaveRequestUpdate.mockResolvedValue({ id: "lr-1", status: "CANCELLED" });
  employeeUpdate.mockResolvedValue({});
  attendanceDeleteMany.mockResolvedValue({ count: 5 });
  auditCreate.mockResolvedValue({});
});

function cancelReq(body: object = {}): Request {
  return new Request("http://localhost/api/leave/requests/lr-1/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/leave/requests/[id]/cancel — F-27", () => {
  it("owner cancels their own APPROVED leave → 200, balance restored, attendance deleted", async () => {
    await mockSession(makeSession()); // employeeId: emp-1
    const approved = {
      id: "lr-1",
      employeeId: "emp-1",
      leaveType: "ANNUAL",
      startDate: "2026-04-13",
      endDate: "2026-04-17",
      days: 5,
      status: "APPROVED",
      employee: { tenantId: "t1" },
    };
    // First read (outer findUnique with employee include) and the in-tx
    // re-read both return the APPROVED row.
    leaveRequestFindUnique
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce(approved);

    const { POST } = await import("../leave/requests/[id]/cancel/route");
    const res = await POST(cancelReq({ note: "changed plans" }) as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(200);
    // No entitlement write: remaining leave is derived from APPROVED rows,
    // so CANCELLED already returns the days (an increment double-counted).
    expect(employeeUpdate).not.toHaveBeenCalled();
    // Generated attendance rows deleted, manual overrides untouched.
    expect(attendanceDeleteMany).toHaveBeenCalledWith({
      where: {
        employeeId: "emp-1",
        date: { gte: "2026-04-13", lte: "2026-04-17" },
        status: "LEAVE",
        overrideReason: { startsWith: "Cuti:" },
        isLocked: false,
      },
    });
    // Audit row written.
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "LeaveRequest",
          entityId: "lr-1",
          action: "cancel",
        }),
      })
    );
  });

  it("admin (leave.approve) cancels another employee's APPROVED leave → 200", async () => {
    await mockSession(
      makeSession({
        role: "SUPER_ADMIN",
        employeeId: null,
        permissions: getSystemRolePermissions("SUPER_ADMIN"),
      })
    );
    const approved = {
      id: "lr-1",
      employeeId: "emp-99", // different employee
      leaveType: "SICK",
      startDate: "2026-04-13",
      endDate: "2026-04-14",
      days: 2,
      status: "APPROVED",
      employee: { tenantId: "t1" },
    };
    leaveRequestFindUnique
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce(approved);

    const { POST } = await import("../leave/requests/[id]/cancel/route");
    const res = await POST(cancelReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(200);
    expect(employeeUpdate).not.toHaveBeenCalled();
  });

  it("non-owner without leave.approve → 403", async () => {
    // Teacher with leave.submit but trying to cancel someone else's leave.
    await mockSession(makeSession({ employeeId: "emp-2" }));
    leaveRequestFindUnique.mockResolvedValueOnce({
      id: "lr-1",
      employeeId: "emp-1", // owned by a different teacher
      leaveType: "ANNUAL",
      startDate: "2026-04-13",
      endDate: "2026-04-17",
      days: 5,
      status: "APPROVED",
      employee: { tenantId: "t1" },
    });

    const { POST } = await import("../leave/requests/[id]/cancel/route");
    const res = await POST(cancelReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("PENDING request cancels successfully → 200 (no balance/attendance side-effects)", async () => {
    await mockSession(makeSession());
    const pending = {
      id: "lr-1",
      employeeId: "emp-1",
      leaveType: "ANNUAL",
      startDate: "2026-04-13",
      endDate: "2026-04-17",
      days: 5,
      status: "PENDING",
      employee: { tenantId: "t1" },
    };
    leaveRequestFindUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);

    const { POST } = await import("../leave/requests/[id]/cancel/route");
    const res = await POST(cancelReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(200);
    // PENDING never had balance deducted or attendance written — skip both.
    expect(employeeUpdate).not.toHaveBeenCalled();
    expect(attendanceDeleteMany).not.toHaveBeenCalled();
  });

  it("CANCELLED request → 409 (no-op)", async () => {
    await mockSession(makeSession());
    leaveRequestFindUnique.mockResolvedValueOnce({
      id: "lr-1",
      employeeId: "emp-1",
      leaveType: "ANNUAL",
      startDate: "2026-04-13",
      endDate: "2026-04-17",
      days: 5,
      status: "CANCELLED",
      employee: { tenantId: "t1" },
    });

    const { POST } = await import("../leave/requests/[id]/cancel/route");
    const res = await POST(cancelReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(409);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("REJECTED request → 409 (no-op)", async () => {
    await mockSession(makeSession());
    leaveRequestFindUnique.mockResolvedValueOnce({
      id: "lr-1",
      employeeId: "emp-1",
      leaveType: "ANNUAL",
      startDate: "2026-04-13",
      endDate: "2026-04-17",
      days: 5,
      status: "REJECTED",
      employee: { tenantId: "t1" },
    });

    const { POST } = await import("../leave/requests/[id]/cancel/route");
    const res = await POST(cancelReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(409);
  });

  it("cross-tenant request → 404", async () => {
    await mockSession(makeSession()); // tenantId: t1
    leaveRequestFindUnique.mockResolvedValueOnce({
      id: "lr-1",
      employeeId: "emp-1",
      leaveType: "ANNUAL",
      startDate: "2026-04-13",
      endDate: "2026-04-17",
      days: 5,
      status: "APPROVED",
      employee: { tenantId: "t2" }, // belongs to a different tenant
    });

    const { POST } = await import("../leave/requests/[id]/cancel/route");
    const res = await POST(cancelReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
  });
});
