import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@/lib/generated/prisma/client";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

/**
 * POST /api/invoices — "Sudah dibayar" mode (cycle 2026-10-27-paid-invoice-spp-prepay, T3).
 * The invoice is created already paid in full through the shared `recordPaymentInTx`
 * (mocked here; its own behaviour is covered in lib/finance/__tests__/record-payment.test.ts).
 */

const txMock = {
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  invoice: { create: vi.fn() },
  payment: { findFirst: vi.fn() },
};

const mocks = vi.hoisted(() => ({
  recordPaymentInTx: vi.fn(),
  recordAudit: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findFirst: vi.fn() },
    feeComponentDef: { findMany: vi.fn() },
    studentGuardian: { findFirst: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/payments/session", () => ({ createPaymentSessionForInvoice: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/finance/record-payment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/finance/record-payment")>();
  return { ...actual, recordPaymentInTx: mocks.recordPaymentInTx };
});

import { POST } from "../invoices/route";
import { PaymentError } from "@/lib/finance/record-payment";
import { revalidateTag } from "next/cache";

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const adminSession = {
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

const KEY = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const today = getTodayInTimezone("Asia/Jakarta");

function ymdOffset(days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const unpaidBody = {
  studentId: "s-1",
  periodLabel: "Biaya Sekolah Tahap 1 TA 2027/2028",
  dueDate: "2027-07-31",
  lines: [
    { feeComponentId: "fc-1", amount: 1_000_000 },
    { feeComponentId: "fc-2", amount: 500_000 },
  ],
};

function paidBody(over: Record<string, unknown> = {}) {
  return {
    ...unpaidBody,
    payment: { idempotencyKey: KEY, method: "CASH", paidAt: today, ...over },
  };
}

async function setup(session: Record<string, unknown> = adminSession) {
  const { getSession } = await import("@/lib/auth");
  const { prisma } = await import("@/lib/db");
  vi.mocked(getSession).mockResolvedValue(session as never);
  vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s-1" } as never);
  vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
    { id: "fc-1", label: "Uang Pangkal" },
    { id: "fc-2", label: "Sarana" },
  ] as never);
  vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue({ parentId: "p-1" } as never);
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
    id: "inv-new",
    invoiceNumber: "INV-2026-0001",
    totalDue: 1_500_000,
    status: "PAID",
    xenditPaymentUrl: null,
    xenditSessionId: null,
    paymentLinkError: null,
    lines: [],
  } as never);
  txMock.$queryRaw.mockResolvedValue([{ lastNumber: 1 }]);
  txMock.invoice.create.mockResolvedValue({ id: "inv-new" });
  return { prisma };
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.$queryRaw.mockReset();
  txMock.$executeRaw.mockReset().mockResolvedValue(1);
  txMock.invoice.create.mockReset();
  txMock.payment.findFirst.mockReset().mockResolvedValue(null);
  mocks.rateLimit.mockReset().mockReturnValue({ success: true, remaining: 29 });
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.recordPaymentInTx.mockReset().mockResolvedValue({
    payment: { id: "pay-1" },
    replayed: false,
    relink: false,
    invoiceStatus: "PAID",
    totalPaid: new Prisma.Decimal(1_500_000),
  });
});

