import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      groupBy: vi.fn(),
      count: vi.fn(),
      fields: { totalDue: "totalDue-ref" },
    },
    payment: {
      aggregate: vi.fn(),
    },
    webhookEvent: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

import { GET } from "../invoices/stats/route";

function makeReq() {
  return new Request("http://localhost:3000/api/invoices/stats");
}

function adminSession() {
  return {
    id: "u-1",
    email: "admin@test.com",
    name: "Admin",
    role: "SUPER_ADMIN" as const,
    tenantId: "tnt-1",
    employeeId: null,
    parentId: null,
    permissions: [] as string[],
    customRoleCode: null,
  };
}

describe("GET /api/invoices/stats", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as never);
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValue([] as never);
  });

  it("admin: returns expected shape with correct counts and totals across mixed statuses", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    // "Dibayar Sebagian" is a money-based count (see the dedicated describe below), not the status group.
    vi.mocked(prisma.invoice.count).mockImplementation(((args: { where: { AND?: unknown } }) =>
      Promise.resolve(args.where.AND && JSON.stringify(args.where.AND).includes('"gt":0') ? 1 : 0)) as never);

    // Shape mirrors Prisma's groupBy return: array of rows keyed by `by` cols.
    // 3 DRAFT (300k due, 0 paid) + 2 SENT (200k, 0) + 1 PARTIALLY_PAID (100k, 50k)
    // + 1 PAID (75k, 75k). totals: count=7, due=675k, paid=125k.
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([
      { status: "DRAFT", _count: { _all: 3 }, _sum: { totalDue: 300_000, totalPaid: 0 } },
      { status: "SENT", _count: { _all: 2 }, _sum: { totalDue: 200_000, totalPaid: 0 } },
      { status: "PARTIALLY_PAID", _count: { _all: 1 }, _sum: { totalDue: 100_000, totalPaid: 50_000 } },
      { status: "PAID", _count: { _all: 1 }, _sum: { totalDue: 75_000, totalPaid: 75_000 } },
    ] as never);

    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toEqual({
      total: 7,
      draft: 3,
      sent: 2,
      partiallyPaid: 1,
      paid: 1,
      overdue: 0,
      cancelled: 0,
      pendingPaymentLink: 0,
      unpaidWithoutLink: 0,
      owing: 0,
      needsReview: 0,
      totalDue: 675_000,
      totalPaid: 125_000,
      // SENT 200k + PARTIALLY_PAID (100k - 50k) = 250k; DRAFT/PAID excluded
      outstanding: 250_000,
      collectedThisMonth: 0,
    });

    // Single groupBy call scoped to tenant.
    expect(prisma.invoice.groupBy).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.invoice.groupBy).mock.calls[0][0]).toMatchObject({
      by: ["status"],
      where: { tenantId: "tnt-1" },
    });
  });

  it("empty tenant: all counts and totals are zero", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([] as never);

    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toEqual({
      total: 0,
      draft: 0,
      sent: 0,
      partiallyPaid: 0,
      paid: 0,
      overdue: 0,
      cancelled: 0,
      pendingPaymentLink: 0,
      unpaidWithoutLink: 0,
      owing: 0,
      needsReview: 0,
      totalDue: 0,
      totalPaid: 0,
      outstanding: 0,
      collectedThisMonth: 0,
    });
  });

  it("FIN-13: outstanding sums remaining of unpaid/partial/overdue; collectedThisMonth sums non-reversed payments in the Jakarta month", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([
      { status: "SENT", _count: { _all: 1 }, _sum: { totalDue: 500_000, totalPaid: 0 } },
      { status: "OVERDUE", _count: { _all: 2 }, _sum: { totalDue: 900_000, totalPaid: 100_000 } },
      { status: "PARTIALLY_PAID", _count: { _all: 1 }, _sum: { totalDue: 400_000, totalPaid: 150_000 } },
      { status: "CANCELLED", _count: { _all: 1 }, _sum: { totalDue: 123_456, totalPaid: 0 } },
      { status: "DRAFT", _count: { _all: 1 }, _sum: { totalDue: 700_000, totalPaid: 0 } },
    ] as never);
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: "1250000.00" } } as never);

    const body = await (await GET(makeReq() as never)).json();
    // (500k) + (900k - 100k) + (400k - 150k) = 1.550k
    expect(body.outstanding).toBe(1_550_000);
    expect(body.collectedThisMonth).toBe(1_250_000);

    const args = vi.mocked(prisma.payment.aggregate).mock.calls[0][0] as {
      where: { status: unknown; paidAt: { gte: Date; lt: Date }; invoice: unknown };
    };
    expect(args.where.status).toEqual({ not: "REVERSED" });
    expect(args.where.invoice).toEqual({ tenantId: "tnt-1" });
    expect(args.where.paidAt.gte.getTime()).toBeLessThan(args.where.paidAt.lt.getTime());
  });

  it("returns 403 when no session", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await GET(makeReq() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(prisma.invoice.groupBy).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin (TEACHER)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue({
      ...adminSession(),
      role: "TEACHER" as const,
    });

    const res = await GET(makeReq() as never);
    expect(res.status).toBe(403);
    expect(prisma.invoice.groupBy).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin (GUARDIAN)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue({
      ...adminSession(),
      role: "GUARDIAN" as const,
    });

    const res = await GET(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it("includes PENDING_PAYMENT_LINK count and surfaces it as pendingPaymentLink", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([
      { status: "SENT", _count: { _all: 1 }, _sum: { totalDue: 100_000, totalPaid: 0 } },
      { status: "PENDING_PAYMENT_LINK", _count: { _all: 2 }, _sum: { totalDue: 200_000, totalPaid: 0 } },
    ] as never);

    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.pendingPaymentLink).toBe(2);
    expect(body.sent).toBe(1);
    expect(body.total).toBe(3);
    expect(body.totalDue).toBe(300_000);
  });

  it("handles Prisma Decimal-shaped sums by coercing to Number", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    // Prisma returns Decimal objects in real life. Verify the route coerces
    // anything `Number()` accepts — a string-stringified Decimal is the
    // common shape over JSON boundaries.
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([
      {
        status: "PAID",
        _count: { _all: 1 },
        _sum: { totalDue: "150000.00" as never, totalPaid: "150000.00" as never },
      },
    ] as never);

    const res = await GET(makeReq() as never);
    const body = await res.json();
    expect(body.totalDue).toBe(150_000);
    expect(body.totalPaid).toBe(150_000);
    expect(body.paid).toBe(1);
  });
});

