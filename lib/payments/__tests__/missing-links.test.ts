import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * createMissingPaymentLinks — the selection + deadline + ensure loop shared by the admin's
 * "Buat link baru (N)" and the nightly finance-maintenance heal (cycle
 * 2026-10-17-payment-link-reminders, T3). `ensurePaymentLink` is mocked: its one-link-only
 * guarantee lives in ensure-link.test.ts. Pinned here: the where clause and ordering, tenant
 * scoping on and off, the owing-money guard, the per-invoice tenant, the start deadline and
 * the tallies.
 */

const { findManyMock, countMock, ensureMock, FIELD_REF } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  ensureMock: vi.fn(),
  // stands in for Prisma's `prisma.invoice.fields.totalDue` field reference
  FIELD_REF: { name: "totalDue" },
}));

vi.mock("@/lib/db", () => ({ prisma: { invoice: { findMany: findManyMock, count: countMock, fields: { totalDue: FIELD_REF } } } }));
vi.mock("@/lib/payments/ensure-link", () => ({ ensurePaymentLink: ensureMock }));

import { createMissingPaymentLinks, LINK_START_DEADLINE_MS } from "../missing-links";

const rows = (n: number, tenantId = "t1") =>
  Array.from({ length: n }, (_, i) => ({ id: `inv-${i}`, tenantId }));
const ready = (created: boolean) => ({ kind: "READY", paymentUrl: "https://checkout.example/x", created });
const run = (over: Partial<Parameters<typeof createMissingPaymentLinks>[0]> = {}) =>
  createMissingPaymentLinks({
    batchSize: 25,
    startDeadline: Date.now() + LINK_START_DEADLINE_MS,
    origin: "https://app.example.com",
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
  ensureMock.mockResolvedValue(ready(true));
});

describe("start budget", () => {
  it("leaves a creation's whole retry budget inside a 60 s function: 22 s", () => {
    expect(LINK_START_DEADLINE_MS).toBe(22_000);
  });
});

describe("candidate selection", () => {
  it("picks unpaid invoices with no link that nobody is creating right now, untouched first, capped at the batch size", async () => {
    await run({ tenantId: "t1", batchSize: 7 });
    const args = findManyMock.mock.calls[0][0];
    expect(args.take).toBe(7);
    expect(args.where).toMatchObject({
      tenantId: "t1",
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      xenditPaymentUrl: null,
    });
    expect(args.where.OR[0]).toEqual({ paymentCheckedAt: null });
    // a claim is a stamp in the future, so "not being created" is a stamp in the past
    expect(args.where.OR[1].paymentCheckedAt.lt).toBeInstanceOf(Date);
    expect(args.orderBy).toEqual([{ paymentCheckedAt: { sort: "asc", nulls: "first" } }, { dueDate: "asc" }]);
    expect(args.select).toEqual({ id: true, tenantId: true });
  });

  it("only picks invoices that still owe money, so settled ones cannot clog the head of the order", async () => {
    await run({ tenantId: "t1" });
    // a column-to-column comparison (totalPaid < totalDue) done by the database
    expect(findManyMock.mock.calls[0][0].where.totalPaid).toEqual({ lt: FIELD_REF });
    expect(countMock.mock.calls[0][0].where.totalPaid).toEqual({ lt: FIELD_REF });
  });

  it("is scoped to one school when given a tenant", async () => {
    await run({ tenantId: "t9" });
    expect(findManyMock.mock.calls[0][0].where.tenantId).toBe("t9");
    expect(countMock.mock.calls[0][0].where.tenantId).toBe("t9");
  });

  it("spans every school when no tenant is given", async () => {
    await run({});
    expect(findManyMock.mock.calls[0][0].where).not.toHaveProperty("tenantId");
    expect(countMock.mock.calls[0][0].where).not.toHaveProperty("tenantId");
  });

  it("counts what is left with the same filter", async () => {
    await run({ tenantId: "t1" });
    const [picked, left] = [findManyMock.mock.calls[0][0].where, countMock.mock.calls[0][0].where];
    expect({ ...left, OR: undefined }).toEqual({ ...picked, OR: undefined });
  });
});

describe("running the batch", () => {
  it("makes each link for the invoice's own school, so an all-school run crosses tenants safely", async () => {
    findManyMock.mockResolvedValue([
      { id: "a", tenantId: "t1" },
      { id: "b", tenantId: "t2" },
    ]);
    countMock.mockResolvedValue(5);
    const result = await run({});

    expect(ensureMock).toHaveBeenCalledWith("a", "t1", "https://app.example.com", { waitForWinnerMs: 0 });
    expect(ensureMock).toHaveBeenCalledWith("b", "t2", "https://app.example.com", { waitForWinnerMs: 0 });
    expect(result).toEqual({ created: 2, failed: 0, skipped: 0, remaining: 5 });
  });

  it("passes the session's school on when one is given, so the helper re-checks the row against it", async () => {
    findManyMock.mockResolvedValue([{ id: "a", tenantId: "row-tenant" }]);
    await run({ tenantId: "t1" });
    expect(ensureMock).toHaveBeenCalledWith("a", "t1", "https://app.example.com", { waitForWinnerMs: 0 });
  });

  it("tallies created, already-made, failed and not-payable apart", async () => {
    findManyMock.mockResolvedValue(rows(4));
    ensureMock
      .mockResolvedValueOnce(ready(true))
      .mockResolvedValueOnce(ready(false))
      .mockResolvedValueOnce({ kind: "FAILED" })
      .mockResolvedValueOnce({ kind: "NOT_PAYABLE" });
    expect(await run()).toEqual({ created: 1, failed: 1, skipped: 1, remaining: 0 });
  });

  it("skips what has not started once the deadline has passed", async () => {
    findManyMock.mockResolvedValue(rows(3));
    countMock.mockResolvedValue(3);
    const result = await run({ startDeadline: Date.now() - 1 });
    expect(ensureMock).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, failed: 0, skipped: 3, remaining: 3 });
  });

  it("stops starting new links once the deadline passes mid-batch", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t0 = new Date("2026-10-17T01:00:00Z").getTime();
      vi.setSystemTime(t0);
      findManyMock.mockResolvedValue(rows(8));
      ensureMock.mockImplementation(async () => {
        await Promise.resolve(); // the other four of the first five have started by now
        vi.setSystemTime(t0 + 50_000);
        return ready(true);
      });
      const result = await run({ startDeadline: t0 + LINK_START_DEADLINE_MS });
      expect(ensureMock).toHaveBeenCalledTimes(5);
      expect(result).toMatchObject({ created: 5, skipped: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("nothing to do is a clean zero", async () => {
    expect(await run()).toEqual({ created: 0, failed: 0, skipped: 0, remaining: 0 });
    expect(ensureMock).not.toHaveBeenCalled();
  });
});
