import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  recompute: vi.fn(),
  scheduleRelink: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/finance/invoice-payment-state", () => ({
  recomputeInvoiceFromPayments: mocks.recompute,
}));
// ensure-link pulls in the real Prisma client; stand in for it. `scheduleRelink` is a spy so the
// suite can assert recordPaymentInTx never calls it.
vi.mock("@/lib/payments/ensure-link", () => ({
  scheduleRelink: mocks.scheduleRelink,
  staleLinkCleared: (now: Date) => ({
    xenditSessionId: null,
    xenditPaymentUrl: null,
    paymentLinkExpiresAt: null,
    paymentLinkError: null,
    paymentCheckedAt: now,
  }),
}));

import { PaymentError, recordPaymentInTx, type RecordPaymentInput } from "../record-payment";
import { LINK_CLEARED } from "@/lib/payments/link-cleared";

const D = (v: number | string) => new Prisma.Decimal(v);

function makeTx(invoice: Record<string, unknown> | null, existingPayment: Record<string, unknown> | null = null) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue(existingPayment),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "pay-1",
        ...data,
      })),
    },
  };
}

const INVOICE = {
  id: "inv-1",
  status: "SENT",
  totalDue: D(1_000_000),
  totalPaid: D(0),
  dueDate: "2026-11-30",
  sentAt: new Date("2026-10-01"),
  xenditPaymentUrl: "https://pay.example/x",
  paymentLinkError: null,
};

const base: RecordPaymentInput = {
  invoiceId: "inv-1",
  tenantId: "t-1",
  actorId: "u-1",
  amount: D(400_000),
  method: "CASH",
  reference: null,
  notes: null,
  paidAt: null,
  todayYmd: "2026-10-27",
  linkPolicy: "relink-if-owing",
};

const run = (tx: ReturnType<typeof makeTx>, input: Partial<RecordPaymentInput> = {}) =>
  recordPaymentInTx(tx as never, { ...base, ...input });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recompute.mockResolvedValue({ status: "PARTIALLY_PAID", totalPaid: D(400_000) });
});

