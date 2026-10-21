/**
 * The shared webhook processor credits a pendaftaran fee (EnrollmentFee) when
 * the gateway reference is not an Invoice — cycle 2026-10-10-pendaftaran-fee-payment.
 * Invoice behaviour is covered by app/api/__tests__/doku-webhook.test.ts and
 * xendit-webhook.test.ts; here only the fee branch and its precedence rule.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  webhookEvent: { create: vi.fn(), update: vi.fn() },
  invoice: { findUnique: vi.fn(), findFirst: vi.fn() },
  payment: { findUnique: vi.fn() },
  enrollmentFee: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { processPaymentEvent, type NormalizedPaymentEvent } from "../webhook-processor";

const FEE_ID = "fee-1";

function event(over: Partial<NormalizedPaymentEvent> = {}): NormalizedPaymentEvent {
  return {
    provider: "doku",
    eventId: "evt-1",
    eventType: "doku.SUCCESS",
    kind: "PAYMENT_COMPLETED",
    referenceId: FEE_ID,
    sessionId: null,
    paymentId: "pay-1",
    amount: 300_000,
    currency: "IDR",
    channelCode: "VIRTUAL_ACCOUNT_BCA",
    rawPayload: {},
    ...over,
  };
}

/** What was written to the WebhookEvent row last (the outcome). */
const outcome = () => db.webhookEvent.update.mock.calls.at(-1)?.[0]?.data;

/** `enrollmentFee.findUnique` serves two callers: lookup by id, and the paymentId dedup. */
function feeRow(row: Record<string, unknown> | null, opts: { paymentIdTaken?: boolean } = {}) {
  db.enrollmentFee.findUnique.mockImplementation(async (arg: { where: { id?: string; paymentId?: string } }) => {
    if (arg.where.paymentId) return opts.paymentIdTaken ? { id: "other-fee" } : null;
    return row;
  });
}

const unpaid = (amount = 300_000) => ({ id: FEE_ID, status: "UNPAID", amount });

beforeEach(() => {
  vi.clearAllMocks();
  db.webhookEvent.create.mockResolvedValue({});
  db.webhookEvent.update.mockResolvedValue({});
  db.invoice.findUnique.mockResolvedValue(null);
  db.invoice.findFirst.mockResolvedValue(null);
  db.payment.findUnique.mockResolvedValue(null);
  db.enrollmentFee.findFirst.mockResolvedValue(null);
  db.enrollmentFee.update.mockResolvedValue({});
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
  feeRow(unpaid());
});

