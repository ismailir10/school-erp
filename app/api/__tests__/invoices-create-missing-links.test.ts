import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

/**
 * POST /api/invoices/create-missing-links — the admin "Buat link baru (N)" batch
 * (cycle 2026-10-17-payment-link-on-demand, T3). `ensurePaymentLink` is mocked: its
 * one-link-only guarantee is covered in `lib/payments/__tests__/ensure-link.test.ts`.
 * Pinned here: who may call it, which invoices it picks, the 25-per-call cap, that one
 * failing invoice does not stop the rest, and what it reports.
 */

const { getSessionMock, findManyMock, countMock, ensureMock, rateLimitMock, revalidateMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  ensureMock: vi.fn(),
  rateLimitMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("@/lib/db", () => ({ prisma: { invoice: { findMany: findManyMock, count: countMock } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("@/lib/payments/ensure-link", () => ({ ensurePaymentLink: ensureMock }));
vi.mock("next/cache", () => ({ revalidateTag: revalidateMock }));

import { POST } from "../invoices/create-missing-links/route";

function session(permissions: string[] = ["invoices.create"], role: SessionUser["role"] = "SCHOOL_ADMIN"): SessionUser {
  return { id: "u1", email: "a@t.local", name: "Admin", role, tenantId: "t1", employeeId: null, parentId: null, permissions, customRoleCode: null };
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `inv-${i}` }));
const req = () => new Request("http://localhost:3000/api/invoices/create-missing-links", { method: "POST" });
const ready = (created: boolean) => ({ kind: "READY", paymentUrl: "https://checkout.doku.com/x", created });

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(session());
  rateLimitMock.mockReturnValue({ success: true, remaining: 5 });
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
  ensureMock.mockResolvedValue(ready(true));
});

describe("auth", () => {
  it("403 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await POST(req())).status).toBe(403);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("403 for a non-admin role", async () => {
    getSessionMock.mockResolvedValue(session(["invoices.create"], "TEACHER"));
    expect((await POST(req())).status).toBe(403);
  });

  it("403 without invoices.create (payments.record alone is not enough)", async () => {
    getSessionMock.mockResolvedValue(session(["payments.record"]));
    expect((await POST(req())).status).toBe(403);
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("429 before any gateway work when pressed too often", async () => {
    rateLimitMock.mockReturnValue({ success: false, remaining: 0 });
    expect((await POST(req())).status).toBe(429);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("candidate selection", () => {
  it("picks the tenant's unpaid invoices with no link, untouched first, capped at 25", async () => {
    await POST(req());
    const args = findManyMock.mock.calls[0][0];
    expect(args.take).toBe(25);
    expect(args.where).toMatchObject({
      tenantId: "t1",
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      xenditPaymentUrl: null,
    });
    expect(args.where.OR[0]).toEqual({ paymentCheckedAt: null });
    // "not being created right now": a claim is a stamp in the future
    expect(args.where.OR[1].paymentCheckedAt.lt).toBeInstanceOf(Date);
    expect(args.orderBy[0]).toEqual({ paymentCheckedAt: { sort: "asc", nulls: "first" } });
  });

  it("counts what is left with the same filter", async () => {
    await POST(req());
    const [picked, left] = [findManyMock.mock.calls[0][0].where, countMock.mock.calls[0][0].where];
    expect({ ...left, OR: undefined }).toEqual({ ...picked, OR: undefined });
    expect(left.OR[1].paymentCheckedAt.lt).toBeInstanceOf(Date);
  });
});

describe("running the batch", () => {
  it("makes a link for each candidate through the one-link-only helper, for this school and origin", async () => {
    findManyMock.mockResolvedValue(ids(3));
    countMock.mockResolvedValue(40);
    const body = await (await POST(req())).json();

    expect(ensureMock).toHaveBeenCalledTimes(3);
    expect(ensureMock).toHaveBeenCalledWith("inv-0", "t1", "http://localhost:3000", { waitForWinnerMs: 0 });
    expect(body).toEqual({ created: 3, failed: 0, skipped: 0, remaining: 40 });
  });

  it("an invoice that already got its link from someone else is not counted as created", async () => {
    findManyMock.mockResolvedValue(ids(2));
    ensureMock.mockResolvedValueOnce(ready(true)).mockResolvedValueOnce(ready(false));
    expect((await (await POST(req())).json()).created).toBe(1);
  });

  it("one failing invoice does not stop the rest, and is counted as failed", async () => {
    findManyMock.mockResolvedValue(ids(3));
    ensureMock.mockResolvedValueOnce(ready(true)).mockResolvedValueOnce({ kind: "FAILED" }).mockResolvedValueOnce(ready(true));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 2, failed: 1 });
  });

  it("an invoice that stopped being payable meanwhile is skipped, not failed", async () => {
    findManyMock.mockResolvedValue(ids(1));
    ensureMock.mockResolvedValue({ kind: "NOT_PAYABLE" });
    expect(await (await POST(req())).json()).toMatchObject({ created: 0, failed: 0, skipped: 1 });
  });

  it("clears the parent-facing caches only when a link was actually made", async () => {
    findManyMock.mockResolvedValue(ids(1));
    ensureMock.mockResolvedValue({ kind: "FAILED" });
    await POST(req());
    expect(revalidateMock).not.toHaveBeenCalled();

    ensureMock.mockResolvedValue(ready(true));
    await POST(req());
    expect(revalidateMock).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
  });

  it("stops starting new links once the deadline passes and leaves the rest for the next press", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
      findManyMock.mockResolvedValue(ids(8));
      ensureMock.mockImplementation(async () => {
        await Promise.resolve(); // the other four of the first five have started by now
        vi.setSystemTime(new Date("2026-10-17T10:00:50Z"));
        return ready(true);
      });
      countMock.mockResolvedValue(3);

      const body = await (await POST(req())).json();

      expect(ensureMock).toHaveBeenCalledTimes(5);
      expect(body).toMatchObject({ created: 5, skipped: 3, remaining: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("nothing to do is a clean zero", async () => {
    expect(await (await POST(req())).json()).toEqual({ created: 0, failed: 0, skipped: 0, remaining: 0 });
    expect(ensureMock).not.toHaveBeenCalled();
  });
});