describe("recordPaymentInTx", () => {
  it("happy path: locks, creates the payment, recomputes, audits", async () => {
    const tx = makeTx(INVOICE);
    const r = await run(tx, { reference: "REF", notes: "n" });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: {
        invoiceId: "inv-1",
        amount: base.amount,
        method: "CASH",
        reference: "REF",
        notes: "n",
        createdBy: "u-1",
      },
    });
    expect(mocks.recompute).toHaveBeenCalledWith(tx, INVOICE, "2026-10-27");
    expect(r.replayed).toBe(false);
    expect(r.payment.id).toBe("pay-1");
    expect(r.invoiceStatus).toBe("PARTIALLY_PAID");
    expect(r.totalPaid.toString()).toBe("400000");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      {
        tenantId: "t-1",
        actorId: "u-1",
        entity: "Payment",
        entityId: "pay-1",
        action: "record",
        before: { invoiceStatus: "SENT", totalPaid: "0" },
        after: {
          invoiceId: "inv-1",
          amount: "400000",
          method: "CASH",
          invoiceStatus: "PARTIALLY_PAID",
          totalPaid: "400000",
        },
      },
      tx,
    );
  });

  it("stores the idempotency key and request hash only when a key is given", async () => {
    const tx = makeTx(INVOICE);
    await run(tx, { idempotencyKey: "k-1", requestHash: "h-1" });
    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({ idempotencyKey: "k-1", requestHash: "h-1" });
    const tx2 = makeTx(INVOICE);
    await run(tx2, { requestHash: "h-1" });
    expect(tx2.payment.create.mock.calls[0][0].data).not.toHaveProperty("idempotencyKey");
    expect(tx2.payment.create.mock.calls[0][0].data).not.toHaveProperty("requestHash");
  });

  it("throws NOT_FOUND when the invoice is gone", async () => {
    const tx = makeTx(null);
    await expect(run(tx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("throws OVERPAYMENT with the field message and writes nothing", async () => {
    const tx = makeTx({ ...INVOICE, totalPaid: D(800_000) });
    const err = await run(tx, { amount: D(300_000) }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.code).toBe("OVERPAYMENT");
    expect(err.msg).toMatch(/^Jumlah pembayaran \(.+\) melebihi sisa tagihan \(.+\)$/);
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("throws PAID and CANCELLED for those invoices", async () => {
    const paid = makeTx({ ...INVOICE, status: "PAID" });
    await expect(run(paid)).rejects.toMatchObject({ code: "PAID" });
    const cancelled = makeTx({ ...INVOICE, status: "CANCELLED" });
    await expect(run(cancelled)).rejects.toMatchObject({ code: "CANCELLED" });
    expect(paid.payment.create).not.toHaveBeenCalled();
    expect(cancelled.payment.create).not.toHaveBeenCalled();
  });

  it("idempotent replay returns the existing payment and creates nothing", async () => {
    const existing = { id: "pay-0", requestHash: "h-1", amount: D(400_000) };
    const tx = makeTx({ ...INVOICE, status: "PARTIALLY_PAID", totalPaid: D(400_000) }, existing);
    const r = await run(tx, { idempotencyKey: "k-1", requestHash: "h-1" });

    expect(r).toMatchObject({ replayed: true, relink: false, invoiceStatus: "PARTIALLY_PAID" });
    expect(r.payment).toBe(existing);
    expect(r.totalPaid.toString()).toBe("400000");
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(mocks.recompute).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("replay is checked before the PAID guard (the first request may have settled it)", async () => {
    const existing = { id: "pay-0", requestHash: "h-1" };
    const tx = makeTx({ ...INVOICE, status: "PAID", totalPaid: D(1_000_000) }, existing);
    const r = await run(tx, { idempotencyKey: "k-1", requestHash: "h-1" });
    expect(r.replayed).toBe(true);
  });

  it("replay with a different hash throws RETRY_MISMATCH", async () => {
    const tx = makeTx(INVOICE, { id: "pay-0", requestHash: "other" });
    await expect(run(tx, { idempotencyKey: "k-1", requestHash: "h-1" })).rejects.toMatchObject({
      code: "RETRY_MISMATCH",
    });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("a back-dated payment stores paidAt and stamps the invoice when it becomes PAID", async () => {
    const backdated = new Date("2026-10-20T00:00:00+07:00");
    mocks.recompute.mockResolvedValue({ status: "PAID", totalPaid: D(1_000_000) });
    const tx = makeTx(INVOICE);
    await run(tx, { amount: D(1_000_000), paidAt: backdated });

    expect(tx.payment.create.mock.calls[0][0].data.paidAt).toBe(backdated);
    expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { paidAt: backdated } });
  });

  it("a back-dated payment that does not settle the invoice does not stamp it", async () => {
    const backdated = new Date("2026-10-20T00:00:00+07:00");
    const tx = makeTx(INVOICE);
    await run(tx, { paidAt: backdated });
    expect(tx.invoice.update).not.toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { paidAt: backdated } });
  });

  describe("relink-if-owing", () => {
    it("clears the stale link and reports relink=true while the invoice still owes", async () => {
      const tx = makeTx(INVOICE);
      const r = await run(tx);
      expect(r.relink).toBe(true);
      expect(tx.invoice.update).toHaveBeenCalledTimes(1);
      expect(tx.invoice.update).toHaveBeenCalledWith({
        where: { id: "inv-1" },
        data: expect.objectContaining({ ...LINK_CLEARED, paymentLinkError: null }),
      });
    });

    it("leaves link fields untouched and reports relink=false once settled", async () => {
      mocks.recompute.mockResolvedValue({ status: "PAID", totalPaid: D(1_000_000) });
      const tx = makeTx(INVOICE);
      const r = await run(tx, { amount: D(1_000_000) });
      expect(r.relink).toBe(false);
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });
  });

  describe("clear-link", () => {
    it("writes LINK_CLEARED and reports relink=false while the invoice still owes", async () => {
      const tx = makeTx(INVOICE);
      const r = await run(tx, { linkPolicy: "clear-link" });
      expect(r.relink).toBe(false);
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { ...LINK_CLEARED, paymentLinkError: null } });
    });

    it("writes LINK_CLEARED when the invoice is settled too", async () => {
      mocks.recompute.mockResolvedValue({ status: "PAID", totalPaid: D(1_000_000) });
      const tx = makeTx(INVOICE);
      const r = await run(tx, { linkPolicy: "clear-link", amount: D(1_000_000) });
      expect(r.relink).toBe(false);
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { ...LINK_CLEARED, paymentLinkError: null } });
    });
  });

  it("clear-link stamps sentAt on an invoice that was never sent, so a later reversal falls back to Terkirim", async () => {
    const tx = makeTx({ ...INVOICE, sentAt: null, xenditPaymentUrl: null, paymentLinkError: "unknown: gagal" });
    await run(tx, { linkPolicy: "clear-link" });
    expect(tx.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { ...LINK_CLEARED, paymentLinkError: null, sentAt: expect.any(Date) },
    });
  });

  it("never schedules a relink, whatever the policy", async () => {
    await run(makeTx(INVOICE), { linkPolicy: "relink-if-owing" });
    await run(makeTx(INVOICE), { linkPolicy: "clear-link" });
    expect(mocks.scheduleRelink).not.toHaveBeenCalled();
  });
});