describe("processPaymentEvent → enrollment fee", () => {
  it("credits an UNPAID fee: PAID, method DOKU, payment id and paid time recorded", async () => {
    const res = await processPaymentEvent(event());
    expect(res.httpStatus).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "PAID" });

    const update = db.enrollmentFee.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: FEE_ID });
    expect(update.data).toMatchObject({ status: "PAID", method: "DOKU", paymentId: "pay-1", linkError: null });
    expect(update.data.paidAt).toBeInstanceOf(Date);
    // Serialised per fee, like invoices.
    expect(db.$executeRaw).toHaveBeenCalled();
    // WebhookEvent.invoiceId is an unconstrained string: fee events carry the FEE
    // id so staff can later find the payments refused for it ("perlu dicek").
    expect(outcome()).toMatchObject({ status: "PROCESSED", invoiceId: FEE_ID });
  });

  it("an Invoice with that reference wins; the fee path is never touched", async () => {
    // The invoice is already Lunas and this very payment is the one recorded: a redelivery.
    db.invoice.findUnique.mockResolvedValue({ id: FEE_ID, status: "PAID", invoiceNumber: "INV-1" });
    db.payment.findUnique.mockResolvedValue({ id: "pay-row" });
    const res = await processPaymentEvent(event());
    expect(res.body).toMatchObject({ status: "PAID:already" });
    expect(db.enrollmentFee.findUnique).not.toHaveBeenCalled();
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
  });

  it("falls back to the stored gateway session id when the reference misses", async () => {
    db.enrollmentFee.findUnique.mockImplementation(async (arg: { where: { id?: string; paymentId?: string } }) => {
      if (arg.where.paymentId) return null;
      return arg.where.id === FEE_ID ? unpaid() : null;
    });
    db.enrollmentFee.findFirst.mockResolvedValue({ id: FEE_ID });
    const res = await processPaymentEvent(event({ referenceId: "unknown", sessionId: "sess-9" }));
    expect(res.body).toMatchObject({ status: "PAID" });
    expect(db.enrollmentFee.findFirst.mock.calls[0][0].where).toEqual({ gatewaySessionId: "sess-9" });
  });

  it("is idempotent: the SAME gateway payment seen again leaves a PAID fee alone and is PROCESSED", async () => {
    feeRow({ id: FEE_ID, status: "PAID", amount: 300_000, paymentId: "pay-1" });
    const res = await processPaymentEvent(event());
    expect(res.body).toMatchObject({ status: "PAID:already" });
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({ status: "PROCESSED" });
  });

  it("a DIFFERENT payment on an already PAID fee is a duplicate charge: flagged ERROR for a refund, nothing changes", async () => {
    // e.g. two live orders under one reference, both paid.
    feeRow({ id: FEE_ID, status: "PAID", amount: 300_000, paymentId: "pay-1" });
    const res = await processPaymentEvent(event({ eventId: "evt-2", paymentId: "pay-2" }));
    expect(res.body).toMatchObject({ status: "ERROR:duplicate_payment_after_paid" });
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({ status: "ERROR", errorMessage: "DUPLICATE_PAYMENT_AFTER_PAID" });
  });

  it("an online payment after staff took cash (paid with no gateway payment id) is flagged for a refund too", async () => {
    feeRow({ id: FEE_ID, status: "PAID", amount: 300_000, paymentId: null });
    const res = await processPaymentEvent(event());
    expect(res.body).toMatchObject({ status: "ERROR:duplicate_payment_after_paid" });
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
  });

  it.each([
    ["an underpayment", 299_000],
    ["an overpayment", 301_000],
    ["a wrong amount", 1_000],
  ])("%s is NOT credited and is flagged AMOUNT_MISMATCH for staff", async (_name, amount) => {
    const res = await processPaymentEvent(event({ amount }));
    expect(res.body).toMatchObject({ status: "ERROR:amount_mismatch" });
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({ status: "ERROR" });
    expect(outcome().errorMessage).toBe(`AMOUNT_MISMATCH:expected=300000;got=${amount}`);
  });

  it("tolerates 1 IDR of gateway rounding either way", async () => {
    expect((await processPaymentEvent(event({ amount: 300_001 }))).body).toMatchObject({ status: "PAID" });
    db.enrollmentFee.update.mockClear();
    expect((await processPaymentEvent(event({ eventId: "evt-2", paymentId: "pay-2", amount: 299_999 }))).body).toMatchObject({
      status: "PAID",
    });
  });

  it("credits against the discounted amount snapshotted on the row, not the base fee", async () => {
    feeRow(unpaid(240_000));
    expect((await processPaymentEvent(event({ amount: 240_000 }))).body).toMatchObject({ status: "PAID" });
    db.enrollmentFee.update.mockClear();
    feeRow(unpaid(240_000));
    expect((await processPaymentEvent(event({ eventId: "evt-3", paymentId: "pay-3", amount: 300_000 }))).body).toMatchObject({
      status: "ERROR:amount_mismatch",
    });
  });

  it("a payment on a WAIVED fee credits nothing and surfaces a refund-needed ERROR", async () => {
    feeRow({ id: FEE_ID, status: "WAIVED", amount: 0 });
    const res = await processPaymentEvent(event());
    expect(res.body).toMatchObject({ status: "ERROR:paid_on_waived_fee" });
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
    expect(outcome().errorMessage).toBe("PAID_ON_WAIVED_FEE");
  });

  it("a gateway payment id already used by another fee never credits a second one", async () => {
    feeRow(unpaid(), { paymentIdTaken: true });
    const res = await processPaymentEvent(event());
    expect(res.body).toMatchObject({ status: "ERROR:duplicate_payment_id" });
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
  });

  it("a fee that vanishes between lookup and lock is an ERROR, not a crash", async () => {
    db.enrollmentFee.findUnique.mockImplementation(async (arg: { where: { id?: string; paymentId?: string } }) =>
      arg.where.paymentId ? null : db.enrollmentFee.findUnique.mock.calls.length <= 1 ? { id: FEE_ID } : null,
    );
    const res = await processPaymentEvent(event());
    expect(res.body).toMatchObject({ status: "ERROR:enrollment_fee_not_found" });
  });

  it("records a Xendit settlement as method XENDIT", async () => {
    await processPaymentEvent(event({ provider: "xendit" }));
    expect(db.enrollmentFee.update.mock.calls[0][0].data.method).toBe("XENDIT");
  });

  it.each([
    ["a zero amount", { amount: 0 }],
    ["a missing amount", { amount: null }],
    ["a non-IDR currency", { currency: "USD" }],
    ["a missing payment id", { paymentId: null }],
  ])("the shared guards still run first: %s never reaches the fee", async (_name, over) => {
    await processPaymentEvent(event(over as Partial<NormalizedPaymentEvent>));
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({ status: "ERROR" });
  });

  it("neither an invoice nor a fee → still INVOICE_NOT_FOUND (unchanged behaviour)", async () => {
    feeRow(null);
    db.enrollmentFee.findUnique.mockResolvedValue(null);
    const res = await processPaymentEvent(event({ referenceId: "nobody" }));
    expect(res.body).toMatchObject({ status: "ERROR:invoice_not_found" });
    expect(outcome().errorMessage).toContain("INVOICE_NOT_FOUND");
  });
});

