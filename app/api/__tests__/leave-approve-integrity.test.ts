/**
 * STR-5 (2026-10-07 stress run) coverage for `POST /api/leave/requests/[id]/approve`:
 *   - body: missing / garbled JSON → 400 (was a raw 500); `{ note }` optional;
 *   - the status flip is a conditional update (`status: "PENDING"`), so the
 *     loser of an approve/reject race gets 409, not a second 200;
 *   - approve re-checks the balance (approved others + this ≤ allowance) and
 *     refuses with 409 instead of driving it negative;
 *   - approvals are serialised per employee with an advisory lock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const h = vi.hoisted(() => ({
  orgConfigFindUnique: vi.fn(),
  holidayFindMany: vi.fn(),
  leaveFindUnique: vi.fn(),
  leaveUpdateMany: vi.fn(),
  leaveAggregate: vi.fn(),
  employeeFindFirst: vi.fn(),
  attendanceFindUnique: vi.fn(),
  attendanceUpsert: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    orgConfig: { findUnique: h.orgConfigFindUnique },
    holiday: { findMany: h.holidayFindMany },
    leaveRequest: { findUnique: h.leaveFindUnique },
    $transaction: h.transaction,
  },
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function session(): SessionUser {
  return {
    id: "approver-1",
    email: "a@a",
    name: "Approver",
    role: "SUPER_ADMIN",
    tenantId: "t1",
    employeeId: null,
    parentId: null,
    permissions: getSystemRolePermissions("SUPER_ADMIN"),
    customRoleCode: null,
  };
}

// A request in the current balance year so the balance check applies.
const YEAR = new Date().getFullYear();
function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "lr-1",
    employeeId: "emp-1",
    leaveType: "ANNUAL",
    days: 10,
    status: "PENDING",
    startDate: `${YEAR}-06-01`,
    endDate: `${YEAR}-06-12`,
    reason: "Keluarga",
    employee: { tenantId: "t1" },
    ...overrides,
  };
}

function req(body?: string) {
  return new Request("http://localhost/api/leave/requests/lr-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body } : {}),
  }) as never;
}
const ctx = { params: Promise.resolve({ id: "lr-1" }) };

async function call(body?: string) {
  const { POST } = await import("../leave/requests/[id]/approve/route");
  return POST(req(body), ctx);
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(session());
  h.orgConfigFindUnique.mockResolvedValue({ workingDays: JSON.stringify(["MON", "TUE", "WED", "THU", "FRI"]) });
  h.holidayFindMany.mockResolvedValue([]);
  h.leaveFindUnique.mockResolvedValue(pendingRequest());
  h.leaveUpdateMany.mockResolvedValue({ count: 1 });
  h.leaveAggregate.mockResolvedValue({ _sum: { days: 0 } });
  h.employeeFindFirst.mockResolvedValue({ leaveBalanceAnnual: 12, leaveBalanceSick: 14 });
  h.attendanceFindUnique.mockResolvedValue(null);
  h.attendanceUpsert.mockResolvedValue({});
  h.executeRaw.mockResolvedValue(1);
  h.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      $executeRaw: h.executeRaw,
      employee: { findFirst: h.employeeFindFirst },
      leaveRequest: { findUnique: h.leaveFindUnique, updateMany: h.leaveUpdateMany, aggregate: h.leaveAggregate },
      attendanceRecord: { findUnique: h.attendanceFindUnique, upsert: h.attendanceUpsert },
    }),
  );
});

describe("approve — request body", () => {
  it("400 (not 500) when there is no body", async () => {
    const res = await call(undefined);
    expect(res.status).toBe(400);
    expect(h.leaveFindUnique).not.toHaveBeenCalled();
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("400 when the body is not valid JSON", async () => {
    const res = await call("{nope");
    expect(res.status).toBe(400);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("400 when the body is not an object", async () => {
    const res = await call("[1,2]");
    expect(res.status).toBe(400);
  });

  it("accepts {} (note stays optional) and stores a null note", async () => {
    const res = await call("{}");
    expect(res.status).toBe(200);
    expect(h.leaveUpdateMany.mock.calls[0][0].data.reviewNote).toBeNull();
  });

  it("trims the note", async () => {
    await call(JSON.stringify({ note: "  OK  " }));
    expect(h.leaveUpdateMany.mock.calls[0][0].data.reviewNote).toBe("OK");
  });
});

describe("approve — single winner (conditional update)", () => {
  it("updates only a still-PENDING row", async () => {
    const res = await call("{}");
    expect(res.status).toBe(200);
    expect(h.leaveUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "lr-1", status: "PENDING" },
        data: expect.objectContaining({ status: "APPROVED", reviewedBy: "approver-1" }),
      }),
    );
  });

  it("409 'sudah diproses' and no attendance rows when the conditional update matches nothing", async () => {
    h.leaveUpdateMany.mockResolvedValueOnce({ count: 0 });
    const res = await call("{}");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Pengajuan ini sudah diproses.");
    expect(h.attendanceUpsert).not.toHaveBeenCalled();
  });

  it("takes a per-employee advisory lock before checking the balance", async () => {
    await call("{}");
    expect(h.executeRaw).toHaveBeenCalledOnce();
    expect(h.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(h.leaveAggregate.mock.invocationCallOrder[0]);
  });
});

describe("approve — balance re-check", () => {
  it("409 when approved days of others + this request exceed the allowance (no update, no attendance)", async () => {
    // 12-day allowance, 8 already approved, this one is 10 → would be -6.
    h.leaveAggregate.mockResolvedValueOnce({ _sum: { days: 8 } });
    const res = await call("{}");
    expect(res.status).toBe(409);
    const msg = (await res.json()).error as string;
    expect(msg).toContain("Sisa cuti tahunan karyawan ini hanya 4 hari");
    expect(msg).toContain("pengajuan ini 10 hari");
    expect(h.leaveUpdateMany).not.toHaveBeenCalled();
    expect(h.attendanceUpsert).not.toHaveBeenCalled();
  });

  it("counts only APPROVED days of the same type, excluding this request", async () => {
    await call("{}");
    expect(h.leaveAggregate.mock.calls[0][0].where).toMatchObject({
      employeeId: "emp-1",
      leaveType: "ANNUAL",
      status: "APPROVED",
      id: { not: "lr-1" },
    });
  });

  it("approves when it fits exactly", async () => {
    h.leaveAggregate.mockResolvedValueOnce({ _sum: { days: 2 } }); // 12 - 2 = 10
    const res = await call("{}");
    expect(res.status).toBe(200);
  });

  it("does not balance-gate PERMISSION / OTHER leave", async () => {
    h.leaveFindUnique.mockResolvedValueOnce(pendingRequest({ leaveType: "PERMISSION", days: 30 }));
    const res = await call("{}");
    expect(res.status).toBe(200);
    expect(h.leaveAggregate).not.toHaveBeenCalled();
  });

  it("uses the sick allowance for SICK leave", async () => {
    h.leaveFindUnique.mockResolvedValueOnce(pendingRequest({ leaveType: "SICK", days: 15 }));
    const res = await call("{}");
    expect(res.status).toBe(409); // 14-day sick allowance
    expect((await res.json()).error).toContain("Sisa cuti sakit karyawan ini hanya 14 hari");
  });

  it("skips the balance gate for a request that started before this balance year", async () => {
    h.leaveFindUnique.mockResolvedValueOnce(pendingRequest({ startDate: `${YEAR - 1}-12-20`, endDate: `${YEAR - 1}-12-31` }));
    const res = await call("{}");
    expect(res.status).toBe(200);
    expect(h.leaveAggregate).not.toHaveBeenCalled();
  });
});