describe("POST /api/invoices — paid mode", () => {
  it("creates a SENT invoice, pays the whole total through recordPaymentInTx, no gateway call", async () => {
    const { prisma } = await setup();
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    const res = await POST(makeReq(paidBody({ reference: "  KW-001 ", notes: "Tunai di loket" })) as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      id: "inv-new",
      status: "PAID",
      paid: true,
      xenditPaymentUrl: null,
    });
    expect(json.replayed).toBeUndefined();

    // Marked sent (D3) with the server-derived total, billing parent kept.
    const createArgs = txMock.invoice.create.mock.calls[0]?.[0];
    expect(createArgs?.data.status).toBe("SENT");
    expect(createArgs?.data.sentAt).toBeInstanceOf(Date);
    expect(Number(createArgs?.data.totalDue)).toBe(1_500_000);
    expect(createArgs?.data.parentId).toBe("p-1");

    // One payment for the whole total, link policy clear-link, same tx handed through.
    expect(mocks.recordPaymentInTx).toHaveBeenCalledTimes(1);
    const [txArg, input] = mocks.recordPaymentInTx.mock.calls[0];
    expect(txArg).toBe(txMock);
    expect(input).toMatchObject({
      invoiceId: "inv-new",
      tenantId: "tnt-1",
      actorId: "u-1",
      method: "CASH",
      reference: "KW-001",
      notes: "Tunai di loket",
      paidAt: null, // today keeps the real time of day
      idempotencyKey: KEY,
      todayYmd: today,
      linkPolicy: "clear-link",
    });
    expect(String(input.amount)).toBe("1500000");
    expect(input.requestHash).toMatch(/^[0-9a-f]{64}$/);

    // No link, no email: the gateway helper is never touched and nothing is written after commit.
    expect(createPaymentSessionForInvoice).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toEqual({ timeout: 15000 });
    expect(revalidateTag).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("student-invoices", { expire: 0 });
    // The create-lock runs first, before any write.
    expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("audits the created invoice inside the transaction", async () => {
    await setup();
    await POST(makeReq(paidBody()) as never);

    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    const [entry, txArg] = mocks.recordAudit.mock.calls[0];
    expect(txArg).toBe(txMock);
    expect(entry).toMatchObject({
      tenantId: "tnt-1",
      actorId: "u-1",
      entity: "Invoice",
      entityId: "inv-new",
      action: "create",
      after: {
        periodLabel: "Biaya Sekolah Tahap 1 TA 2027/2028",
        totalDue: "1500000",
        status: "PAID",
        paid: true,
      },
    });
    expect(entry.after.invoiceNumber).toMatch(/^INV-\d{4}-0001$/);
  });

  it("forwards a back-dated paidAt as 00:00 Asia/Jakarta of that day", async () => {
    await setup();
    const three = ymdOffset(-3);
    const res = await POST(makeReq(paidBody({ paidAt: three })) as never);
    expect(res.status).toBe(201);

    const input = mocks.recordPaymentInTx.mock.calls[0][1];
    expect(input.paidAt).toBeInstanceOf(Date);
    expect((input.paidAt as Date).toISOString()).toBe(new Date(`${three}T00:00:00+07:00`).toISOString());
  });

  it("replays the same key and body: 200, nothing created, nothing paid", async () => {
    await setup();
    const body = paidBody({ reference: "KW-001" });
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          studentId: "s-1",
          periodLabel: "Biaya Sekolah Tahap 1 TA 2027/2028",
          dueDate: "2027-07-31",
          lines: unpaidBody.lines,
          method: "CASH",
          paidAt: today,
          reference: "KW-001",
          notes: null,
        }),
      )
      .digest("hex");
    txMock.payment.findFirst.mockResolvedValue({ invoiceId: "inv-first", requestHash: hash, invoice: { id: "inv-first" } });

    const res = await POST(makeReq(body) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(txMock.payment.findFirst).toHaveBeenCalledWith({
      where: { idempotencyKey: KEY, invoice: { tenantId: "tnt-1" } },
      include: { invoice: true },
    });
    expect(txMock.invoice.create).not.toHaveBeenCalled();
    expect(mocks.recordPaymentInTx).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("returns 409 when the same key arrives with different details", async () => {
    await setup();
    txMock.payment.findFirst.mockResolvedValue({ invoiceId: "inv-first", requestHash: "different", invoice: {} });

    const res = await POST(makeReq(paidBody()) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/dicatat dengan rincian berbeda/);
    expect(txMock.invoice.create).not.toHaveBeenCalled();
    expect(mocks.recordPaymentInTx).not.toHaveBeenCalled();
  });

  it("maps a PaymentError from the shared function to a 4xx (the transaction is abandoned)", async () => {
    await setup();
    mocks.recordPaymentInTx.mockRejectedValue(new PaymentError("PAID"));
    const res = await POST(makeReq(paidBody()) as never);
    expect(res.status).toBe(409);

    mocks.recordPaymentInTx.mockRejectedValue(new PaymentError("OVERPAYMENT", "Jumlah melebihi sisa"));
    const res2 = await POST(makeReq(paidBody()) as never);
    expect(res2.status).toBe(400);
    expect((await res2.json()).errors[0]).toEqual({ field: "payment", message: "Jumlah melebihi sisa" });
  });

  it("refuses a gateway method with the message on payment.method", async () => {
    const { prisma } = await setup();
    for (const method of ["DOKU", "XENDIT"]) {
      const res = await POST(makeReq(paidBody({ method })) as never);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.errors).toEqual([{ field: "payment.method", message: "Pilih Tunai, Transfer Bank, atau Lainnya." }]);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a future paidAt on payment.paidAt", async () => {
    await setup();
    const res = await POST(makeReq(paidBody({ paidAt: ymdOffset(1) })) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors).toEqual([{ field: "payment.paidAt", message: "Tanggal bayar tidak boleh di masa depan." }]);
  });

  it("refuses a missing paidAt and a missing idempotency key", async () => {
    await setup();
    const res = await POST(makeReq(paidBody({ paidAt: undefined })) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).errors.map((e: { field: string }) => e.field)).toContain("payment.paidAt");

    const res2 = await POST(makeReq(paidBody({ idempotencyKey: "not-a-uuid" })) as never);
    expect(res2.status).toBe(400);
    expect((await res2.json()).errors.map((e: { field: string }) => e.field)).toContain("payment.idempotencyKey");
  });

  it("an admin with invoices.create but not payments.record gets 403 in paid mode, and unpaid mode still works", async () => {
    const { prisma } = await setup({
      ...adminSession,
      role: "SCHOOL_ADMIN",
      permissions: ["invoices.create"],
    });
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    const res = await POST(makeReq(paidBody()) as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", missing: "payments.record" });
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    // Unpaid mode needs only invoices.create.
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({ paymentUrl: "https://x/y", created: true } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    const res2 = await POST(makeReq(unpaidBody) as never);
    expect(res2.status).toBe(201);
  });

  it("needs both permissions: payments.record alone is not enough", async () => {
    const { prisma } = await setup({
      ...adminSession,
      role: "SCHOOL_ADMIN",
      permissions: ["payments.record"],
    });
    const res = await POST(makeReq(paidBody()) as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", missing: "invoices.create" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("scopes the student lookup to the caller's tenant: another tenant's student is a 400", async () => {
    const { prisma } = await setup();
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

    const res = await POST(makeReq(paidBody()) as never);
    expect(res.status).toBe(400);
    expect(prisma.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s-1", tenantId: "tnt-1", status: "ACTIVE" } }),
    );
    // Short-circuits before the fee lookup.
    expect(prisma.feeComponentDef.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.recordPaymentInTx).not.toHaveBeenCalled();
  });

  it("still retries an invoice-number P2002 in paid mode and pays only once", async () => {
    await setup();
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["tenantId", "invoiceNumber"] },
    });
    txMock.invoice.create.mockReset();
    txMock.invoice.create.mockRejectedValueOnce(p2002).mockResolvedValueOnce({ id: "inv-new" });

    const res = await POST(makeReq(paidBody()) as never);
    expect(res.status).toBe(201);
    expect(txMock.invoice.create).toHaveBeenCalledTimes(2);
    // The failed attempt threw before the payment step, so one payment total.
    expect(mocks.recordPaymentInTx).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/invoices — rate limit, audit and validation shape (both modes)", () => {
  it("returns 429 with an Indonesian message when the create-invoice limit is hit", async () => {
    const { prisma } = await setup();
    mocks.rateLimit.mockReturnValue({ success: false, remaining: 0 });

    const res = await POST(makeReq(unpaidBody) as never);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Terlalu banyak/);
    expect(mocks.rateLimit).toHaveBeenCalledWith("create-invoice:u-1", 30, 60_000);
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it("validation failures use the { error, errors: [{ field, message }] } envelope", async () => {
    await setup();
    const res = await POST(makeReq({ ...unpaidBody, lines: [] }) as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validasi gagal");
    expect(json.errors).toEqual([{ field: "lines", message: "Tambahkan minimal satu komponen" }]);
  });
});

describe("POST /api/invoices — unpaid mode regression", () => {
  it("still creates PENDING_PAYMENT_LINK, calls the gateway, audits, and never pays", async () => {
    const { prisma } = await setup();
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({ paymentUrl: "https://x/y", created: true } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-new",
      invoiceNumber: "INV-2026-0001",
      totalDue: 1_500_000,
      status: "SENT",
      xenditPaymentUrl: "https://x/y",
      xenditSessionId: "s",
      paymentLinkError: null,
      lines: [],
    } as never);

    const res = await POST(makeReq(unpaidBody) as never);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("SENT");
    expect(json.paid).toBeUndefined();

    expect(createPaymentSessionForInvoice).toHaveBeenCalledWith("inv-new", "tnt-1", "http://localhost:3000");
    const createArgs = txMock.invoice.create.mock.calls[0]?.[0];
    expect(createArgs?.data.status).toBe("PENDING_PAYMENT_LINK");
    expect(createArgs?.data.sentAt).toBeUndefined();
    expect(mocks.recordPaymentInTx).not.toHaveBeenCalled();
    expect(txMock.$executeRaw).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toBeUndefined();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "Invoice",
        action: "create",
        entityId: "inv-new",
        after: expect.objectContaining({ status: "PENDING_PAYMENT_LINK", paid: false, totalDue: "1500000" }),
      }),
      txMock,
    );
  });
});