describe("processPaymentEvent → enrollment fee session expiry", () => {
  const expired = (over: Partial<NormalizedPaymentEvent> = {}) =>
    event({ kind: "SESSION_EXPIRED", eventType: "manual.refresh.expired", paymentId: null, amount: null, ...over });

  it("clears the stored link on an UNPAID fee so the next visit mints a new one", async () => {
    const res = await processPaymentEvent(expired());
    expect(res.body).toMatchObject({ status: "REVERTED" });
    expect(db.enrollmentFee.update.mock.calls[0][0].data).toEqual({
      gatewaySessionId: null,
      paymentUrl: null,
      sessionExpiresAt: null,
    });
    expect(outcome()).toMatchObject({ status: "PROCESSED" });
  });

  it("leaves a PAID fee alone", async () => {
    feeRow({ id: FEE_ID, status: "PAID", amount: 300_000 });
    const res = await processPaymentEvent(expired());
    expect(res.body).toMatchObject({ status: "IGNORED:fee_not_unpaid" });
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
  });

  it("an expiry for the session the fee still holds clears it", async () => {
    feeRow({ ...unpaid(), gatewaySessionId: "sess-current" });
    const res = await processPaymentEvent(expired({ sessionId: "sess-current" }));
    expect(res.body).toMatchObject({ status: "REVERTED" });
    expect(db.enrollmentFee.update).toHaveBeenCalledTimes(1);
  });

  it("an expiry for an OLDER, replaced session must not wipe the newer live link", async () => {
    feeRow({ ...unpaid(), gatewaySessionId: "sess-new" });
    const res = await processPaymentEvent(expired({ sessionId: "sess-old" }));
    expect(res.body).toMatchObject({ status: "IGNORED:stale_session" });
    expect(db.enrollmentFee.update).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({ status: "IGNORED", errorMessage: "expiry of a replaced session" });
  });

  it("an expiry that names no session (DOKU notifications carry none) still clears the link", async () => {
    feeRow({ ...unpaid(), gatewaySessionId: "sess-current" });
    const res = await processPaymentEvent(expired({ sessionId: null }));
    expect(res.body).toMatchObject({ status: "REVERTED" });
  });
});