describe("GET /api/invoices/stats — unpaidWithoutLink", () => {
  it("counts the tenant's unpaid invoices that hold no payment link", async () => {
    const { prisma } = await import("@/lib/db");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as never);
    vi.mocked(prisma.invoice.count).mockResolvedValue(7 as never);

    const body = await (await GET(new Request("http://localhost/api/invoices/stats") as never)).json();

    expect(body.unpaidWithoutLink).toBe(7);
    expect(vi.mocked(prisma.invoice.count).mock.calls[0][0]).toEqual({
      where: {
        tenantId: "tnt-1",
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        totalPaid: { lt: "totalDue-ref" },
        xenditPaymentUrl: null,
      },
    });
  });
});

describe("GET /api/invoices/stats — needsReview", () => {
  it("counts the tenant's invoices that hold a flagged gateway payment, using the event-log ids", async () => {
    const { prisma } = await import("@/lib/db");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as never);
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValue([{ invoiceId: "inv-a" }, { invoiceId: "inv-b" }] as never);
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.invoice.count)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(2 as never);

    const body = await (await GET(new Request("http://localhost/api/invoices/stats") as never)).json();

    expect(body.needsReview).toBe(2);
    expect(vi.mocked(prisma.invoice.count).mock.calls[3][0]).toEqual({
      where: { tenantId: "tnt-1", id: { in: ["inv-a", "inv-b"] } },
    });
  });

  it("is 0 without a count query when nothing is flagged", async () => {
    const { prisma } = await import("@/lib/db");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as never);
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValue([] as never);

    const body = await (await GET(new Request("http://localhost/api/invoices/stats") as never)).json();

    expect(body.needsReview).toBe(0);
    expect(vi.mocked(prisma.invoice.count)).toHaveBeenCalledTimes(3);
  });
});

describe("GET /api/invoices/stats — partiallyPaid", () => {
  it("counts owing invoices that received money by amount, so a partial payment stored as OVERDUE still counts", async () => {
    const { prisma } = await import("@/lib/db");
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    // No row is stored as PARTIALLY_PAID: every partial payment here is past due, so OVERDUE.
    vi.mocked(prisma.invoice.groupBy).mockResolvedValue([
      { status: "OVERDUE", _count: { _all: 11 }, _sum: { totalDue: 1_100_000, totalPaid: 300_000 } },
    ] as never);
    vi.mocked(prisma.payment.aggregate).mockResolvedValue({ _sum: { amount: null } } as never);
    vi.mocked(prisma.webhookEvent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.invoice.count).mockReset();
    vi.mocked(prisma.invoice.count)
      .mockResolvedValueOnce(0 as never) // unpaidWithoutLink
      .mockResolvedValueOnce(11 as never) // owing
      .mockResolvedValueOnce(4 as never); // partiallyPaid

    const body = await (await GET(new Request("http://localhost/api/invoices/stats") as never)).json();

    expect(body.partiallyPaid).toBe(4);
    expect(body.overdue).toBe(11);
    expect(vi.mocked(prisma.invoice.count).mock.calls[2][0]).toEqual({
      where: {
        tenantId: "tnt-1",
        AND: [
          {
            status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
            totalPaid: { lt: "totalDue-ref" },
          },
          { totalPaid: { gt: 0 } },
        ],
      },
    });
  });
});
