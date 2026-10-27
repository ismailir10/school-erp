/**
 * "Catat SPP di muka": POST /api/invoices/spp-prepay/preview and POST /api/invoices/spp-prepay
 * (docs/cycles/2026-10-27-paid-invoice-spp-prepay.md, T5).
 *
 * The context loader is stubbed so each case controls exactly what the planner
 * sees; the planner, the fingerprint and the route are real. `recordPaymentInTx`
 * is a spy (its own rules are covered in lib/finance/__tests__/record-payment.test.ts),
 * so the all-or-nothing rollback itself is a Postgres property, verified against
 * a real database outside this suite. Here: a PaymentError propagates to the
 * mapped status and nothing after it runs.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    payment: { findFirst: vi.fn() },
    invoice: { create: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(),
    recordPayment: vi.fn(),
    reserve: vi.fn(),
    load: vi.fn(),
    recordAudit: vi.fn(),
    revalidateTag: vi.fn(),
    scheduleRelink: vi.fn(),
    createPaymentSession: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/finance/record-payment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/finance/record-payment")>();
  return { ...actual, recordPaymentInTx: mocks.recordPayment };
});
vi.mock("@/lib/finance/invoice-numbers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/finance/invoice-numbers")>();
  return { ...actual, reserveInvoiceNumbers: mocks.reserve };
});
vi.mock("@/lib/finance/spp-prepay-load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/finance/spp-prepay-load")>();
  return { ...actual, loadSppPrepayContext: mocks.load };
});
// Neither feature may touch the gateway: both are spies that must stay untouched.
vi.mock("@/lib/payments/ensure-link", () => ({
  scheduleRelink: mocks.scheduleRelink,
  staleLinkCleared: () => ({}),
}));
vi.mock("@/lib/payments/session", () => ({ createPaymentSessionForInvoice: mocks.createPaymentSession }));

import { POST as preview } from "../invoices/spp-prepay/preview/route";
import { POST as confirm } from "../invoices/spp-prepay/route";
import { getSession } from "@/lib/auth";
import { PaymentError } from "@/lib/finance/record-payment";
import { fingerprintPlan, planForContext, type SppPrepayContext } from "@/lib/finance/spp-prepay-load";
import type { MonthPrice, PlanInvoice } from "@/lib/finance/spp-prepay-plan";

const D = (v: string | number) => new Prisma.Decimal(v);

const ADMIN = {
  id: "u-1",
  email: "admin@test.local",
  name: "Admin",
  role: "SCHOOL_ADMIN",
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: ["invoices.create", "payments.record"] as string[],
  customRoleCode: null,
};

const KEY = "0b8f6e2e-3f6c-4d2b-9f0a-2f6f5f1a7c11";

// "Today" for these tests is 27 Oktober 2026, so a paid date of 20 Oktober is back-dated.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T05:00:00Z"));
});
afterAll(() => vi.useRealTimers());

function req(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const callPreview = (body: unknown) => preview(req("/api/invoices/spp-prepay/preview", body) as never);
const callConfirm = (body: unknown) => confirm(req("/api/invoices/spp-prepay", body) as never);

function priceOf(amount = 500000): MonthPrice {
  const a = D(amount);
  return {
    lines: [
      {
        feeComponentId: "fc-spp",
        labelSnapshot: "SPP",
        amount: a,
        adjustmentAmount: D(0),
        adjustmentNote: null,
        finalAmount: a,
      },
    ],
    total: a,
  };
}

function inv(over: Partial<PlanInvoice> & { id: string; periodLabel: string }): PlanInvoice {
  return {
    status: "SENT",
    totalDue: D(500000),
    totalPaid: D(0),
    hasMonthlyLine: true,
    hasLink: false,
    paymentLinkExpiresAt: null,
    ...over,
  };
}

// September (none), Oktober (paid), November (part paid, has a link), Desember (none).
const INVOICES = [
  inv({ id: "i-okt", periodLabel: "Oktober 2026", status: "PAID", totalPaid: D(500000) }),
  inv({
    id: "i-nov",
    periodLabel: "November 2026",
    status: "PARTIALLY_PAID",
    totalPaid: D(200000),
    hasLink: true,
    paymentLinkExpiresAt: new Date("2026-11-05T10:00:00Z"),
  }),
];

function makeCtx(invoices: PlanInvoice[] = INVOICES, over: Partial<SppPrepayContext> = {}): SppPrepayContext {
  return {
    ok: true,
    student: { id: "s-1", name: "Budi" },
    academicYear: { id: "ay-1", name: "2026/2027", from: "2026-07", to: "2027-06" },
    range: { from: "2026-09", to: "2026-12" },
    rangeYm: { from: { year: 2026, month: 9 }, to: { year: 2026, month: 12 } },
    program: "TKIT",
    noProgram: false,
    parentId: "par-1",
    invoices,
    firstInvoicedMonth: { year: 2026, month: 10 },
    priceFor: () => priceOf(),
    ...over,
  };
}

const fingerprintOf = (ctx: SppPrepayContext) => fingerprintPlan(planForContext(ctx), ctx.invoices);

function confirmBody(ctx: SppPrepayContext, over: Record<string, unknown> = {}) {
  return {
    studentId: "s-1",
    from: ctx.range.from,
    to: ctx.range.to,
    method: "CASH",
    paidAt: "2026-10-27",
    idempotencyKey: KEY,
    fingerprint: fingerprintOf(ctx),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.$executeRaw.mockReset().mockResolvedValue(1);
  mocks.tx.payment.findFirst.mockReset().mockResolvedValue(null);
  let n = 0;
  mocks.tx.invoice.create.mockReset().mockImplementation(async () => ({ id: `new-${++n}` }));
  mocks.transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));
  mocks.recordPayment.mockReset().mockResolvedValue({
    payment: { id: "pay-1" },
    replayed: false,
    relink: false,
    invoiceStatus: "PAID",
    totalPaid: D(0),
  });
  mocks.reserve.mockReset().mockImplementation(async (_tx: unknown, _tenant: string, count: number) =>
    Array.from({ length: count }, (_, i) => `INV-2026-${String(101 + i).padStart(4, "0")}`),
  );
  mocks.load.mockReset();
  vi.mocked(getSession).mockResolvedValue(ADMIN as never);
});

// ───────────────────────────── preview ─────────────────────────────

describe("POST /api/invoices/spp-prepay/preview", () => {
  it("returns the month table, the total, the issues and a fingerprint, and writes nothing", async () => {
    const ctx = makeCtx();
    mocks.load.mockResolvedValue(ctx);

    const res = await callPreview({ studentId: "s-1", from: "2026-09", to: "2026-12" });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "t-1",
      studentId: "s-1",
      from: "2026-09",
      to: "2026-12",
    });
    expect(body.student).toEqual({ id: "s-1", name: "Budi" });
    expect(body.academicYear).toEqual({ id: "ay-1", name: "2026/2027", from: "2026-07", to: "2027-06" });
    expect(body.range).toEqual({ from: "2026-09", to: "2026-12" });
    expect(body.program).toBe("TKIT");
    expect(body.rows).toEqual([
      {
        year: 2026,
        month: 9,
        periodLabel: "September 2026",
        dueDate: "2026-09-30",
        action: "CREATE",
        amount: 500000,
        invoiceIds: [],
        hadLink: false,
        linkExpiresAt: null,
        beforeFirstBilling: true,
      },
      {
        year: 2026,
        month: 10,
        periodLabel: "Oktober 2026",
        dueDate: "2026-10-31",
        action: "SKIP_PAID",
        amount: 0,
        invoiceIds: ["i-okt"],
        hadLink: false,
        linkExpiresAt: null,
        beforeFirstBilling: false,
      },
      {
        year: 2026,
        month: 11,
        periodLabel: "November 2026",
        dueDate: "2026-11-30",
        action: "SETTLE",
        amount: 300000,
        invoiceIds: ["i-nov"],
        hadLink: true,
        linkExpiresAt: "2026-11-05T10:00:00.000Z",
        beforeFirstBilling: false,
      },
      {
        year: 2026,
        month: 12,
        periodLabel: "Desember 2026",
        dueDate: "2026-12-31",
        action: "CREATE",
        amount: 500000,
        invoiceIds: [],
        hadLink: false,
        linkExpiresAt: null,
        beforeFirstBilling: false,
      },
    ]);
    expect(body.total).toBe(1300000);
    expect(typeof body.total).toBe("number");
    expect(body.issues).toEqual([]);
    expect(body.blocked).toBe(false);
    expect(body.fingerprint).toBe(fingerprintOf(ctx));

    // Read-only: no transaction, no payment, no audit, no cache bust.
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.recordPayment).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("omitted range is passed through so the loader can default it to the academic year", async () => {
    mocks.load.mockResolvedValue(makeCtx());
    await callPreview({ studentId: "s-1" });
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "t-1",
      studentId: "s-1",
      from: undefined,
      to: undefined,
    });
  });

  it("a student with no class gets no rows and one blocking NO_PROGRAM issue", async () => {
    mocks.load.mockResolvedValue(
      makeCtx([], { noProgram: true, program: null, priceFor: () => null, firstInvoicedMonth: null }),
    );
    const res = await callPreview({ studentId: "s-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.blocked).toBe(true);
    expect(body.program).toBeNull();
    expect(body.issues).toEqual([
      {
        code: "NO_PROGRAM",
        blocking: true,
        message:
          "Siswa belum punya kelas di tahun ajaran ini, jadi SPP belum bisa dihitung. Daftarkan ke kelas lebih dulu.",
      },
    ]);
    expect(typeof body.fingerprint).toBe("string");
  });

  it("a month that cannot be priced is a blocking issue", async () => {
    mocks.load.mockResolvedValue(makeCtx([], { priceFor: () => null }));
    const body = await (await callPreview({ studentId: "s-1" })).json();
    expect(body.blocked).toBe(true);
    expect(body.issues.some((i: { code: string; blocking: boolean }) => i.code === "NO_PRICE" && i.blocking)).toBe(true);
  });

  it("400 for a range outside the academic year", async () => {
    mocks.load.mockResolvedValue({
      ok: false,
      code: "RANGE_OUTSIDE_YEAR",
      message: "Rentang bulan harus berada di dalam tahun ajaran 2026/2027.",
    });
    const res = await callPreview({ studentId: "s-1", from: "2026-06", to: "2027-06" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "RANGE_OUTSIDE_YEAR" });
  });

  it("400 for a reversed range", async () => {
    mocks.load.mockResolvedValue({ ok: false, code: "RANGE_INVALID", message: "Rentang bulan tidak valid." });
    expect((await callPreview({ studentId: "s-1", from: "2026-12", to: "2026-10" })).status).toBe(400);
  });

  it("400 for a malformed month before anything is loaded", async () => {
    const res = await callPreview({ studentId: "s-1", from: "2026-13" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "from", message: "Format bulan harus YYYY-MM" }]);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("400 for malformed JSON", async () => {
    expect((await callPreview("not-json{{")).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("409 when the school has no ACTIVE academic year", async () => {
    mocks.load.mockResolvedValue({ ok: false, code: "NO_ACADEMIC_YEAR", message: "Belum ada tahun ajaran aktif." });
    const res = await callPreview({ studentId: "s-1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NO_ACADEMIC_YEAR", error: "Belum ada tahun ajaran aktif." });
  });

  it("404 for an unknown, inactive or foreign-tenant student (the lookup is scoped to the session tenant)", async () => {
    mocks.load.mockResolvedValue({ ok: false, code: "STUDENT_NOT_FOUND", message: "Siswa tidak ditemukan atau tidak aktif." });
    const res = await callPreview({ studentId: "s-of-another-tenant" });
    expect(res.status).toBe(404);
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: "t-1", studentId: "s-of-another-tenant" }));
  });

  it.each([
    ["only invoices.create", ["invoices.create"]],
    ["only payments.record", ["payments.record"]],
    ["neither", []],
  ])("403 for a SCHOOL_ADMIN with %s", async (_label, permissions) => {
    vi.mocked(getSession).mockResolvedValue({ ...ADMIN, permissions } as never);
    const res = await callPreview({ studentId: "s-1" });
    expect(res.status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("403 for a non-admin and for no session; SUPER_ADMIN passes without listed permissions", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...ADMIN, role: "TEACHER", permissions: ["invoices.create", "payments.record"] } as never);
    expect((await callPreview({ studentId: "s-1" })).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect((await callPreview({ studentId: "s-1" })).status).toBe(403);

    vi.mocked(getSession).mockResolvedValue({ ...ADMIN, role: "SUPER_ADMIN", permissions: [] } as never);
    mocks.load.mockResolvedValue(makeCtx());
    expect((await callPreview({ studentId: "s-1" })).status).toBe(200);
  });
});

// ───────────────────────────── confirm ─────────────────────────────

describe("POST /api/invoices/spp-prepay", () => {
  it("settles November, skips Oktober, creates September and Desember, all paid, in one transaction", async () => {
    const ctx = makeCtx();
    mocks.load.mockResolvedValue(ctx);

    const res = await callConfirm(confirmBody(ctx));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      replayed: false,
      created: 2,
      settled: 1,
      skipped: 1,
      total: 1300000,
      reference: "SPP di muka TA 2026/2027",
      invoiceIds: ["i-nov", "new-1", "new-2"],
    });

    // One transaction with an explicit timeout.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ timeout: 15000 });

    // Payments: the settle first (its REMAINING balance), then each created month in full.
    expect(mocks.recordPayment).toHaveBeenCalledTimes(3);
    const calls = mocks.recordPayment.mock.calls.map((c) => c[1]);
    expect(calls.map((c) => [c.invoiceId, c.amount.toString(), c.idempotencyKey])).toEqual([
      ["i-nov", "300000", `${KEY}:2026-11`],
      ["new-1", "500000", `${KEY}:2026-09`],
      ["new-2", "500000", `${KEY}:2026-12`],
    ]);
    for (const c of calls) {
      expect(c).toMatchObject({
        tenantId: "t-1",
        actorId: "u-1",
        method: "CASH",
        reference: "SPP di muka TA 2026/2027",
        notes: "SPP di muka TA 2026/2027 (September 2026 – Desember 2026)",
        paidAt: null, // paid today: keeps `now`
        todayYmd: "2026-10-27",
        linkPolicy: "clear-link",
      });
      expect(c.requestHash).toBe(calls[0].requestHash);
    }
    expect(calls[0].requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mocks.recordPayment.mock.calls.every((c) => c[0] === mocks.tx)).toBe(true);

    // Invoice numbers: reserved once, with the CREATE count, after the settle and before the creates.
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledWith(mocks.tx, "t-1", 2);
    const reserveAt = mocks.reserve.mock.invocationCallOrder[0];
    const [settleAt, , ] = mocks.recordPayment.mock.invocationCallOrder;
    const [firstCreateAt] = mocks.tx.invoice.create.mock.invocationCallOrder;
    expect(settleAt).toBeLessThan(reserveAt);
    expect(reserveAt).toBeLessThan(firstCreateAt);

    // Created invoices: sent (no link, no gateway), priced from the month's lines.
    expect(mocks.tx.invoice.create).toHaveBeenCalledTimes(2);
    const created = mocks.tx.invoice.create.mock.calls.map((c) => c[0].data);
    expect(created[0]).toMatchObject({
      tenantId: "t-1",
      studentId: "s-1",
      parentId: "par-1",
      invoiceNumber: "INV-2026-0101",
      periodLabel: "September 2026",
      dueDate: "2026-09-30",
      status: "SENT",
      createdBy: "u-1",
    });
    expect(created[0].sentAt).toBeInstanceOf(Date);
    expect(created[0].totalDue.toString()).toBe("500000");
    expect(created[0].lines.create).toHaveLength(1);
    expect(created[0].lines.create[0]).toMatchObject({ feeComponentId: "fc-spp", labelSnapshot: "SPP", adjustmentNote: null });
    expect(created[0].lines.create[0].finalAmount.toString()).toBe("500000");
    expect(created[1]).toMatchObject({ invoiceNumber: "INV-2026-0102", periodLabel: "Desember 2026", dueDate: "2026-12-31" });
    expect(created[0]).not.toHaveProperty("xenditPaymentUrl");

    // One audit entry per created invoice, inside the transaction.
    expect(mocks.recordAudit).toHaveBeenCalledTimes(2);
    expect(mocks.recordAudit).toHaveBeenNthCalledWith(
      1,
      {
        tenantId: "t-1",
        actorId: "u-1",
        entity: "Invoice",
        entityId: "new-1",
        action: "create",
        after: { invoiceNumber: "INV-2026-0101", periodLabel: "September 2026", totalDue: "500000", source: "spp-prepay" },
      },
      mocks.tx,
    );
    expect(mocks.recordAudit.mock.calls[1][0]).toMatchObject({ entityId: "new-2", action: "create" });

    // Parent portal caches busted after the commit.
    expect(mocks.revalidateTag).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("student-invoices", { expire: 0 });

    // Never the gateway, never a relink.
    expect(mocks.createPaymentSession).not.toHaveBeenCalled();
    expect(mocks.scheduleRelink).not.toHaveBeenCalled();
  });

  it("lock order: student lock first, then the invoices to settle in ascending id order; reloads once locked", async () => {
    const ctx = makeCtx();
    mocks.load.mockResolvedValue(ctx);
    await callConfirm(confirmBody(ctx));

    const locked = mocks.tx.$executeRaw.mock.calls.map((c) => c[1]);
    expect(locked).toEqual(["spp-prepay:s-1", "i-nov"]);
    // Planned before locking, then again after (so the balances are the locked ones).
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load).toHaveBeenCalledWith(mocks.tx, { tenantId: "t-1", studentId: "s-1", from: "2026-09", to: "2026-12" });
  });

  it("several unpaid invoices in one month are locked and settled in ascending id order, one payment key each", async () => {
    // The planner receives them as given: z before a.
    const ctx = makeCtx(
      [
        inv({ id: "i-z", periodLabel: "November 2026", totalDue: D(100000) }),
        inv({ id: "i-a", periodLabel: "November 2026", totalDue: D(400000), totalPaid: D(150000) }),
      ],
      { range: { from: "2026-11", to: "2026-11" }, rangeYm: { from: { year: 2026, month: 11 }, to: { year: 2026, month: 11 } } },
    );
    mocks.load.mockResolvedValue(ctx);

    const res = await callConfirm(confirmBody(ctx));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ created: 0, settled: 2, skipped: 0, total: 350000, invoiceIds: ["i-a", "i-z"] });

    expect(mocks.tx.$executeRaw.mock.calls.map((c) => c[1])).toEqual(["spp-prepay:s-1", "i-a", "i-z"]);
    expect(mocks.recordPayment.mock.calls.map((c) => [c[1].invoiceId, c[1].amount.toString(), c[1].idempotencyKey])).toEqual([
      ["i-a", "250000", `${KEY}:2026-11:i-a`],
      ["i-z", "100000", `${KEY}:2026-11:i-z`],
    ]);
    // Nothing to create: no invoice numbers are reserved.
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
  });

  it("a back-dated paid date is stored at 00:00 Asia/Jakarta; the admin's reference and note are used", async () => {
    const ctx = makeCtx();
    mocks.load.mockResolvedValue(ctx);
    await callConfirm(confirmBody(ctx, { paidAt: "2026-10-20", reference: "  TRF-991  ", notes: "Dibayar ibu Siti" }));

    for (const [, input] of mocks.recordPayment.mock.calls) {
      expect(input.paidAt).toEqual(new Date("2026-10-20T00:00:00+07:00"));
      expect(input.reference).toBe("TRF-991");
      expect(input.notes).toBe("SPP di muka TA 2026/2027 (September 2026 – Desember 2026) — Dibayar ibu Siti");
    }
  });

  it("an all-paid range is NOTHING_TO_RECORD (409) and writes nothing", async () => {
    const ctx = makeCtx([inv({ id: "i-okt", periodLabel: "Oktober 2026", status: "PAID", totalPaid: D(500000) })], {
      range: { from: "2026-10", to: "2026-10" },
      rangeYm: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
    });
    mocks.load.mockResolvedValue(ctx);
    const res = await callConfirm(confirmBody(ctx));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NOTHING_TO_RECORD" });
    expect(mocks.recordPayment).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("a student with no class is refused with the NO_PROGRAM message (400)", async () => {
    const ctx = makeCtx([], { noProgram: true, program: null, priceFor: () => null });
    mocks.load.mockResolvedValue(ctx);
    const res = await callConfirm(confirmBody(ctx));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Siswa belum punya kelas di tahun ajaran ini, jadi SPP belum bisa dihitung. Daftarkan ke kelas lebih dulu.",
      code: "NO_PROGRAM",
    });
    expect(mocks.recordPayment).not.toHaveBeenCalled();
  });

  it("an unpriceable month is refused (400) and writes nothing", async () => {
    const ctx = makeCtx([], { priceFor: () => null });
    mocks.load.mockResolvedValue(ctx);
    const res = await callConfirm(confirmBody(ctx));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "NO_PRICE" });
    expect(mocks.recordPayment).not.toHaveBeenCalled();
    expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
  });

  describe("drift since the preview", () => {
    it("PREVIEW_STALE (409) when the fingerprint does not match; nothing is written", async () => {
      mocks.load.mockResolvedValue(makeCtx());
      const res = await callConfirm(confirmBody(makeCtx(), { fingerprint: "0".repeat(64) }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "Data berubah sejak pratinjau. Muat ulang pratinjau lalu coba lagi.",
        code: "PREVIEW_STALE",
      });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
    });

    it("PREVIEW_STALE when a balance moved after the preview (the gateway credited November meanwhile)", async () => {
      const previewed = makeCtx();
      const moved = makeCtx([
        INVOICES[0],
        { ...INVOICES[1], totalPaid: D(500000), status: "PAID" }, // November got paid in full
      ]);
      mocks.load.mockResolvedValue(moved);
      const res = await callConfirm(confirmBody(previewed));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "PREVIEW_STALE" });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
      expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
    });

    it("compares against the plan re-read AFTER the invoice locks, not the first read", async () => {
      const previewed = makeCtx();
      const paidMeanwhile = makeCtx([INVOICES[0], { ...INVOICES[1], totalPaid: D(250000) }]);
      mocks.load.mockResolvedValueOnce(previewed).mockResolvedValue(paidMeanwhile);
      const res = await callConfirm(confirmBody(previewed));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "PREVIEW_STALE" });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
    });
  });

  describe("replay", () => {
    it("200 { replayed: true } and no writes when a payment of this key already exists", async () => {
      const ctx = makeCtx();
      mocks.load.mockResolvedValue(ctx);
      const body = confirmBody(ctx);

      // First request, to learn the request hash the route stamps on its payments.
      expect((await callConfirm(body)).status).toBe(201);
      const requestHash = mocks.recordPayment.mock.calls[0][1].requestHash;

      vi.clearAllMocks();
      mocks.tx.payment.findFirst.mockResolvedValue({ requestHash });
      mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));

      const res = await callConfirm(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ replayed: true });
      expect(mocks.tx.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { idempotencyKey: { startsWith: `${KEY}:` }, invoice: { tenantId: "t-1", studentId: "s-1" } },
        }),
      );
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.recordPayment).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
      // The replay check ran right after the student lock, before anything else.
      expect(mocks.tx.$executeRaw.mock.calls.map((c) => c[1])).toEqual(["spp-prepay:s-1"]);
    });

    it("409 RETRY_MISMATCH when the same key comes back with different details", async () => {
      const ctx = makeCtx();
      mocks.load.mockResolvedValue(ctx);
      mocks.tx.payment.findFirst.mockResolvedValue({ requestHash: "f".repeat(64) });
      const res = await callConfirm(confirmBody(ctx));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "RETRY_MISMATCH" });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
    });
  });

  describe("a payment failure rolls the whole request back", () => {
    it("OVERPAYMENT mid-way is a 409 PREVIEW_STALE, nothing after it runs, no cache bust", async () => {
      const ctx = makeCtx();
      mocks.load.mockResolvedValue(ctx);
      mocks.recordPayment
        .mockResolvedValueOnce({ payment: { id: "p1" }, replayed: false, relink: false, invoiceStatus: "PAID", totalPaid: D(0) })
        .mockRejectedValueOnce(new PaymentError("OVERPAYMENT", "Jumlah pembayaran (Rp 500.000) melebihi sisa tagihan (Rp 0)"));

      const res = await callConfirm(confirmBody(ctx));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("PREVIEW_STALE");
      expect(body.error).toContain("melebihi sisa tagihan");
      expect(body.error).toContain("Muat ulang pratinjau");

      expect(mocks.recordPayment).toHaveBeenCalledTimes(2); // settle ok, first create failed
      expect(mocks.tx.invoice.create).toHaveBeenCalledTimes(1);
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
      expect(mocks.scheduleRelink).not.toHaveBeenCalled();
    });

    it.each([
      ["CANCELLED", 409, "PREVIEW_STALE"],
      ["PAID", 409, "PREVIEW_STALE"],
      ["RETRY_MISMATCH", 409, "RETRY_MISMATCH"],
      ["NOT_FOUND", 404, "NOT_FOUND"],
    ] as const)("PaymentError %s maps to %i / %s", async (code, status, bodyCode) => {
      const ctx = makeCtx();
      mocks.load.mockResolvedValue(ctx);
      mocks.recordPayment.mockRejectedValue(new PaymentError(code));
      const res = await callConfirm(confirmBody(ctx));
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(bodyCode);
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
    });

    it("an unexpected error is a 500 with a generic message", async () => {
      const ctx = makeCtx();
      mocks.load.mockResolvedValue(ctx);
      mocks.recordPayment.mockRejectedValue(new Error("connection reset"));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await callConfirm(confirmBody(ctx));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Gagal mencatat SPP di muka" });
      spy.mockRestore();
    });
  });

  describe("loader failures inside the transaction", () => {
    it.each([
      ["STUDENT_NOT_FOUND", 404],
      ["NO_ACADEMIC_YEAR", 409],
      ["RANGE_OUTSIDE_YEAR", 400],
      ["RANGE_INVALID", 400],
    ] as const)("%s maps to %i", async (code, status) => {
      mocks.load.mockResolvedValue({ ok: false, code, message: "pesan" });
      const res = await callConfirm(confirmBody(makeCtx()));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: "pesan", code });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
    });
  });

  describe("auth, validation and rate limit", () => {
    it.each([
      ["only invoices.create", ["invoices.create"]],
      ["only payments.record", ["payments.record"]],
      ["neither", []],
    ])("403 for a SCHOOL_ADMIN with %s", async (_label, permissions) => {
      vi.mocked(getSession).mockResolvedValue({ ...ADMIN, permissions } as never);
      const res = await callConfirm(confirmBody(makeCtx()));
      expect(res.status).toBe(403);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("403 without a session", async () => {
      vi.mocked(getSession).mockResolvedValue(null as never);
      expect((await callConfirm(confirmBody(makeCtx()))).status).toBe(403);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("400 on a gateway method with the Indonesian message on the method field", async () => {
      const res = await callConfirm(confirmBody(makeCtx(), { method: "XENDIT" }));
      expect(res.status).toBe(400);
      expect((await res.json()).errors).toEqual([
        { field: "method", message: "Pilih Tunai, Transfer Bank, atau Lainnya." },
      ]);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("400 on a future paid date", async () => {
      const res = await callConfirm(confirmBody(makeCtx(), { paidAt: "2026-10-28" }));
      expect(res.status).toBe(400);
      expect((await res.json()).errors).toEqual([{ field: "paidAt", message: "Tanggal bayar tidak boleh di masa depan." }]);
    });

    it.each([
      ["a missing idempotency key", { idempotencyKey: undefined }],
      ["a non-uuid idempotency key", { idempotencyKey: "abc" }],
      ["a missing fingerprint", { fingerprint: undefined }],
      ["a missing range", { to: undefined }],
      ["a malformed month", { from: "2026-9" }],
    ])("400 on %s", async (_label, over) => {
      const res = await callConfirm(confirmBody(makeCtx(), over));
      expect(res.status).toBe(400);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("400 on malformed JSON", async () => {
      expect((await callConfirm("not-json{{")).status).toBe(400);
    });
  });
});
