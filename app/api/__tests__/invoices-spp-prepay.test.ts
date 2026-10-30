/**
 * "Catat pembayaran di muka": POST /api/invoices/spp-prepay/preview and POST /api/invoices/spp-prepay
 * (docs/cycles/2026-10-27-paid-invoice-spp-prepay.md, T5; one-time fees: docs/cycles/2026-10-30-prepay-other-fees.md, T1-T2).
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
import type { MonthPrice, OtherFeesInput, PlanInvoice } from "@/lib/finance/spp-prepay-plan";

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
    invoiceNumber: `INV-${over.id}`,
    status: "SENT",
    totalDue: D(500000),
    totalPaid: D(0),
    monthlyAmount: D(500000),
    hasMonthlyLine: true,
    hasOtherLine: false,
    feeComponentIds: ["fc-spp"],
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

const COMPONENTS = [
  { id: "fc-pangkal", label: "Uang Pangkal", sortOrder: 1, prefillAmount: 5000000 },
  { id: "fc-sarana", label: "Sarana", sortOrder: 2, prefillAmount: null },
];

function makeCtx(invoices: PlanInvoice[] = INVOICES, over: Partial<SppPrepayContext> = {}): SppPrepayContext {
  return {
    ok: true,
    student: { id: "s-1", name: "Budi" },
    academicYear: { id: "ay-1", name: "2026/2027", from: "2026-07", to: "2027-06" },
    sppChosen: true,
    range: { from: "2026-09", to: "2026-12" },
    defaultRange: { from: "2026-07", to: "2027-06" },
    oneTimeComponents: COMPONENTS,
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

const fingerprintOf = (ctx: SppPrepayContext, otherFees?: OtherFeesInput) =>
  fingerprintPlan(planForContext(ctx, otherFees), ctx.invoices);

/** The request a preview of `ctx` (and optionally one-time lines) would be confirmed with. */
function confirmBody(ctx: SppPrepayContext, over: Record<string, unknown> = {}) {
  const otherFees = over.otherFees as OtherFeesInput | undefined;
  return {
    studentId: "s-1",
    ...(ctx.sppChosen && ctx.range ? { from: ctx.range.from, to: ctx.range.to } : {}),
    method: "CASH",
    paidAt: "2026-10-27",
    idempotencyKey: KEY,
    fingerprint: fingerprintOf(ctx, otherFees),
    ...over,
  };
}

