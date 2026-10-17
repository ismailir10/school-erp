import { describe, it, expect, vi, beforeEach } from "vitest";

const { paymentFindMany, paymentGroupBy } = vi.hoisted(() => ({
  paymentFindMany: vi.fn(),
  paymentGroupBy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { payment: { findMany: paymentFindMany, groupBy: paymentGroupBy } },
}));

import {
  isValidYmd,
  parseDateRange,
  getPaymentsLedger,
  resolveLedgerRequest,
  buildLedgerCsv,
  type LedgerRow,
} from "@/lib/finance/payments-ledger";

beforeEach(() => {
  vi.clearAllMocks();
  paymentGroupBy.mockResolvedValue([]);
});

describe("isValidYmd", () => {
  it("accepts a real date", () => {
    expect(isValidYmd("2026-06-13")).toBe(true);
  });
  it.each(["2026-6-13", "2026-13-01", "2026-02-31", "foo", "", "2026/06/13", "1999-06-13"])(
    "rejects %s",
    (v) => expect(isValidYmd(v)).toBe(false),
  );
});

describe("parseDateRange", () => {
  it("defaults blank ends to today", () => {
    expect(parseDateRange("", "", "2026-06-13")).toEqual({
      dateFrom: "2026-06-13",
      dateTo: "2026-06-13",
    });
  });
  it("accepts a valid explicit range", () => {
    expect(parseDateRange("2026-06-01", "2026-06-30", "2026-06-13")).toEqual({
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    });
  });
  it("rejects an inverted range", () => {
    expect(parseDateRange("2026-06-30", "2026-06-01", "2026-06-13")).toBeNull();
  });
  it("rejects junk input", () => {
    expect(parseDateRange("NaN", "2026-06-13", "2026-06-13")).toBeNull();
  });
});

describe("getPaymentsLedger", () => {
  const payment = (
    id: string,
    amount: number,
    method: string,
    studentName: string,
    invoiceNumber: string,
    reference: string | null = null,
  ) => ({
    id,
    paidAt: new Date("2026-06-13T03:00:00.000Z"),
    amount,
    method,
    reference,
    invoice: { id: `inv-${id}`, invoiceNumber, student: { name: studentName } },
  });

  it("labels a gateway payment with its stored channel, and an older one with the method", async () => {
    paymentFindMany.mockResolvedValue([
      { ...payment("p1", 500000, "DOKU", "Aisyah", "INV-1"), channelCode: "VIRTUAL_ACCOUNT_BCA" },
      payment("p2", 300000, "DOKU", "Budi", "INV-2"),
    ]);
    paymentGroupBy.mockResolvedValue([{ method: "DOKU", _sum: { amount: 800000 }, _count: { _all: 2 } }]);

    const { rows, summary } = await getPaymentsLedger("t1", "2026-06-13", "2026-06-13");

    expect(rows.map((r) => r.methodLabel)).toEqual(["Virtual Account BCA", "Virtual Account (DOKU)"]);
    // Totals still group by method, not by channel.
    expect(summary.byMethod).toHaveLength(1);
    expect(summary.byMethod[0]).toMatchObject({ method: "DOKU", count: 2 });
  });

  it("maps rows and computes per-method summary", async () => {
    paymentFindMany.mockResolvedValue([
      payment("p1", 500000, "CASH", "Aisyah", "INV-1"),
      payment("p2", 300000, "BANK_TRANSFER", "Budi", "INV-2", "TRX-9"),
      payment("p3", 200000, "CASH", "Citra", "INV-3"),
    ]);
    paymentGroupBy.mockResolvedValue([
      { method: "CASH", _sum: { amount: 700000 }, _count: { _all: 2 } },
      { method: "BANK_TRANSFER", _sum: { amount: 300000 }, _count: { _all: 1 } },
    ]);

    const { rows, summary } = await getPaymentsLedger("t1", "2026-06-13", "2026-06-13");

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: "p1",
      invoiceId: "inv-p1",
      amount: 500000,
      method: "CASH",
      methodLabel: "Tunai",
      invoiceNumber: "INV-1",
      studentName: "Aisyah",
    });
    expect(summary.totalAmount).toBe(1000000);
    expect(summary.totalCount).toBe(3);
    // CASH 700k (2) sorts before BANK_TRANSFER 300k (1)
    expect(summary.byMethod[0]).toMatchObject({ method: "CASH", amount: 700000, count: 2 });
    expect(summary.byMethod[1]).toMatchObject({
      method: "BANK_TRANSFER",
      methodLabel: "Transfer Bank",
      amount: 300000,
      count: 1,
    });
  });

  it("scopes the query to tenant, excludes REVERSED, filters by method + window", async () => {
    paymentFindMany.mockResolvedValue([]);
    await getPaymentsLedger("t1", "2026-06-13", "2026-06-13", "CASH");

    const arg = paymentFindMany.mock.calls[0][0];
    expect(arg.where.invoice).toEqual({ tenantId: "t1" });
    expect(arg.where.status).toEqual({ not: "REVERSED" });
    expect(arg.where.method).toBe("CASH");
    // 2026-06-13 WIB starts at 2026-06-12T17:00:00Z; exclusive end +24h.
    expect(arg.where.paidAt.gte.toISOString()).toBe("2026-06-12T17:00:00.000Z");
    expect(arg.where.paidAt.lt.toISOString()).toBe("2026-06-13T17:00:00.000Z");
  });

  it("applies search, pagination, and sort options", async () => {
    paymentFindMany.mockResolvedValue([]);
    await getPaymentsLedger("t1", "2026-06-13", "2026-06-13", undefined, {
      search: "Aisyah",
      skip: 20,
      take: 10,
      sortBy: "amount",
      sortOrder: "asc",
    });

    const arg = paymentFindMany.mock.calls[0][0];
    expect(arg.skip).toBe(20);
    expect(arg.take).toBe(10);
    expect(arg.orderBy).toEqual([{ amount: "asc" }, { id: "asc" }]);
    expect(arg.where.OR).toHaveLength(3);
  });

  it("omits the method filter when none given", async () => {
    paymentFindMany.mockResolvedValue([]);
    await getPaymentsLedger("t1", "2026-06-13", "2026-06-13");
    expect(paymentFindMany.mock.calls[0][0].where.method).toBeUndefined();
  });

  it("returns zero summary for an empty range", async () => {
    paymentFindMany.mockResolvedValue([]);
    const { rows, summary } = await getPaymentsLedger("t1", "2026-06-13", "2026-06-13");
    expect(rows).toEqual([]);
    expect(summary).toEqual({ totalAmount: 0, totalCount: 0, byMethod: [] });
  });
});

