import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Invoice list sort (cycle 2026-10-20-payment-link-expiry-display, T6 / D6).
 * `paymentLinkExpiresAt` is a sortable key; invoices without a date go last in BOTH
 * directions, and every sort ends in an `id` tie-breaker so paging neither repeats nor
 * skips rows. Unknown keys are still rejected.
 */

const { getSessionMock, findManyMock, countMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("@/lib/db", () => ({
  prisma: { invoice: { findMany: findManyMock, count: countMock } },
}));
vi.mock("@/lib/payments/session", () => ({ createPaymentSessionForInvoice: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { GET } from "../invoices/route";

const list = (qs = "") => GET(new NextRequest(`http://localhost/api/invoices${qs}`));
const lastOrderBy = () => findManyMock.mock.calls.at(-1)![0].orderBy;

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({
    id: "u-1", email: "a@t.local", name: "Admin", role: "SUPER_ADMIN", tenantId: "t1",
    employeeId: null, parentId: null, permissions: [], customRoleCode: null,
  });
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
});

describe("GET /api/invoices sort", () => {
  it.each(["asc", "desc"] as const)("paymentLinkExpiresAt %s puts nulls last, then id", async (dir) => {
    const res = await list(`?sortBy=paymentLinkExpiresAt&sortOrder=${dir}`);
    expect(res.status).toBe(200);
    expect(lastOrderBy()).toEqual([
      { paymentLinkExpiresAt: { sort: dir, nulls: "last" } },
      { id: "asc" },
    ]);
  });

  it("keeps the page window and the sort together so pages do not overlap", async () => {
    await list("?sortBy=paymentLinkExpiresAt&sortOrder=asc&page=2&pageSize=10");
    const args = findManyMock.mock.calls.at(-1)![0];
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.orderBy.at(-1)).toEqual({ id: "asc" });
  });

  it("other keys get the id tie-breaker too; default stays createdAt desc", async () => {
    await list("");
    expect(lastOrderBy()).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
    await list("?sortBy=totalDue&sortOrder=asc");
    expect(lastOrderBy()).toEqual([{ totalDue: "asc" }, { id: "asc" }]);
  });

  it("rejects an unknown sort key", async () => {
    const res = await list("?sortBy=xenditPaymentUrl");
    expect(res.status).toBe(400);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