const OTHER_FEES: OtherFeesInput = {
  label: "Biaya Sekolah Tahap 1 TA 2027/2028",
  lines: [
    { feeComponentId: "fc-pangkal", amount: 5000000 },
    { feeComponentId: "fc-sarana", amount: 1500000 },
  ],
};
/** A student with no program who pays only one-time fees ("Tanpa SPP"). */
const ctxNoSpp = (over: Partial<SppPrepayContext> = {}) =>
  makeCtx([], {
    sppChosen: false,
    range: null,
    rangeYm: null,
    noProgram: true,
    program: null,
    priceFor: () => null,
    firstInvoicedMonth: null,
    ...over,
  });

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
    const res = await callPreview({ studentId: "s-1", from: "2026-13", to: "2026-12" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "from", message: "Format bulan harus YYYY-MM" }]);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("400 for malformed JSON", async () => {
    expect((await callPreview("not-json{{")).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("no ACTIVE academic year is not an error: SPP is unavailable (and blocking only if chosen), one-time fees still plan", async () => {
    const noYear = (over: Partial<SppPrepayContext> = {}) =>
      ctxNoSpp({ academicYear: null, defaultRange: null, ...over });

    mocks.load.mockResolvedValue(noYear());
    const res = await callPreview({ studentId: "s-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.academicYear).toBeNull();
    expect(body.spp).toMatchObject({ available: false, reason: { code: "NO_ACADEMIC_YEAR" }, defaultRange: null });
    expect(body.blocked).toBe(false);
    expect(body.oneTimeComponents).toHaveLength(2);

    // Chosen anyway: one blocking issue, no rows.
    mocks.load.mockResolvedValue(noYear({ sppChosen: true }));
    const chosen = await (await callPreview({ studentId: "s-1", from: "2026-10", to: "2026-12" })).json();
    expect(chosen.rows).toEqual([]);
    expect(chosen.blocked).toBe(true);
    expect(chosen.issues).toEqual([expect.objectContaining({ code: "NO_ACADEMIC_YEAR", blocking: true })]);
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

// ─────────── preview: one-time fees (cycle 2026-10-30-prepay-other-fees) ───────────

describe("POST /api/invoices/spp-prepay/preview: one-time fees", () => {
  it("a student-only call is not an error: it returns the components with prefill, SPP availability and an empty plan", async () => {
    const ctx = makeCtx(INVOICES, { sppChosen: false, range: null, rangeYm: null });
    mocks.load.mockResolvedValue(ctx);

    const res = await callPreview({ studentId: "s-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.oneTimeComponents).toEqual(COMPONENTS);
    expect(body.spp).toEqual({
      available: true,
      reason: null,
      defaultRange: { from: "2026-07", to: "2027-06" },
    });
    expect(body.range).toBeNull();
    expect(body.rows).toEqual([]);
    expect(body.otherFees).toBeNull();
    expect(body.total).toBe(0);
    expect(body.sppTotal).toBe(0);
    expect(body.issues).toEqual([]);
    expect(body.blocked).toBe(false);
    expect(body.fingerprint).toBe(fingerprintOf(ctx));
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "t-1",
      studentId: "s-1",
      from: undefined,
      to: undefined,
    });
  });

  it("a student with no program: SPP unavailable with the existing message, components with no prefill, not blocked", async () => {
    mocks.load.mockResolvedValue(
      ctxNoSpp({ oneTimeComponents: COMPONENTS.map((c) => ({ ...c, prefillAmount: null })) }),
    );
    const body = await (await callPreview({ studentId: "s-1" })).json();
    expect(body.spp).toMatchObject({
      available: false,
      reason: {
        code: "NO_PROGRAM",
        message:
          "Siswa belum punya kelas di tahun ajaran ini, jadi SPP belum bisa dihitung. Daftarkan ke kelas lebih dulu.",
      },
    });
    expect(body.oneTimeComponents.every((c: { prefillAmount: number | null }) => c.prefillAmount === null)).toBe(true);
    expect(body.blocked).toBe(false);
  });

  it("one-time only: the otherFees block, the grand total, and the payload reaches the planner", async () => {
    const ctx = ctxNoSpp();
    mocks.load.mockResolvedValue(ctx);

    const res = await callPreview({ studentId: "s-1", otherFees: OTHER_FEES });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.otherFees).toEqual({
      label: "Biaya Sekolah Tahap 1 TA 2027/2028",
      lines: [
        { feeComponentId: "fc-pangkal", label: "Uang Pangkal", amount: 5000000 },
        { feeComponentId: "fc-sarana", label: "Sarana", amount: 1500000 },
      ],
      total: 6500000,
    });
    expect(body.sppTotal).toBe(0);
    expect(body.total).toBe(6500000);
    expect(body.blocked).toBe(false);
    expect(body.fingerprint).toBe(fingerprintOf(ctx, OTHER_FEES));
    expect(body.fingerprint).not.toBe(fingerprintOf(ctx));
  });

  it("SPP and one-time together: the grand total sums both and the fingerprint covers both", async () => {
    const ctx = makeCtx();
    mocks.load.mockResolvedValue(ctx);
    const body = await (
      await callPreview({ studentId: "s-1", from: "2026-09", to: "2026-12", otherFees: OTHER_FEES })
    ).json();
    expect(body.sppTotal).toBe(1300000);
    expect(body.otherFees.total).toBe(6500000);
    expect(body.total).toBe(7800000);
    expect(body.fingerprint).toBe(fingerprintOf(ctx, OTHER_FEES));
  });

  it("SPP not available but chosen blocks only SPP: with no SPP chosen the one-time part is not blocked", async () => {
    mocks.load.mockResolvedValue(ctxNoSpp({ sppChosen: true }));
    const chosen = await (await callPreview({ studentId: "s-1", from: "2026-10", to: "2026-12", otherFees: OTHER_FEES })).json();
    expect(chosen.blocked).toBe(true);
    expect(chosen.issues).toEqual([expect.objectContaining({ code: "NO_PROGRAM", blocking: true })]);
    expect(chosen.otherFees.total).toBe(6500000);

    mocks.load.mockResolvedValue(ctxNoSpp());
    expect((await (await callPreview({ studentId: "s-1", otherFees: OTHER_FEES })).json()).blocked).toBe(false);
  });

  it("a non-blocking caution names each unpaid invoice that already carries a chosen component", async () => {
    const unpaid = inv({
      id: "i-pangkal",
      periodLabel: "Uang Pangkal",
      invoiceNumber: "INV-2026-0042",
      totalDue: D(5000000),
      hasMonthlyLine: false,
      hasOtherLine: true,
      monthlyAmount: D(0),
      feeComponentIds: ["fc-pangkal"],
    });
    const paid = inv({ id: "i-paid", periodLabel: "Seragam", status: "PAID", feeComponentIds: ["fc-pangkal"], hasMonthlyLine: false });
    mocks.load.mockResolvedValue(ctxNoSpp({ invoices: [unpaid, paid] }));

    const body = await (await callPreview({ studentId: "s-1", otherFees: OTHER_FEES })).json();
    expect(body.blocked).toBe(false);
    expect(body.issues).toEqual([
      {
        code: "UNPAID_SAME_COMPONENT",
        blocking: false,
        message:
          "Siswa ini sudah punya tagihan belum lunas yang memuat Uang Pangkal. Jika wali membayar tagihan itu, gunakan Catat Pembayaran di tagihan tersebut.",
        invoiceId: "i-pangkal",
        invoice: {
          id: "i-pangkal",
          invoiceNumber: "INV-2026-0042",
          periodLabel: "Uang Pangkal",
          status: "SENT",
          totalDue: 5000000,
          monthlyAmount: 0,
        },
      },
    ]);
  });

  it("a component that is not one of the tenant's enabled one-time components is a blocking issue", async () => {
    mocks.load.mockResolvedValue(ctxNoSpp());
    const body = await (
      await callPreview({ studentId: "s-1", otherFees: { ...OTHER_FEES, lines: [{ feeComponentId: "fc-foreign", amount: 1000 }] } })
    ).json();
    expect(body.blocked).toBe(true);
    expect(body.otherFees).toBeNull();
    expect(body.issues).toEqual([expect.objectContaining({ code: "INVALID_COMPONENT", blocking: true })]);
  });

  it.each([
    ["a month label", { ...OTHER_FEES, label: "Januari 2027" }, "otherFees.label"],
    ["a zero amount", { ...OTHER_FEES, lines: [{ feeComponentId: "fc-pangkal", amount: 0 }] }, "otherFees.lines.0.amount"],
    ["no lines", { ...OTHER_FEES, lines: [] }, "otherFees.lines"],
  ])("400 with a message on the field for %s, before anything is loaded", async (_label, otherFees, field) => {
    const res = await callPreview({ studentId: "s-1", otherFees });
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0].field).toBe(field);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("400 when only one month is given", async () => {
    const res = await callPreview({ studentId: "s-1", from: "2026-10" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "to", message: "Isi bulan awal dan bulan akhir, atau pilih Tanpa SPP" }]);
  });

  it("stays read-only", async () => {
    mocks.load.mockResolvedValue(ctxNoSpp());
    await callPreview({ studentId: "s-1", otherFees: OTHER_FEES });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.recordPayment).not.toHaveBeenCalled();
    expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
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
      otherFees: null,
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

    // SPP only: no one-time invoice, so no "other" payment key.
    expect(calls.some((c) => String(c.idempotencyKey).endsWith(":other"))).toBe(false);

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
      expect(await res.json()).toEqual({ error: "Gagal mencatat pembayaran di muka" });
      spy.mockRestore();
    });
  });

  describe("loader failures inside the transaction", () => {
    it.each([
      ["STUDENT_NOT_FOUND", 404],
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

// ─────────── confirm: one-time fees (cycle 2026-10-30-prepay-other-fees) ───────────

describe("POST /api/invoices/spp-prepay: one-time fees", () => {
  it("Tanpa SPP: creates ONE sent invoice for the lines and pays it in full in the same transaction", async () => {
    const ctx = ctxNoSpp();
    mocks.load.mockResolvedValue(ctx);

    const res = await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES, paidAt: "2026-10-24" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      replayed: false,
      created: 0,
      settled: 0,
      skipped: 0,
      total: 6500000,
      reference: "Pembayaran di muka",
      invoiceIds: ["new-1"],
      otherFees: { invoiceId: "new-1", invoiceNumber: "INV-2026-0101", total: 6500000 },
    });

    // One transaction, one invoice number, one invoice.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ timeout: 15000 });
    expect(mocks.reserve).toHaveBeenCalledWith(mocks.tx, "t-1", 1);
    expect(mocks.tx.invoice.create).toHaveBeenCalledTimes(1);
    const data = mocks.tx.invoice.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: "t-1",
      studentId: "s-1",
      parentId: "par-1",
      invoiceNumber: "INV-2026-0101",
      periodLabel: "Biaya Sekolah Tahap 1 TA 2027/2028",
      dueDate: "2026-10-24", // the paid date
      status: "SENT",
      createdBy: "u-1",
    });
    expect(data.sentAt).toBeInstanceOf(Date);
    expect(data.totalDue.toString()).toBe("6500000");
    expect(data).not.toHaveProperty("xenditPaymentUrl");
    expect(
      data.lines.create.map((l: Record<string, { toString(): string } | string | null>) => [
        l.feeComponentId,
        l.labelSnapshot,
        String(l.amount),
        String(l.finalAmount),
        String(l.adjustmentAmount),
        l.adjustmentNote,
      ]),
    ).toEqual([
      ["fc-pangkal", "Uang Pangkal", "5000000", "5000000", "0", null],
      ["fc-sarana", "Sarana", "1500000", "1500000", "0", null],
    ]);

    // One payment, in full, `<key>:other`, clear-link, back-dated, reference default and note.
    expect(mocks.recordPayment).toHaveBeenCalledTimes(1);
    const [txArg, pay] = mocks.recordPayment.mock.calls[0];
    expect(txArg).toBe(mocks.tx);
    expect(pay).toMatchObject({
      invoiceId: "new-1",
      tenantId: "t-1",
      actorId: "u-1",
      method: "CASH",
      reference: "Pembayaran di muka",
      notes: "Biaya Sekolah Tahap 1 TA 2027/2028",
      paidAt: new Date("2026-10-24T00:00:00+07:00"),
      idempotencyKey: `${KEY}:other`,
      todayYmd: "2026-10-27",
      linkPolicy: "clear-link",
    });
    expect(pay.amount.toString()).toBe("6500000");

    // Audit for the invoice (the payment's own audit is recordPaymentInTx's, spied here).
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      {
        tenantId: "t-1",
        actorId: "u-1",
        entity: "Invoice",
        entityId: "new-1",
        action: "create",
        after: {
          invoiceNumber: "INV-2026-0101",
          periodLabel: "Biaya Sekolah Tahap 1 TA 2027/2028",
          totalDue: "6500000",
          source: "spp-prepay",
          part: "other-fees",
        },
      },
      mocks.tx,
    );

    // Locks: only the student lock (nothing existing to settle). Caches busted after the commit.
    expect(mocks.tx.$executeRaw.mock.calls.map((c) => c[1])).toEqual(["spp-prepay:s-1"]);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("student-invoices", { expire: 0 });

    // No gateway call, no relink.
    expect(mocks.createPaymentSession).not.toHaveBeenCalled();
    expect(mocks.scheduleRelink).not.toHaveBeenCalled();
  });

  it("uses the admin's reference and note for the one-time payment", async () => {
    const ctx = ctxNoSpp();
    mocks.load.mockResolvedValue(ctx);
    await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES, reference: "  KW-77 ", notes: "Dibayar ayah" }));
    expect(mocks.recordPayment.mock.calls[0][1]).toMatchObject({
      reference: "KW-77",
      notes: "Biaya Sekolah Tahap 1 TA 2027/2028 — Dibayar ayah",
      paidAt: null, // paid today keeps `now`
    });
  });

  it("SPP + one-time: SPP months first, then the one-time invoice last with the next number; both keep their own default reference", async () => {
    const ctx = makeCtx();
    mocks.load.mockResolvedValue(ctx);

    const res = await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      replayed: false,
      created: 2,
      settled: 1,
      skipped: 1,
      total: 7800000,
      reference: "SPP di muka TA 2026/2027",
      invoiceIds: ["i-nov", "new-1", "new-2", "new-3"],
      otherFees: { invoiceId: "new-3", invoiceNumber: "INV-2026-0103", total: 6500000 },
    });

    // Numbers are reserved once for the SPP creates plus the one-time invoice, after the settle.
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledWith(mocks.tx, "t-1", 3);
    const payments = mocks.recordPayment.mock.calls.map((c) => c[1]);
    expect(payments.map((p) => [p.invoiceId, p.amount.toString(), p.idempotencyKey, p.reference])).toEqual([
      ["i-nov", "300000", `${KEY}:2026-11`, "SPP di muka TA 2026/2027"],
      ["new-1", "500000", `${KEY}:2026-09`, "SPP di muka TA 2026/2027"],
      ["new-2", "500000", `${KEY}:2026-12`, "SPP di muka TA 2026/2027"],
      ["new-3", "6500000", `${KEY}:other`, "Pembayaran di muka"],
    ]);
    // One request hash on every payment, one-time included.
    expect(new Set(payments.map((p) => p.requestHash)).size).toBe(1);
    // Locks follow the existing order: student, then the invoice to settle.
    expect(mocks.tx.$executeRaw.mock.calls.map((c) => c[1])).toEqual(["spp-prepay:s-1", "i-nov"]);
    // The SPP month invoices are untouched by the one-time part.
    expect(mocks.tx.invoice.create.mock.calls.map((c) => c[0].data.periodLabel)).toEqual([
      "September 2026",
      "Desember 2026",
      "Biaya Sekolah Tahap 1 TA 2027/2028",
    ]);
    expect(mocks.recordAudit).toHaveBeenCalledTimes(3);
  });

  it("an admin reference is shared by every payment of the request", async () => {
    const ctx = makeCtx();
    mocks.load.mockResolvedValue(ctx);
    await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES, reference: "TRF-1" }));
    expect(new Set(mocks.recordPayment.mock.calls.map((c) => c[1].reference))).toEqual(new Set(["TRF-1"]));
  });

  it("SPP range all paid but one-time lines given: the one-time invoice is still created, nothing else", async () => {
    const ctx = makeCtx([inv({ id: "i-okt", periodLabel: "Oktober 2026", status: "PAID", totalPaid: D(500000) })], {
      range: { from: "2026-10", to: "2026-10" },
      rangeYm: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
    });
    mocks.load.mockResolvedValue(ctx);
    const res = await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ created: 0, settled: 0, skipped: 1, total: 6500000 });
    expect(mocks.recordPayment).toHaveBeenCalledTimes(1);
    expect(mocks.recordPayment.mock.calls[0][1].idempotencyKey).toBe(`${KEY}:other`);
    expect(mocks.reserve).toHaveBeenCalledWith(mocks.tx, "t-1", 1);
  });

  it("all-paid SPP range with no one-time lines is still NOTHING_TO_RECORD", async () => {
    const ctx = makeCtx([inv({ id: "i-okt", periodLabel: "Oktober 2026", status: "PAID", totalPaid: D(500000) })], {
      range: { from: "2026-10", to: "2026-10" },
      rangeYm: { from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 } },
    });
    mocks.load.mockResolvedValue(ctx);
    const res = await callConfirm(confirmBody(ctx));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NOTHING_TO_RECORD" });
  });

  it("a student with no program can record one-time fees; the same student choosing SPP is refused (NO_PROGRAM)", async () => {
    const ctx = ctxNoSpp();
    mocks.load.mockResolvedValue(ctx);
    expect((await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES }))).status).toBe(201);

    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));
    mocks.tx.payment.findFirst.mockResolvedValue(null);
    const chosen = ctxNoSpp({ sppChosen: true });
    mocks.load.mockResolvedValue(chosen);
    const res = await callConfirm({
      ...confirmBody(chosen, { otherFees: OTHER_FEES }),
      from: "2026-10",
      to: "2026-12",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "NO_PROGRAM" });
    expect(mocks.recordPayment).not.toHaveBeenCalled();
    expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
  });

  it("no academic year: one-time fees still record; choosing SPP is refused (NO_ACADEMIC_YEAR)", async () => {
    const noYear = ctxNoSpp({ academicYear: null, defaultRange: null });
    mocks.load.mockResolvedValue(noYear);
    expect((await callConfirm(confirmBody(noYear, { otherFees: OTHER_FEES }))).status).toBe(201);
    // No SPP rows, so no academic-year name is read for the notes.
    expect(mocks.recordPayment.mock.calls[0][1].notes).toBe("Biaya Sekolah Tahap 1 TA 2027/2028");

    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));
    mocks.tx.payment.findFirst.mockResolvedValue(null);
    const chosen = ctxNoSpp({ academicYear: null, defaultRange: null, sppChosen: true });
    mocks.load.mockResolvedValue(chosen);
    const res = await callConfirm({ ...confirmBody(chosen, { otherFees: OTHER_FEES }), from: "2026-10", to: "2026-12" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "NO_ACADEMIC_YEAR" });
  });

  it("a caution (unpaid invoice with the same component) does not block the confirm", async () => {
    const unpaid = inv({ id: "i-pangkal", periodLabel: "Uang Pangkal", hasMonthlyLine: false, feeComponentIds: ["fc-pangkal"] });
    const ctx = ctxNoSpp({ invoices: [unpaid] });
    mocks.load.mockResolvedValue(ctx);
    const res = await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES }));
    expect(res.status).toBe(201);
    // The existing invoice is not touched: this flow never settles an unpaid one-time invoice.
    expect(mocks.recordPayment).toHaveBeenCalledTimes(1);
    expect(mocks.recordPayment.mock.calls[0][1].invoiceId).toBe("new-1");
  });

  describe("component validation (server side)", () => {
    it("400 INVALID_COMPONENT for a component outside the tenant's enabled, ACTIVE, non-recurring list (foreign, recurring, disabled, inactive)", async () => {
      const ctx = ctxNoSpp();
      mocks.load.mockResolvedValue(ctx);
      const bad = { ...OTHER_FEES, lines: [{ feeComponentId: "fc-spp-or-foreign-or-disabled", amount: 1000 }] };
      const res = await callConfirm(confirmBody(ctx, { otherFees: bad }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "INVALID_COMPONENT" });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
    });

    it("one bad line among good ones refuses the whole request", async () => {
      const ctx = ctxNoSpp();
      mocks.load.mockResolvedValue(ctx);
      const bad = { ...OTHER_FEES, lines: [...OTHER_FEES.lines, { feeComponentId: "fc-bad", amount: 1000 }] };
      expect((await callConfirm(confirmBody(ctx, { otherFees: bad }))).status).toBe(400);
      expect(mocks.recordPayment).not.toHaveBeenCalled();
    });

    it("the component list the route validates against comes from the tenant-scoped loader, called with the session tenant", async () => {
      const ctx = ctxNoSpp();
      mocks.load.mockResolvedValue(ctx);
      await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES }));
      expect(mocks.load).toHaveBeenCalledWith(mocks.tx, { tenantId: "t-1", studentId: "s-1", from: undefined, to: undefined });
    });
  });

  describe("validation before anything is written", () => {
    it("400 when neither part is given", async () => {
      const res = await callConfirm(confirmBody(ctxNoSpp()));
      expect(res.status).toBe(400);
      expect((await res.json()).errors).toEqual([
        { field: "parts", message: "Pilih SPP atau isi biaya lainnya. Belum ada yang dicatat." },
      ]);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("400 for a label that names one month, on the label field", async () => {
      const res = await callConfirm(confirmBody(ctxNoSpp(), { otherFees: { ...OTHER_FEES, label: "Januari 2027" } }));
      expect(res.status).toBe(400);
      expect((await res.json()).errors).toEqual([
        {
          field: "otherFees.label",
          message: 'Gunakan label yang menjelaskan biaya, mis. "Biaya Sekolah Tahap 1 TA 2027/2028", bukan nama bulan.',
        },
      ]);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ["a zero amount", [{ feeComponentId: "fc-pangkal", amount: 0 }]],
      ["a negative amount", [{ feeComponentId: "fc-pangkal", amount: -5 }]],
      ["a fractional amount", [{ feeComponentId: "fc-pangkal", amount: 100.5 }]],
      ["a duplicate component", [{ feeComponentId: "fc-pangkal", amount: 1 }, { feeComponentId: "fc-pangkal", amount: 2 }]],
      ["no lines", []],
      ["21 lines", Array.from({ length: 21 }, (_, i) => ({ feeComponentId: `fc-${i}`, amount: 1 }))],
    ])("400 for %s", async (_label, lines) => {
      const res = await callConfirm(confirmBody(ctxNoSpp(), { otherFees: { label: "Biaya Sekolah Tahap 1 TA 2027/2028", lines } }));
      expect(res.status).toBe(400);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("400 when only one SPP month is given", async () => {
      const res = await callConfirm({ ...confirmBody(ctxNoSpp(), { otherFees: OTHER_FEES }), from: "2026-10" });
      expect(res.status).toBe(400);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });
  });

  describe("drift: the payload is part of the fingerprint", () => {
    it("PREVIEW_STALE when the confirmed lines differ from the previewed ones", async () => {
      const ctx = ctxNoSpp();
      mocks.load.mockResolvedValue(ctx);
      const previewed = confirmBody(ctx, { otherFees: OTHER_FEES });
      const changed = {
        ...previewed,
        otherFees: { ...OTHER_FEES, lines: [{ feeComponentId: "fc-pangkal", amount: 4000000 }, OTHER_FEES.lines[1]] },
      };
      const res = await callConfirm(changed);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "PREVIEW_STALE" });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
    });

    it.each([
      ["another label", { ...OTHER_FEES, label: "Biaya Sekolah Tahap 2 TA 2027/2028" }],
      ["another component", { ...OTHER_FEES, lines: [{ feeComponentId: "fc-pangkal", amount: 5000000 }] }],
    ])("PREVIEW_STALE for %s", async (_label, otherFees) => {
      const ctx = ctxNoSpp();
      mocks.load.mockResolvedValue(ctx);
      const res = await callConfirm({ ...confirmBody(ctx, { otherFees: OTHER_FEES }), otherFees });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "PREVIEW_STALE" });
    });

    it("PREVIEW_STALE when a preview without the one-time part is confirmed with it", async () => {
      const ctx = makeCtx();
      mocks.load.mockResolvedValue(ctx);
      const res = await callConfirm({ ...confirmBody(ctx), otherFees: OTHER_FEES });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "PREVIEW_STALE" });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
    });

    it("SPP drift still refuses a request that also carries one-time lines (nothing of either is written)", async () => {
      const previewed = makeCtx();
      const moved = makeCtx([INVOICES[0], { ...INVOICES[1], totalPaid: D(500000), status: "PAID" }]);
      mocks.load.mockResolvedValue(moved);
      const res = await callConfirm(confirmBody(previewed, { otherFees: OTHER_FEES }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "PREVIEW_STALE" });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
      expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe("replay safety", () => {
    it("a resubmit with the same key writes nothing: no second one-time invoice, payment, audit or number", async () => {
      const ctx = ctxNoSpp();
      mocks.load.mockResolvedValue(ctx);
      const body = confirmBody(ctx, { otherFees: OTHER_FEES });

      expect((await callConfirm(body)).status).toBe(201);
      const requestHash = mocks.recordPayment.mock.calls[0][1].requestHash;

      vi.clearAllMocks();
      // The first request committed: its `<key>:other` payment exists for this student.
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
      expect(mocks.tx.$executeRaw.mock.calls.map((c) => c[1])).toEqual(["spp-prepay:s-1"]);
    });

    it("the same key with a different one-time payload is RETRY_MISMATCH, not a second invoice", async () => {
      const ctx = ctxNoSpp();
      mocks.load.mockResolvedValue(ctx);
      expect((await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES }))).status).toBe(201);
      const requestHash = mocks.recordPayment.mock.calls[0][1].requestHash;

      vi.clearAllMocks();
      mocks.tx.payment.findFirst.mockResolvedValue({ requestHash });
      mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mocks.tx));

      const other = { ...OTHER_FEES, lines: [{ feeComponentId: "fc-pangkal", amount: 4000000 }] };
      const res = await callConfirm(confirmBody(ctx, { otherFees: other }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "RETRY_MISMATCH" });
      expect(mocks.recordPayment).not.toHaveBeenCalled();
      expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe("a payment failure rolls everything back, SPP months and the one-time invoice", () => {
    it("OVERPAYMENT on the one-time payment is a 409 PREVIEW_STALE with no cache bust", async () => {
      const ctx = ctxNoSpp();
      mocks.load.mockResolvedValue(ctx);
      mocks.recordPayment.mockRejectedValue(new PaymentError("OVERPAYMENT", "Jumlah pembayaran melebihi sisa tagihan"));
      const res = await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "PREVIEW_STALE" });
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
    });

    it("a failure after the SPP months never reaches the audit entry of the one-time invoice", async () => {
      const ctx = makeCtx();
      mocks.load.mockResolvedValue(ctx);
      // settle + 2 SPP creates succeed, the one-time payment (the 4th) fails.
      mocks.recordPayment
        .mockResolvedValueOnce({ payment: { id: "p1" }, replayed: false, relink: false, invoiceStatus: "PAID", totalPaid: D(0) })
        .mockResolvedValueOnce({ payment: { id: "p2" }, replayed: false, relink: false, invoiceStatus: "PAID", totalPaid: D(0) })
        .mockResolvedValueOnce({ payment: { id: "p3" }, replayed: false, relink: false, invoiceStatus: "PAID", totalPaid: D(0) })
        .mockRejectedValueOnce(new Error("connection reset"));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await callConfirm(confirmBody(ctx, { otherFees: OTHER_FEES }));
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(mocks.recordAudit).toHaveBeenCalledTimes(2); // the two SPP creates only; the transaction rolls them back
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
    });
  });

  describe("permissions and tenant scope", () => {
    it.each([
      ["only invoices.create", ["invoices.create"]],
      ["only payments.record", ["payments.record"]],
      ["neither", []],
    ])("403 for a SCHOOL_ADMIN with %s", async (_label, permissions) => {
      vi.mocked(getSession).mockResolvedValue({ ...ADMIN, permissions } as never);
      const res = await callConfirm(confirmBody(ctxNoSpp(), { otherFees: OTHER_FEES }));
      expect(res.status).toBe(403);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("403 for a teacher and for no session", async () => {
      vi.mocked(getSession).mockResolvedValue({ ...ADMIN, role: "TEACHER" } as never);
      expect((await callConfirm(confirmBody(ctxNoSpp(), { otherFees: OTHER_FEES }))).status).toBe(403);
      vi.mocked(getSession).mockResolvedValue(null as never);
      expect((await callConfirm(confirmBody(ctxNoSpp(), { otherFees: OTHER_FEES }))).status).toBe(403);
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("the tenant comes from the session, never the body; a foreign student is a 404 and writes nothing", async () => {
      mocks.load.mockResolvedValue({ ok: false, code: "STUDENT_NOT_FOUND", message: "Siswa tidak ditemukan atau tidak aktif." });
      const res = await callConfirm({
        studentId: "s-of-another-tenant",
        tenantId: "t-other",
        otherFees: OTHER_FEES,
        method: "CASH",
        paidAt: "2026-10-27",
        idempotencyKey: KEY,
        fingerprint: "f".repeat(64),
      });
      expect(res.status).toBe(404);
      expect(mocks.load).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ tenantId: "t-1", studentId: "s-of-another-tenant" }));
      expect(mocks.recordPayment).not.toHaveBeenCalled();
      expect(mocks.tx.invoice.create).not.toHaveBeenCalled();
    });
  });
});
