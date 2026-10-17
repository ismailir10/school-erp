import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

/**
 * POST /api/invoices/refresh-payments — the admin "Cek semua belum lunas" batch
 * (cycle 2026-10-17-expired-link-overdue, T6). The reconcile itself is mocked:
 * its transitions are covered by the reconcile and processor suites. What is
 * pinned here is who may call it, which invoices it picks, the 50-per-call cap,
 * that one failing invoice does not stop the rest, and what it reports.
 */

const { getSessionMock, findManyMock, countMock, reconcileMock, rateLimitMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  reconcileMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("@/lib/db", () => ({ prisma: { invoice: { findMany: findManyMock, count: countMock } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("@/lib/payments/reconcile", () => ({ reconcileInvoicePayment: reconcileMock }));

import { POST } from "../invoices/refresh-payments/route";

function session(permissions: string[] = ["payments.record"], role: SessionUser["role"] = "SCHOOL_ADMIN"): SessionUser {
  return {
    id: "u1",
    email: "admin@test.local",
    name: "Admin",
    role,
    tenantId: "t1",
    employeeId: null,
    parentId: null,
    permissions,
    customRoleCode: null,
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `inv-${i}` }));

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(session());
  rateLimitMock.mockReturnValue({ success: true, remaining: 5 });
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
  reconcileMock.mockResolvedValue({ code: "NO_CHANGE" });
});

describe("auth", () => {
  it("403 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await POST()).status).toBe(403);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("403 for a non-admin role", async () => {
    getSessionMock.mockResolvedValue(session(["payments.record"], "TEACHER"));
    expect((await POST()).status).toBe(403);
  });

  it("403 without payments.record", async () => {
    getSessionMock.mockResolvedValue(session([]));
    expect((await POST()).status).toBe(403);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("429 when the admin is polling too often, before any gateway call", async () => {
    rateLimitMock.mockReturnValue({ success: false, remaining: 0 });
    expect((await POST()).status).toBe(429);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("candidate selection", () => {
  it("picks the tenant's unpaid invoices with a link, least recently checked first, skipping recent checks, capped at 50", async () => {
    await POST();

    const args = findManyMock.mock.calls[0][0];
    expect(args.take).toBe(50);
    expect(args.where).toMatchObject({
      tenantId: "t1",
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      xenditPaymentUrl: { not: null },
    });
    // never-checked or checked before the 10-minute cutoff
    const [never, old] = args.where.OR;
    expect(never).toEqual({ paymentCheckedAt: null });
    expect(old.paymentCheckedAt.lt).toBeInstanceOf(Date);
    expect(Date.now() - old.paymentCheckedAt.lt.getTime()).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(args.orderBy[0]).toEqual({ paymentCheckedAt: { sort: "asc", nulls: "first" } });
  });

  it("counts what is left with the same filter", async () => {
    await POST();
    expect(countMock.mock.calls[0][0].where).toEqual(findManyMock.mock.calls[0][0].where);
  });
});

describe("running the batch", () => {
  it("reconciles every candidate and reports checked, updated and what remains", async () => {
    findManyMock.mockResolvedValue(ids(3));
    reconcileMock
      .mockResolvedValueOnce({ code: "UPDATED" })
      .mockResolvedValueOnce({ code: "NO_CHANGE" })
      .mockResolvedValueOnce({ code: "UPDATED" });
    countMock.mockResolvedValue(120);

    const body = await (await POST()).json();

    expect(reconcileMock).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ checked: 3, updated: 2, failed: 0, remaining: 120 });
    expect(body.tally).toEqual({ UPDATED: 2, NO_CHANGE: 1 });
  });

  it("one invoice throwing does not stop the rest, and is counted as failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    findManyMock.mockResolvedValue(ids(3));
    reconcileMock
      .mockResolvedValueOnce({ code: "NO_CHANGE" })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ code: "UPDATED" });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ checked: 3, updated: 1, failed: 1 });
  });

  it("a gateway error code from the reconcile counts as failed too", async () => {
    findManyMock.mockResolvedValue(ids(2));
    reconcileMock.mockResolvedValue({ code: "GATEWAY_ERROR" });
    expect((await (await POST()).json()).failed).toBe(2);
  });

  it("claims each invoice atomically, so a racing second press cannot poll it twice", async () => {
    findManyMock.mockResolvedValue(ids(2));
    await POST();
    for (const call of reconcileMock.mock.calls) {
      expect(call[1]).toEqual({ minIntervalMs: 10 * 60_000 });
    }
  });

  it("stops starting polls once the deadline passes and leaves the rest for the next press", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
      findManyMock.mockResolvedValue(ids(8));
      // The first batch of five is already running when the clock jumps past the deadline.
      reconcileMock.mockImplementation(async () => {
        await Promise.resolve(); // the other four of the first five have started by now
        vi.setSystemTime(new Date("2026-10-17T10:00:50Z"));
        return { code: "NO_CHANGE" };
      });
      countMock.mockResolvedValue(3);

      const body = await (await POST()).json();

      expect(reconcileMock).toHaveBeenCalledTimes(5);
      expect(body).toMatchObject({ checked: 5, remaining: 3 });
      expect(body.tally.SKIPPED).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("nothing to check is a clean zero, not an error", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ checked: 0, updated: 0, failed: 0, remaining: 0 });
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});
