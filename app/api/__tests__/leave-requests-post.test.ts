/**
 * F-07 / F-10 coverage for `POST /api/leave/requests`.
 *
 * F-07 — leave-day count uses `calculateWorkingDays()` so that public
 * holidays (in addition to weekends) are excluded. A request that straddles
 * a holiday should bill the employee fewer days than it spans calendar-wise.
 *
 * F-10 — balance check + overlap check + create are wrapped in a
 * Serializable transaction so two concurrent submissions cannot both pass
 * the balance check and both insert.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const orgConfigFindUnique = vi.fn();
const holidayFindMany = vi.fn();
const employeeFindFirst = vi.fn();
const leaveRequestAggregate = vi.fn();
const leaveRequestFindFirst = vi.fn();
const leaveRequestCreate = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    orgConfig: { findUnique: orgConfigFindUnique },
    holiday: { findMany: holidayFindMany },
    employee: { findFirst: employeeFindFirst },
    leaveRequest: {
      aggregate: leaveRequestAggregate,
      findFirst: leaveRequestFindFirst,
      create: leaveRequestCreate,
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: transaction,
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

function makeSession(): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role: "TEACHER",
    tenantId: "t1",
    employeeId: "emp-1",
    parentId: null,
    permissions: getSystemRolePermissions("TEACHER"),
    customRoleCode: null,
  };
}

async function mockSession(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Fixtures use April 2026 dates; "today" (Asia/Jakarta) is pinned just
  // before them so the past-start-date guard does not trip on non-sick types.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-01T03:00:00+07:00"));
  // Default OrgConfig: standard 5-day work week.
  orgConfigFindUnique.mockResolvedValue({
    workingDays: JSON.stringify(["MON", "TUE", "WED", "THU", "FRI"]),
  });
  holidayFindMany.mockResolvedValue([]);
  employeeFindFirst.mockResolvedValue({
    status: "ACTIVE",
    leaveBalanceAnnual: 12,
    leaveBalanceSick: 12,
  });
  leaveRequestAggregate.mockResolvedValue({ _sum: { days: 0 } });
  leaveRequestFindFirst.mockResolvedValue(null);
  leaveRequestCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "leave-1",
    ...data,
  }));

  // Default $transaction wires tx.* to the same spies so route code is
  // exercised end-to-end.
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      employee: { findFirst: employeeFindFirst },
      leaveRequest: {
        aggregate: leaveRequestAggregate,
        findFirst: leaveRequestFindFirst,
        create: leaveRequestCreate,
      },
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function postBody(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/leave/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("F-07 — leave POST holiday-aware day count", () => {
  it("counts working days only (skips weekends AND public holidays)", async () => {
    await mockSession(makeSession());
    // 2026-04-13 (Mon) through 2026-04-19 (Sun) — 5 weekdays + 2 weekend.
    // Mark Wed 2026-04-15 as a full-day public holiday → 4 working days.
    holidayFindMany.mockResolvedValueOnce([{ date: "2026-04-15", isHalfDay: false }]);

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-19",
        reason: "Keluarga",
      }) as never
    );

    expect(res.status).toBe(201);
    expect(leaveRequestCreate).toHaveBeenCalledOnce();
    const created = leaveRequestCreate.mock.calls[0][0].data;
    // 5 weekdays - 1 holiday = 4 working days.
    expect(created.days).toBe(4);
  });

  it("treats half-day holiday as 0.5 day", async () => {
    await mockSession(makeSession());
    holidayFindMany.mockResolvedValueOnce([{ date: "2026-04-15", isHalfDay: true }]);

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-19",
        reason: "Acara",
      }) as never
    );

    expect(res.status).toBe(201);
    const created = leaveRequestCreate.mock.calls[0][0].data;
    // 4 full + 0.5 half = 4.5
    expect(created.days).toBe(4.5);
  });

  it("returns 400 when the entire range is non-working (full-week holiday)", async () => {
    await mockSession(makeSession());
    holidayFindMany.mockResolvedValueOnce([
      { date: "2026-04-13", isHalfDay: false },
      { date: "2026-04-14", isHalfDay: false },
      { date: "2026-04-15", isHalfDay: false },
      { date: "2026-04-16", isHalfDay: false },
      { date: "2026-04-17", isHalfDay: false },
    ]);

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-17",
        reason: "Lebaran",
      }) as never
    );

    expect(res.status).toBe(400);
    expect(leaveRequestCreate).not.toHaveBeenCalled();
  });

  it("falls back to MON-FRI when OrgConfig is missing", async () => {
    await mockSession(makeSession());
    orgConfigFindUnique.mockResolvedValueOnce(null);
    // Mon-Fri range, no holidays.
    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-17",
        reason: "Test",
      }) as never
    );

    expect(res.status).toBe(201);
    const created = leaveRequestCreate.mock.calls[0][0].data;
    expect(created.days).toBe(5);
  });
});

describe("F-10 — leave POST serializable transaction", () => {
  it("wraps balance/overlap/create in a single $transaction with Serializable isolation", async () => {
    await mockSession(makeSession());

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-15",
        reason: "Test",
      }) as never
    );

    expect(res.status).toBe(201);
    expect(transaction).toHaveBeenCalledOnce();
    // Second arg is the transaction options object — verify Serializable.
    const txOptions = transaction.mock.calls[0][1];
    expect(txOptions).toMatchObject({ isolationLevel: "Serializable" });
  });

  it("aborts the create when the overlap check (inside tx) finds a conflict", async () => {
    // Simulates the race-loser of two concurrent submissions: the first
    // request committed, and the second sees the new row inside its
    // serializable read view → 400 OVERLAP, no create.
    await mockSession(makeSession());
    leaveRequestFindFirst.mockResolvedValueOnce({ id: "existing-leave" });

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-15",
        reason: "Concurrent",
      }) as never
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bertumpuk/);
    expect(leaveRequestCreate).not.toHaveBeenCalled();
  });

  it("aborts when balance is insufficient (caught inside tx, returns 422)", async () => {
    await mockSession(makeSession());
    employeeFindFirst.mockResolvedValueOnce({
      status: "ACTIVE",
      leaveBalanceAnnual: 1, // only 1 day left
      leaveBalanceSick: 12,
    });
    leaveRequestAggregate.mockResolvedValueOnce({ _sum: { days: 0 } });

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-17", // 5 working days
        reason: "Too many",
      }) as never
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/Sisa cuti tahunan 1 hari/);
    expect(leaveRequestCreate).not.toHaveBeenCalled();
  });

  it("maps a Serializable conflict (P2034) to a retryable 409, not a raw 500", async () => {
    // Postgres aborts the loser of two concurrent submissions with
    // serialization_failure; Prisma surfaces P2034.
    await mockSession(makeSession());
    transaction.mockRejectedValueOnce(
      Object.assign(new Error("could not serialize access"), { code: "P2034" })
    );

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-15",
        reason: "Race loser",
      }) as never
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/coba lagi/);
  });

  it("still rethrows unknown errors", async () => {
    await mockSession(makeSession());
    transaction.mockRejectedValueOnce(new Error("db down"));
    const { POST } = await import("../leave/requests/route");
    await expect(
      POST(
        postBody({
          leaveType: "ANNUAL",
          startDate: "2026-04-13",
          endDate: "2026-04-15",
          reason: "x",
        }) as never
      )
    ).rejects.toThrow("db down");
  });
});

describe("STR-5 — submit counts PENDING + APPROVED days against the balance", () => {
  it("queries APPROVED and PENDING days of the same leave type", async () => {
    await mockSession(makeSession());
    const { POST } = await import("../leave/requests/route");
    await POST(
      postBody({ leaveType: "SICK", startDate: "2026-04-13", endDate: "2026-04-14", reason: "Sakit" }) as never
    );
    const where = leaveRequestAggregate.mock.calls[0][0].where;
    expect(where).toMatchObject({
      employeeId: "emp-1",
      leaveType: "SICK",
      status: { in: ["APPROVED", "PENDING"] },
    });
  });

  it("rejects a third 10-day request when two are already pending against 12 days", async () => {
    await mockSession(makeSession());
    // 2 pending (or approved) requests worth 10 days between them leaves 2.
    leaveRequestAggregate.mockResolvedValueOnce({ _sum: { days: 10 } });

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({
        leaveType: "ANNUAL",
        startDate: "2026-04-13",
        endDate: "2026-04-17", // 5 working days
        reason: "Liburan",
      }) as never
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("Sisa cuti tahunan 2 hari (termasuk pengajuan yang menunggu persetujuan).");
    expect(leaveRequestCreate).not.toHaveBeenCalled();
  });

  it("allows a request that fits exactly in what is left after pending + approved", async () => {
    await mockSession(makeSession());
    leaveRequestAggregate.mockResolvedValueOnce({ _sum: { days: 7 } });

    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({ leaveType: "ANNUAL", startDate: "2026-04-13", endDate: "2026-04-17", reason: "Pas" }) as never
    );
    expect(res.status).toBe(201); // 12 - 7 = 5 remaining, request is 5
  });

  it("does not balance-gate PERMISSION / OTHER leave", async () => {
    await mockSession(makeSession());
    const { POST } = await import("../leave/requests/route");
    const res = await POST(
      postBody({ leaveType: "PERMISSION", startDate: "2026-04-13", endDate: "2026-04-17", reason: "Urusan" }) as never
    );
    expect(res.status).toBe(201);
    expect(leaveRequestAggregate).not.toHaveBeenCalled();
  });
});

describe("past start date", () => {
  async function submit(leaveType: string, startDate: string, endDate: string) {
    await mockSession(makeSession());
    const { POST } = await import("../leave/requests/route");
    return POST(postBody({ leaveType, startDate, endDate, reason: "Keperluan" }) as never);
  }

  it.each(["ANNUAL", "PERMISSION"])("rejects %s starting before today (Jakarta) with a startDate field error", async (type) => {
    // Today is 2026-04-01 in Jakarta; 2026-03-30 is a Monday in the past.
    const res = await submit(type, "2026-03-30", "2026-03-31");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Tanggal mulai tidak boleh sebelum hari ini.");
    expect(body.errors).toEqual([{ field: "startDate", message: "Tanggal mulai tidak boleh sebelum hari ini." }]);
    expect(leaveRequestCreate).not.toHaveBeenCalled();
  });

  it("allows sick leave to be filed retroactively", async () => {
    const res = await submit("SICK", "2026-03-30", "2026-03-31");
    expect(res.status).toBe(201);
  });

  it("allows annual leave starting today", async () => {
    const res = await submit("ANNUAL", "2026-04-01", "2026-04-02");
    expect(res.status).toBe(201);
  });

  it("uses the Jakarta calendar day, not UTC (00:30 WIB on the 2nd is still the 1st in UTC)", async () => {
    vi.setSystemTime(new Date("2026-04-02T00:30:00+07:00"));
    const res = await submit("ANNUAL", "2026-04-01", "2026-04-02");
    expect(res.status).toBe(400);
  });
});
