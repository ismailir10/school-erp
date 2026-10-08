/**
 * F-08 coverage for `POST /api/leave/requests/[id]/approve`.
 *
 * The approve handler creates `LEAVE` AttendanceRecord rows for each day in
 * the leave period. Previously the loop skipped weekends only — public
 * holidays were written as LEAVE rows, double-counting against payroll's
 * holiday-aware day arithmetic. After the fix, the loop also skips holidays
 * (and unconfigured working days like SAT in a Mon-Fri tenant).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const orgConfigFindUnique = vi.fn();
const holidayFindMany = vi.fn();
const leaveRequestFindUnique = vi.fn();
const leaveRequestUpdateMany = vi.fn();
const leaveRequestAggregate = vi.fn();
const employeeFindFirst = vi.fn();
const executeRaw = vi.fn();
const attendanceFindUnique = vi.fn();
const attendanceUpsert = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    orgConfig: { findUnique: orgConfigFindUnique },
    holiday: { findMany: holidayFindMany },
    leaveRequest: {
      findUnique: leaveRequestFindUnique,
      updateMany: leaveRequestUpdateMany,
      aggregate: leaveRequestAggregate,
    },
    employee: { findFirst: employeeFindFirst },
    attendanceRecord: {
      findUnique: attendanceFindUnique,
      upsert: attendanceUpsert,
    },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function makeSession(): SessionUser {
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

async function mockSession(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}

beforeEach(() => {
  vi.clearAllMocks();
  orgConfigFindUnique.mockResolvedValue({
    workingDays: JSON.stringify(["MON", "TUE", "WED", "THU", "FRI"]),
  });
  holidayFindMany.mockResolvedValue([]);
  leaveRequestUpdateMany.mockResolvedValue({ count: 1 });
  // Re-read inside the tx after the conditional update (the pre-read uses mockResolvedValueOnce).
  leaveRequestFindUnique.mockResolvedValue({ id: "lr-1", status: "APPROVED" });
  leaveRequestAggregate.mockResolvedValue({ _sum: { days: 0 } });
  employeeFindFirst.mockResolvedValue({ leaveBalanceAnnual: 12, leaveBalanceSick: 14 });
  executeRaw.mockResolvedValue(1);
  attendanceFindUnique.mockResolvedValue(null);
  attendanceUpsert.mockResolvedValue({});
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      $executeRaw: executeRaw,
      employee: { findFirst: employeeFindFirst },
      leaveRequest: {
        findUnique: leaveRequestFindUnique,
        updateMany: leaveRequestUpdateMany,
        aggregate: leaveRequestAggregate,
      },
      attendanceRecord: {
        findUnique: attendanceFindUnique,
        upsert: attendanceUpsert,
      },
    })
  );
});

function approveReq(): Request {
  return new Request("http://localhost/api/leave/requests/lr-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note: "OK" }),
  });
}

describe("F-08 — leave approve creates LEAVE rows on working, non-holiday days only", () => {
  it("skips weekends AND public holidays", async () => {
    await mockSession(makeSession());
    leaveRequestFindUnique.mockResolvedValueOnce({
      id: "lr-1",
      employeeId: "emp-1",
      status: "PENDING",
      startDate: "2026-04-13", // Monday
      endDate: "2026-04-19", // Sunday
      reason: "Family",
      employee: { tenantId: "t1" },
    });
    // Wed 2026-04-15 is a public holiday.
    holidayFindMany.mockResolvedValueOnce([{ date: "2026-04-15" }]);

    const { POST } = await import("../leave/requests/[id]/approve/route");
    const res = await POST(approveReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(200);
    // Mon, Tue, Thu, Fri = 4 working/non-holiday days.
    const upsertedDates = attendanceUpsert.mock.calls.map(
      (call) => call[0].create.date
    );
    expect(upsertedDates).toEqual(["2026-04-13", "2026-04-14", "2026-04-16", "2026-04-17"]);
    // Confirm Wed (holiday) and Sat/Sun (weekend) were skipped.
    expect(upsertedDates).not.toContain("2026-04-15");
    expect(upsertedDates).not.toContain("2026-04-18");
    expect(upsertedDates).not.toContain("2026-04-19");
  });

  it("skips locked attendance rows (payroll already approved)", async () => {
    await mockSession(makeSession());
    leaveRequestFindUnique.mockResolvedValueOnce({
      id: "lr-1",
      employeeId: "emp-1",
      status: "PENDING",
      startDate: "2026-04-13",
      endDate: "2026-04-14",
      reason: "Family",
      employee: { tenantId: "t1" },
    });
    // Mon 2026-04-13 is locked; Tue 2026-04-14 is open.
    attendanceFindUnique
      .mockResolvedValueOnce({ isLocked: true })
      .mockResolvedValueOnce(null);

    const { POST } = await import("../leave/requests/[id]/approve/route");
    const res = await POST(approveReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(200);
    expect(attendanceUpsert).toHaveBeenCalledTimes(1);
    expect(attendanceUpsert.mock.calls[0][0].create.date).toBe("2026-04-14");
  });

  it("falls back to MON-FRI when OrgConfig is absent (still skips holidays)", async () => {
    await mockSession(makeSession());
    orgConfigFindUnique.mockResolvedValueOnce(null);
    leaveRequestFindUnique.mockResolvedValueOnce({
      id: "lr-1",
      employeeId: "emp-1",
      status: "PENDING",
      startDate: "2026-04-13",
      endDate: "2026-04-17",
      reason: "Family",
      employee: { tenantId: "t1" },
    });
    holidayFindMany.mockResolvedValueOnce([{ date: "2026-04-15" }]);

    const { POST } = await import("../leave/requests/[id]/approve/route");
    const res = await POST(approveReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(200);
    const dates = attendanceUpsert.mock.calls.map((c) => c[0].create.date);
    expect(dates).toEqual(["2026-04-13", "2026-04-14", "2026-04-16", "2026-04-17"]);
  });

  it("returns 404 when leave belongs to a different tenant", async () => {
    await mockSession(makeSession());
    leaveRequestFindUnique.mockResolvedValueOnce({
      id: "lr-1",
      employeeId: "emp-1",
      status: "PENDING",
      startDate: "2026-04-13",
      endDate: "2026-04-13",
      reason: "X",
      employee: { tenantId: "t2" },
    });

    const { POST } = await import("../leave/requests/[id]/approve/route");
    const res = await POST(approveReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });
    expect(res.status).toBe(404);
    expect(attendanceUpsert).not.toHaveBeenCalled();
  });
});
