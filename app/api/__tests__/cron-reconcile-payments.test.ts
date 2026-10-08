import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.CRON_SECRET = "test-cron-secret";

const { findManyMock, reconcileMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  reconcileMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { invoice: { findMany: findManyMock } },
}));

vi.mock("@/lib/payments/reconcile", () => ({
  reconcileInvoicePayment: reconcileMock,
}));

import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { POST } from "../cron/reconcile-payments/route";

function makeReq(opts: { authorization?: string; userAgent?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.authorization !== undefined) headers["authorization"] = opts.authorization;
  if (opts.userAgent !== undefined) headers["user-agent"] = opts.userAgent;
  return new Request("http://localhost:3000/api/cron/reconcile-payments", {
    method: "POST",
    headers,
  }) as never;
}

const authed = { authorization: "Bearer test-cron-secret", userAgent: "vercel-cron/1.0" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  findManyMock.mockResolvedValue([]);
  reconcileMock.mockResolvedValue({ code: "NO_CHANGE" });
});

describe("POST /api/cron/reconcile-payments — auth", () => {
  it("returns 500 when CRON_SECRET is unset, without touching the DB", async () => {
    delete process.env.CRON_SECRET;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeReq(authed));

    expect(res.status).toBe(500);
    expect(findManyMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns 401 on a wrong bearer token", async () => {
    const res = await POST(makeReq({ ...authed, authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the User-Agent is not vercel-cron/", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(makeReq({ ...authed, userAgent: "curl/8.0" }));
    expect(res.status).toBe(403);
    expect(findManyMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("POST /api/cron/reconcile-payments — sweep", () => {
  it("only considers outstanding invoices that already have a payment URL", async () => {
    await POST(makeReq(authed));

    const where = findManyMock.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: [...UNPAID_INVOICE_STATUSES] });
    // Guard against the typo regression: "PARTIAL" is not an InvoiceStatus, so
    // partially paid invoices were silently never re-checked with the gateway.
    expect(where.status.in).toContain("PARTIALLY_PAID");
    expect(where.status.in).not.toContain("PARTIAL");
    // No payment URL → no checkout was ever started → nothing for the gateway
    // to report, so polling it would burn a request to learn nothing.
    expect(where.xenditPaymentUrl).toEqual({ not: null });
  });

  it("prioritises the most-overdue invoice and caps the batch", async () => {
    await POST(makeReq(authed));

    const args = findManyMock.mock.calls[0][0];
    // dueDate is indexed on Invoice; Invoice has no updatedAt column.
    expect(args.orderBy).toEqual({ dueDate: "asc" });
    expect(args.take).toBe(200);
  });

  it("reconciles every candidate and tallies the outcomes", async () => {
    findManyMock.mockResolvedValue([{ id: "inv-1" }, { id: "inv-2" }, { id: "inv-3" }]);
    reconcileMock
      .mockResolvedValueOnce({ code: "UPDATED" })
      .mockResolvedValueOnce({ code: "NO_CHANGE" })
      .mockResolvedValueOnce({ code: "UPDATED" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(makeReq(authed));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledTimes(3);
    expect(body.scanned).toBe(3);
    expect(body.updated).toBe(2);
    expect(body.tally).toEqual({ UPDATED: 2, NO_CHANGE: 1 });
    expect(body.cappedAtLimit).toBe(false);
    // Credited payments the webhook never delivered are the whole point of
    // this route — they must be loud, not buried in a 200 body.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("webhook never delivered"),
      expect.objectContaining({ updated: 2 }),
    );
    warnSpy.mockRestore();
  });

  it("keeps sweeping when one invoice throws", async () => {
    findManyMock.mockResolvedValue([{ id: "inv-1" }, { id: "inv-2" }]);
    reconcileMock
      .mockRejectedValueOnce(new Error("gateway exploded"))
      .mockResolvedValueOnce({ code: "UPDATED" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(makeReq(authed));
    const body = await res.json();

    // The second invoice must still be credited — one gateway hiccup cannot
    // strand every later candidate until the next run.
    expect(res.status).toBe(200);
    expect(body.updated).toBe(1);
    expect(body.tally).toEqual({ GATEWAY_ERROR: 1, UPDATED: 1 });
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("flags cappedAtLimit so an operator can tell a backlog from a quiet hour", async () => {
    findManyMock.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({ id: `inv-${i}` })),
    );

    const res = await POST(makeReq(authed));
    const body = await res.json();

    expect(body.cappedAtLimit).toBe(true);
    expect(body.scanned).toBe(200);
  });

  it("does nothing and reports zero when there is no outstanding invoice", async () => {
    const res = await POST(makeReq(authed));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ scanned: 0, updated: 0, cappedAtLimit: false });
  });
});