describe("buildLedgerCsv", () => {
  const row = (over: Partial<LedgerRow>): LedgerRow => ({
    id: "p1",
    invoiceId: "inv-1",
    paidAt: "2026-06-13T03:00:00.000Z",
    amount: 500000,
    method: "CASH",
    methodLabel: "Tunai",
    reference: null,
    invoiceNumber: "INV-1",
    studentName: "Aisyah",
    ...over,
  });

  it("emits header + CRLF + Jakarta datetime + empty reference cell", () => {
    const csv = buildLedgerCsv([row({})]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Tanggal,Siswa,No. Tagihan,Metode,Referensi,Jumlah");
    // 03:00 UTC = 10:00 WIB
    expect(lines[1]).toBe('"2026-06-13 10:00","Aisyah","INV-1","Tunai","",500000');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("neutralizes formula-injection in studentName and reference", () => {
    const csv = buildLedgerCsv([row({ studentName: "=cmd()", reference: "+TRX" })]);
    expect(csv).toContain('"\'=cmd()"');
    expect(csv).toContain('"\'+TRX"');
  });

  it("renders header-only for empty rows", () => {
    expect(buildLedgerCsv([])).toBe("Tanggal,Siswa,No. Tagihan,Metode,Referensi,Jumlah\r\n");
  });
});

describe("resolveLedgerRequest", () => {
  it("400-shapes an invalid range without querying", async () => {
    const r = await resolveLedgerRequest(
      "t1",
      new URLSearchParams({ dateFrom: "2026-06-30", dateTo: "2026-06-01" }),
      "2026-06-13",
    );
    expect(r).toEqual({ ok: false, error: "Rentang tanggal tidak valid" });
    expect(paymentFindMany).not.toHaveBeenCalled();
  });

  it("400-shapes an unknown method", async () => {
    const r = await resolveLedgerRequest(
      "t1",
      new URLSearchParams({ method: "BITCOIN" }),
      "2026-06-13",
    );
    expect(r).toEqual({ ok: false, error: "Metode pembayaran tidak valid" });
    expect(paymentFindMany).not.toHaveBeenCalled();
  });

  it("returns rows + summary + resolved range on the happy path", async () => {
    paymentFindMany.mockResolvedValue([]);
    const r = await resolveLedgerRequest("t1", new URLSearchParams(), "2026-06-13");
    expect(r).toMatchObject({ ok: true, dateFrom: "2026-06-13", dateTo: "2026-06-13" });
  });

  it("returns pagination metadata when requested", async () => {
    paymentFindMany.mockResolvedValue([]);
    paymentGroupBy.mockResolvedValue([
      { method: "CASH", _sum: { amount: 100000 }, _count: { _all: 21 } },
    ]);
    const r = await resolveLedgerRequest(
      "t1",
      new URLSearchParams({ page: "2", pageSize: "10" }),
      "2026-06-13",
      { paginate: true },
    );
    expect(r).toMatchObject({
      ok: true,
      pagination: { page: 2, pageSize: 10, total: 21, totalPages: 3 },
    });
  });

  it("rejects malformed pagination when requested", async () => {
    const r = await resolveLedgerRequest(
      "t1",
      new URLSearchParams({ page: "foo", pageSize: "bar" }),
      "2026-06-13",
      { paginate: true },
    );
    expect(r).toEqual({ ok: false, error: "Pagination tidak valid" });
    expect(paymentFindMany).not.toHaveBeenCalled();
  });

  it("rejects pagination that would create an unsafe offset", async () => {
    const r = await resolveLedgerRequest(
      "t1",
      new URLSearchParams({ page: String(Number.MAX_SAFE_INTEGER), pageSize: "100" }),
      "2026-06-13",
      { paginate: true },
    );
    expect(r).toEqual({ ok: false, error: "Pagination tidak valid" });
    expect(paymentFindMany).not.toHaveBeenCalled();
  });

  it("rejects invalid sort inputs", async () => {
    await expect(
      resolveLedgerRequest("t1", new URLSearchParams({ sortBy: "studentName" }), "2026-06-13"),
    ).resolves.toEqual({ ok: false, error: "Kolom urut tidak valid" });
    expect(paymentFindMany).not.toHaveBeenCalled();
  });
});
