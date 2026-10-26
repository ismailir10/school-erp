import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Invoice list Status filter, five questions (cycle 2026-10-20-payment-link-expiry-display,
 * T7 / D12). `GET /api/invoices?status=` takes a raw status or one of two derived values:
 * `UNPAID` ("Belum lunas") and `NEEDS_LINK` ("Perlu link"), plus `NEEDS_REVIEW` ("Perlu dicek",
 * cycle 2026-10-21-unrecorded-gateway-payments, T3). Pinned here: the where clause
 * each value builds, composition with search and sort, raw statuses still working, unknown
 * values answering 400, and that one "still owes money" rule serves the list, the summary
 * and the "Buat link baru" pick. The last part runs all three against one in-memory fixture
 * through a tiny where-evaluator, so "the numbers agree" is proved by rows, not by shape.
 */

const { getSessionMock, findManyMock, countMock, groupByMock, aggregateMock, ensureMock, eventFindManyMock, TOTAL_DUE_REF } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  eventFindManyMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  groupByMock: vi.fn(),
  aggregateMock: vi.fn(),
  ensureMock: vi.fn(),
  // stands in for Prisma's `prisma.invoice.fields.totalDue` field reference
  TOTAL_DUE_REF: { name: "totalDue" },
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findMany: findManyMock, count: countMock, groupBy: groupByMock, fields: { totalDue: TOTAL_DUE_REF } },
    payment: { aggregate: aggregateMock },
    webhookEvent: { findMany: eventFindManyMock },
  },
}));
vi.mock("@/lib/payments/ensure-link", () => ({ ensurePaymentLink: ensureMock }));
vi.mock("@/lib/payments/session", () => ({ createPaymentSessionForInvoice: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { GET as listGET } from "../invoices/route";
import { GET as statsGET } from "../invoices/stats/route";
import { createMissingPaymentLinks, LINK_START_DEADLINE_MS } from "@/lib/payments/missing-links";

const OWING_STATUSES = ["SENT", "PARTIALLY_PAID", "OVERDUE"];
const OWES = { totalPaid: { lt: TOTAL_DUE_REF } };

function session() {
  return {
    id: "u-1", email: "a@t.local", name: "Admin", role: "SUPER_ADMIN" as const, tenantId: "t1",
    employeeId: null, parentId: null, permissions: [] as string[], customRoleCode: null,
  };
}
const list = (qs = "") => listGET(new NextRequest(`http://localhost/api/invoices${qs}`));
const lastWhere = () => findManyMock.mock.calls.at(-1)![0].where;

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(session());
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
  groupByMock.mockResolvedValue([]);
  eventFindManyMock.mockResolvedValue([]);
  aggregateMock.mockResolvedValue({ _sum: { amount: null } });
  ensureMock.mockResolvedValue({ kind: "READY", paymentUrl: "https://x", created: true });
});

describe("GET /api/invoices?status= — derived values", () => {
  it("UNPAID (Belum lunas): billed status AND still owes", async () => {
    const res = await list("?status=UNPAID");
    expect(res.status).toBe(200);
    expect(lastWhere()).toEqual({
      tenantId: "t1",
      AND: [{ status: { in: OWING_STATUSES }, ...OWES }],
    });
    expect(countMock.mock.calls[0][0].where).toEqual(lastWhere());
  });

  it("NEEDS_LINK (Perlu link): Link Gagal, or owing with no link", async () => {
    const res = await list("?status=NEEDS_LINK");
    expect(res.status).toBe(200);
    expect(lastWhere()).toEqual({
      tenantId: "t1",
      AND: [{ OR: [{ status: "PENDING_PAYMENT_LINK" }, { status: { in: OWING_STATUSES }, ...OWES, xenditPaymentUrl: null }] }],
    });
  });

  it.each(["UNPAID", "NEEDS_LINK"])("%s composes with search (search keeps its own OR) and sort", async (status) => {
    await list(`?status=${status}&search=aisyah&sortBy=dueDate&sortOrder=asc`);
    const where = lastWhere();
    expect(where.AND).toHaveLength(1);
    expect(where.OR).toEqual([
      { invoiceNumber: { contains: "aisyah", mode: "insensitive" } },
      { periodLabel: { contains: "aisyah", mode: "insensitive" } },
      { student: { name: { contains: "aisyah", mode: "insensitive" } } },
    ]);
    expect(findManyMock.mock.calls[0][0].orderBy).toEqual([{ dueDate: "asc" }, { id: "asc" }]);
  });

  it("does not set a plain status when a derived value is used", async () => {
    await list("?status=NEEDS_LINK");
    expect(lastWhere()).not.toHaveProperty("status");
  });
});

describe("GET /api/invoices?status=NEEDS_REVIEW (Perlu dicek)", () => {
  it("reads the flagged invoice ids from the event log (ERROR + the three review codes)", async () => {
    eventFindManyMock.mockResolvedValue([{ invoiceId: "inv-a" }]);
    await list("?status=NEEDS_REVIEW");
    expect(eventFindManyMock).toHaveBeenCalledTimes(1);
    expect(eventFindManyMock.mock.calls[0][0].where).toEqual({
      status: "ERROR",
      errorMessage: { in: ["DUPLICATE_PAYMENT_AFTER_PAID", "PAID_ON_CANCELLED_INVOICE", "OVERPAYMENT_FLAGGED"] },
      invoiceId: { not: null },
    });
  });

  it("applies `id in ids` AND keeps the tenant scope, on both the page and the total", async () => {
    eventFindManyMock.mockResolvedValue([{ invoiceId: "inv-a" }, { invoiceId: "inv-b" }]);
    const res = await list("?status=NEEDS_REVIEW");
    expect(res.status).toBe(200);
    expect(lastWhere()).toEqual({ tenantId: "t1", AND: [{ id: { in: ["inv-a", "inv-b"] } }] });
    expect(lastWhere()).not.toHaveProperty("status");
    expect(countMock.mock.calls[0][0].where).toEqual(lastWhere());
  });

  it("composes with search (search keeps its own OR) and sort", async () => {
    eventFindManyMock.mockResolvedValue([{ invoiceId: "inv-a" }]);
    await list("?status=NEEDS_REVIEW&search=aisyah&sortBy=dueDate&sortOrder=asc");
    const where = lastWhere();
    expect(where.tenantId).toBe("t1");
    expect(where.AND).toEqual([{ id: { in: ["inv-a"] } }]);
    expect(where.OR).toHaveLength(3);
    expect(findManyMock.mock.calls[0][0].orderBy).toEqual([{ dueDate: "asc" }, { id: "asc" }]);
  });

  it("an empty event set builds `in: []`, which matches no invoice", async () => {
    eventFindManyMock.mockResolvedValue([]);
    const res = await list("?status=NEEDS_REVIEW");
    expect(res.status).toBe(200);
    expect(lastWhere()).toEqual({ tenantId: "t1", AND: [{ id: { in: [] } }] });
  });

  it("other statuses never read the event log", async () => {
    await list("?status=UNPAID");
    await list("?status=PAID");
    await list("");
    expect(eventFindManyMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/invoices?status= — raw statuses and all", () => {
  it.each(["DRAFT", "PENDING_PAYMENT_LINK", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"])(
    "raw %s still filters on the stored status alone",
    async (status) => {
      const res = await list(`?status=${status}`);
      expect(res.status).toBe(200);
      expect(lastWhere()).toEqual({ tenantId: "t1", status });
    },
  );

  it.each(["", "?status=", "?status=all", "?status=%20"])("%j means no status filter", async (qs) => {
    expect((await list(qs)).status).toBe(200);
    expect(lastWhere()).toEqual({ tenantId: "t1" });
  });
});

describe("GET /api/invoices?status= — unknown values", () => {
  it.each(["BOGUS", "unpaid", "needs_link", "needs_review", "constructor", "PAID,SENT", "Lunas"])("%s answers 400 and reads nothing", async (status) => {
    const res = await list(`?status=${encodeURIComponent(status)}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Status tagihan tidak dikenal");
    expect(findManyMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/invoices/stats — the Status filter's counts", () => {
  it("counts flagged invoices (`needsReview`) in the tenant, with the list's rule", async () => {
    eventFindManyMock.mockResolvedValue([{ invoiceId: "inv-a" }, { invoiceId: "inv-b" }]);
    countMock.mockResolvedValue(0);
    countMock.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    const body = await (await statsGET(new NextRequest("http://localhost/api/invoices/stats"))).json();
    expect(body.needsReview).toBe(2);
    expect(countMock.mock.calls[3][0].where).toEqual({ tenantId: "t1", id: { in: ["inv-a", "inv-b"] } });
  });

  it("counts owing invoices (`owing`) and owing-without-link with the shared rule", async () => {
    countMock.mockResolvedValueOnce(4).mockResolvedValueOnce(9);
    const body = await (await statsGET(new NextRequest("http://localhost/api/invoices/stats"))).json();
    expect(body.unpaidWithoutLink).toBe(4);
    expect(body.owing).toBe(9);
    expect(countMock.mock.calls[0][0].where).toEqual({
      tenantId: "t1", status: { in: OWING_STATUSES }, ...OWES, xenditPaymentUrl: null,
    });
    expect(countMock.mock.calls[1][0].where).toEqual({ tenantId: "t1", status: { in: OWING_STATUSES }, ...OWES });
  });
});

// --- One rule across list, summary and pick, proved on rows --------------------------------

type Row = {
  id: string; tenantId: string; status: string; totalDue: number; totalPaid: number;
  xenditPaymentUrl: string | null; paymentCheckedAt: Date | null; invoiceNumber: string;
  periodLabel: string; student: { name: string };
};
const row = (id: string, status: string, over: Partial<Row> = {}): Row => ({
  id, tenantId: "t1", status, totalDue: 100, totalPaid: 0, xenditPaymentUrl: "https://link",
  paymentCheckedAt: null, invoiceNumber: `INV-${id}`, periodLabel: "Okt 2026", student: { name: `Siswa ${id}` }, ...over,
});
const FIXTURE: Row[] = [
  row("sent-link", "SENT"),
  row("sent-nolink", "SENT", { xenditPaymentUrl: null }),
  row("part-nolink", "PARTIALLY_PAID", { xenditPaymentUrl: null, totalPaid: 40 }),
  row("over-nolink", "OVERDUE", { xenditPaymentUrl: null }),
  row("over-link", "OVERDUE"),
  // billed status, link missing, but nothing left to pay: not owing, so no link needed
  row("sent-settled-nolink", "SENT", { xenditPaymentUrl: null, totalPaid: 100 }),
  row("sent-settled-link", "SENT", { totalPaid: 100 }),
  row("failed-1", "PENDING_PAYMENT_LINK", { xenditPaymentUrl: null }),
  row("failed-2", "PENDING_PAYMENT_LINK", { xenditPaymentUrl: null }),
  row("paid", "PAID", { xenditPaymentUrl: null, totalPaid: 100 }),
  row("cancelled", "CANCELLED", { xenditPaymentUrl: null }),
  row("draft", "DRAFT", { xenditPaymentUrl: null }),
  row("other-tenant", "SENT", { tenantId: "t2", xenditPaymentUrl: null }),
];

// Minimal Prisma-where evaluator: equality, null, { in, lt, contains }, AND/OR, nested relation.
function matches(root: Row, where: Record<string, unknown>, obj: Record<string, unknown> = root as never): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Record<string, unknown>[]).every((w) => matches(root, w, obj));
    if (key === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(root, w, obj));
    const val = obj[key];
    if (cond === null) return val === null;
    if (typeof cond !== "object" || cond instanceof Date) return val === cond;
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(val);
    if ("lt" in c) {
      const bound = c.lt === TOTAL_DUE_REF ? root.totalDue : c.lt;
      return val instanceof Date || bound instanceof Date
        ? (val as Date) < (bound as Date)
        : (val as number) < (bound as number);
    }
    if ("contains" in c) return String(val).toLowerCase().includes(String(c.contains).toLowerCase());
    return matches(root, c, val as Record<string, unknown>); // nested relation, e.g. student
  });
}
const idsFor = (where: Record<string, unknown>) => FIXTURE.filter((r) => matches(r, where)).map((r) => r.id);

describe("one 'still owes money' rule across list, summary and the link pick", () => {
  beforeEach(() => {
    findManyMock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      FIXTURE.filter((r) => matches(r, where)).map((r) => ({ ...r, _count: { payments: 0 } })),
    );
    countMock.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => idsFor(where).length);
  });

  it("the evaluator itself tells apart owing from settled (guards the proof below)", () => {
    expect(idsFor({ tenantId: "t1", ...OWES, status: { in: OWING_STATUSES } })).not.toContain("sent-settled-link");
    expect(idsFor({ tenantId: "t1", ...OWES, status: { in: OWING_STATUSES } })).toContain("part-nolink");
  });

  it("'Belum lunas' lists exactly the billed invoices that still owe, and the summary's `owing` equals its total", async () => {
    const res = await (await list("?status=UNPAID")).json();
    const ids = res.data.map((r: Row) => r.id).sort();
    expect(ids).toEqual(["over-link", "over-nolink", "part-nolink", "sent-link", "sent-nolink"]);
    const stats = await (await statsGET(new NextRequest("http://localhost/api/invoices/stats"))).json();
    expect(stats.owing).toBe(res.pagination.total);
  });

  it("'Perlu link' lists Link Gagal plus owing-without-link, and its total is the two header buttons added together", async () => {
    const res = await (await list("?status=NEEDS_LINK")).json();
    const ids = res.data.map((r: Row) => r.id).sort();
    expect(ids).toEqual(["failed-1", "failed-2", "over-nolink", "part-nolink", "sent-nolink"]);
    // settled invoices with no link are not owed money, so they need no link
    expect(ids).not.toContain("sent-settled-nolink");

    groupByMock.mockResolvedValue([{ status: "PENDING_PAYMENT_LINK", _count: { _all: 2 }, _sum: { totalDue: 200, totalPaid: 0 } }]);
    const stats = await (await statsGET(new NextRequest("http://localhost/api/invoices/stats"))).json();
    expect(stats.unpaidWithoutLink).toBe(3); // "Buat link baru (3)"
    expect(stats.pendingPaymentLink).toBe(2); // "Coba lagi (2)"
    expect(stats.unpaidWithoutLink + stats.pendingPaymentLink).toBe(res.pagination.total);
  });

  it("'Perlu dicek' lists only this school's flagged invoices, and the summary's `needsReview` equals its total", async () => {
    // "other-tenant" and a fee id ("fee-1") are in the event log but must not surface
    eventFindManyMock.mockResolvedValue([
      { invoiceId: "paid" }, { invoiceId: "cancelled" }, { invoiceId: "other-tenant" }, { invoiceId: "fee-1" },
    ]);
    const res = await (await list("?status=NEEDS_REVIEW")).json();
    expect(res.data.map((r: Row) => r.id).sort()).toEqual(["cancelled", "paid"]);
    const stats = await (await statsGET(new NextRequest("http://localhost/api/invoices/stats"))).json();
    expect(stats.needsReview).toBe(2);
    expect(stats.needsReview).toBe(res.pagination.total);

    const none = await (await list("?status=NEEDS_REVIEW&search=sent-link")).json();
    expect(none.data).toEqual([]);
    const one = await (await list("?status=NEEDS_REVIEW&search=cancelled")).json();
    expect(one.data.map((r: Row) => r.id)).toEqual(["cancelled"]);
  });

  it("'Perlu link' with a search is the intersection", async () => {
    const res = await (await list("?status=NEEDS_LINK&search=over-nolink")).json();
    expect(res.data.map((r: Row) => r.id)).toEqual(["over-nolink"]);
    const none = await (await list("?status=NEEDS_LINK&search=paid")).json();
    expect(none.data).toEqual([]);
  });

  it("the 'Buat link baru' pick takes exactly the owing-without-link invoices the list shows", async () => {
    const owingNoLink = idsFor({ tenantId: "t1", ...OWES, status: { in: OWING_STATUSES }, xenditPaymentUrl: null });
    const fromList = (await (await list("?status=NEEDS_LINK")).json()).data
      .map((r: Row) => r.id)
      .filter((id: string) => !id.startsWith("failed"));
    findManyMock.mockClear();

    const result = await createMissingPaymentLinks({
      tenantId: "t1", batchSize: 25, startDeadline: Date.now() + LINK_START_DEADLINE_MS, origin: "https://app.example.com",
    });
    const picked = ensureMock.mock.calls.map((c) => c[0]).sort();
    expect(picked).toEqual([...owingNoLink].sort());
    expect(picked).toEqual([...fromList].sort());
    expect(result.created).toBe(3);
  });
});
