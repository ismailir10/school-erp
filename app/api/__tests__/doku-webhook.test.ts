// Webhook handler contract tests for POST /api/doku/webhook.
// Mirrors app/api/__tests__/xendit-webhook.test.ts in mocking style — mocks
// @/lib/db so no real DB hits, and uses the same FakeP2002/FakeDecimal shims
// for @/lib/generated/prisma/client.
//
// Cycle 2026-07-27-doku-payment-gateway T4 contract:
//  - Rate limit (60/min/IP) before signature verification.
//  - Signature verified via HMAC-SHA256 over Client-Id/Request-Id/
//    Request-Timestamp/Request-Target/Digest, tried against candidate (b)
//    `new URL(req.url).pathname` and candidate (c) the full URL with query
//    stripped — both must be accepted.
//  - Raw body read once as text; the same bytes are used for both the
//    digest and JSON.parse (AC-6 applies symmetrically to inbound).
//  - transaction.status SUCCESS -> credit via the shared webhook-processor
//    (method: "DOKU"); FAILED/VOIDED -> IGNORED:status_not_completed;
//    REFUNDED -> ERROR:REFUND_UNHANDLED (AC-14, never silently ignored);
//    anything else -> IGNORED:status_not_handled.
//  - AC-13a: two distinct original_request_id values crediting the same
//    invoice must never silently double-credit — the second is flagged
//    OVERPAYMENT_FLAGGED.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildDigest, buildSignature } from "@/lib/payments/doku/signature";

const SECRET = "test-doku-secret-key-for-webhook-tests-32";
process.env.DOKU_SECRET_KEY = SECRET;

const WEBHOOK_URL = "http://localhost/api/doku/webhook";
const CLIENT_ID = "BRN-0249-test-client";

vi.mock("@/lib/generated/prisma/client", () => {
  // Defined inside the factory because vi.mock is hoisted; outer-scope refs
  // are not yet initialized when the factory runs.
  class FakeP2002 extends Error {
    code = "P2002";
    clientVersion = "test";
    meta = {};
    constructor(msg = "Unique constraint failed") {
      super(msg);
    }
  }
  // Minimal Decimal shim — webhook-processor + sumDecimals use add / gte / gt.
  class FakeDecimal {
    private n: number;
    constructor(v: unknown) {
      this.n = typeof v === "number" ? v : Number(v);
    }
    add(other: unknown): FakeDecimal {
      return new FakeDecimal(this.n + new FakeDecimal(other).n);
    }
    greaterThanOrEqualTo(other: unknown): boolean {
      return this.n >= new FakeDecimal(other).n;
    }
    gte(other: unknown): boolean {
      return this.n >= new FakeDecimal(other).n;
    }
    gt(other: unknown): boolean {
      return this.n > new FakeDecimal(other).n;
    }
    toString(): string {
      return String(this.n);
    }
    toNumber(): number {
      return this.n;
    }
  }
  return {
    Prisma: { PrismaClientKnownRequestError: FakeP2002, Decimal: FakeDecimal },
  };
});

// Re-derive a class with the same shape for use in test bodies (rejecting
// with `new FakeP2002()` so the handler's instanceof check matches the mock).
import { Prisma } from "@/lib/generated/prisma/client";
const FakeP2002 = Prisma.PrismaClientKnownRequestError as unknown as new (
  msg?: string,
) => Error;

vi.mock("@/lib/db", () => ({
  prisma: {
    webhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    invoice: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    payment: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { POST } from "../doku/webhook/route";

/** Build the DOKU notification envelope shape (T4 spec Part B, step 5). */
function makeNotification(overrides: {
  transaction?: Record<string, unknown>;
  order?: Record<string, unknown>;
  channel?: Record<string, unknown>;
} = {}) {
  return {
    service: { id: "VIRTUAL_ACCOUNT" },
    acquirer: { id: "BCA" },
    channel: { id: "VIRTUAL_ACCOUNT_BCA", ...(overrides.channel ?? {}) },
    transaction: {
      status: "SUCCESS",
      date: "2026-07-27T10:00:00Z",
      original_request_id: "req-default",
      ...(overrides.transaction ?? {}),
    },
    order: {
      invoice_number: "inv1",
      amount: 1000,
      ...(overrides.order ?? {}),
    },
  };
}

/** Build the four DOKU auth headers for a given raw body + target. */
function signedHeaders(
  rawBody: string,
  opts: {
    target: string;
    clientId?: string | null;
    requestId?: string | null;
    timestamp?: string;
    secretKey?: string;
    useResponseTimestampHeader?: boolean;
    omitSignature?: boolean;
  },
): Record<string, string> {
  const clientId = opts.clientId === undefined ? CLIENT_ID : opts.clientId;
  const requestId = opts.requestId === undefined ? "req-id-1" : opts.requestId;
  const timestamp = opts.timestamp ?? "2026-07-27T10:00:00Z";
  const secretKey = opts.secretKey ?? SECRET;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientId !== null) headers["Client-Id"] = clientId;
  if (requestId !== null) headers["Request-Id"] = requestId;
  if (opts.useResponseTimestampHeader) headers["Response-Timestamp"] = timestamp;
  else headers["Request-Timestamp"] = timestamp;

  if (!opts.omitSignature && clientId !== null && requestId !== null) {
    const digest = buildDigest(rawBody);
    headers["Signature"] = buildSignature({
      clientId,
      requestId,
      timestamp,
      target: opts.target,
      digest,
      secretKey,
    });
  }
  return headers;
}

function makeReq(
  rawBody: string,
  headers: Record<string, string>,
  ip?: string,
): Request {
  const h = { ...headers };
  if (ip) h["x-forwarded-for"] = ip;
  return new Request(WEBHOOK_URL, { method: "POST", headers: h, body: rawBody });
}

describe("POST /api/doku/webhook (T4 contract)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as never);
    vi.mocked(prisma.webhookEvent.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $queryRaw: prisma.$queryRaw,
          invoice: prisma.invoice,
          payment: prisma.payment,
        }),
    );
  });

  it("valid signature (candidate b: pathname) credits the payment — Payment.method=DOKU, invoice PAID", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
    } as never);
    const txPaymentCreate = vi.fn().mockResolvedValue({ id: "p1" });
    const txInvoiceUpdate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "SENT",
              totalDue: 1000,
              totalPaid: 0,
            }),
            update: txInvoiceUpdate,
          },
          payment: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: txPaymentCreate,
            findMany: vi.fn().mockResolvedValue([{ amount: 1000 }]),
          },
        }),
    );

    const notification = makeNotification({
      transaction: { status: "SUCCESS", original_request_id: "req-ok-1" },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "PAID" });

    expect(txPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceId: "inv1",
          amount: 1000,
          method: "DOKU",
          xenditPaymentId: "req-ok-1",
          reference: "req-ok-1",
          // The rail DOKU reported is kept, so the invoice can say "Virtual Account BCA".
          channelCode: "VIRTUAL_ACCOUNT_BCA",
        }),
      }),
    );
    expect(txInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv1" },
        data: expect.objectContaining({ status: "PAID" }),
      }),
    );
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "req-ok-1" },
        data: expect.objectContaining({ status: "PROCESSED", invoiceId: "inv1" }),
      }),
    );
  });

  it("signature computed against candidate c (full URL, query stripped) is also accepted", async () => {
    const notification = makeNotification({
      transaction: { status: "FAILED", original_request_id: "req-cand-c" },
    });
    const rawBody = JSON.stringify(notification);
    // Candidate (c): origin + pathname, matching `stripQuery(req.url)`.
    const headers = signedHeaders(rawBody, {
      target: "http://localhost/api/doku/webhook",
    });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
  });

  it("wrong secret → 401, and NO WebhookEvent row is created", async () => {
    const { prisma } = await import("@/lib/db");
    const notification = makeNotification();
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, {
      target: "/api/doku/webhook",
      secretKey: "definitely-the-wrong-secret",
    });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(401);
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it("missing Signature header → 401", async () => {
    const notification = makeNotification();
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, {
      target: "/api/doku/webhook",
      omitSignature: true,
    });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(401);
  });

  it("missing DOKU_SECRET_KEY → 401", async () => {
    const original = process.env.DOKU_SECRET_KEY;
    delete process.env.DOKU_SECRET_KEY;
    try {
      const notification = makeNotification();
      const rawBody = JSON.stringify(notification);
      const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });
      const res = await POST(makeReq(rawBody, headers) as never);
      expect(res.status).toBe(401);
    } finally {
      process.env.DOKU_SECRET_KEY = original;
    }
  });

  it("61st request from one IP inside a minute → 429 before signature verification", async () => {
    const ip = "203.0.113.201"; // dedicated IP so other tests' quota is untouched
    const flood = () => makeReq("not-json{{", { "Content-Type": "application/json" }, ip);
    let last: Response | null = null;
    for (let i = 0; i < 60; i++) {
      last = await POST(flood() as never);
      expect(last.status).toBe(401); // no auth headers — but not yet throttled
    }
    const throttled = await POST(flood() as never);
    expect(throttled.status).toBe(429);
  });

  it("malformed JSON body (post-signature) → 400", async () => {
    const rawBody = "not-json{{";
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });
    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(400);
  });

  it("duplicate original_request_id (P2002) → 200 { duplicate: true }", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.webhookEvent.create).mockRejectedValueOnce(new FakeP2002());
    const notification = makeNotification({
      transaction: { status: "SUCCESS", original_request_id: "req-dup" },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it('transaction.status "FAILED" → IGNORED, no payment row', async () => {
    const { prisma } = await import("@/lib/db");
    const notification = makeNotification({
      transaction: { status: "FAILED", original_request_id: "req-failed" },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "req-failed" },
        data: expect.objectContaining({
          status: "IGNORED",
          errorMessage: "status_not_completed",
        }),
      }),
    );
  });

  it('transaction.status "REFUNDED" → ERROR REFUND_UNHANDLED, no payment row (AC-14)', async () => {
    const { prisma } = await import("@/lib/db");
    const notification = makeNotification({
      transaction: { status: "REFUNDED", original_request_id: "req-refund" },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ error: "REFUND_UNHANDLED" });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "req-refund" },
        data: expect.objectContaining({
          status: "ERROR",
          errorMessage: "REFUND_UNHANDLED",
        }),
      }),
    );
  });

  it("absent currency still credits the payment", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
    } as never);
    const txPaymentCreate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "SENT",
              totalDue: 1000,
              totalPaid: 0,
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          payment: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: txPaymentCreate,
            findMany: vi.fn().mockResolvedValue([{ amount: 1000 }]),
          },
        }),
    );

    // No `transaction.amount_details` at all — currency must stay null and
    // still credit (only a PRESENT non-IDR currency should refuse).
    const notification = makeNotification({
      transaction: { status: "SUCCESS", original_request_id: "req-no-currency" },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "PAID" });
    expect(txPaymentCreate).toHaveBeenCalled();
  });

  it('currency "USD" → CURRENCY_MISMATCH, no credit', async () => {
    const { prisma } = await import("@/lib/db");
    const notification = makeNotification({
      transaction: {
        status: "SUCCESS",
        original_request_id: "req-usd",
        amount_details: { currency: "USD" },
      },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ERROR:currency_mismatch" });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "req-usd" },
        data: expect.objectContaining({
          status: "ERROR",
          errorMessage: "CURRENCY_MISMATCH:USD",
        }),
      }),
    );
  });

  it("float amount 20000.00 credits as 20000", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      totalDue: 20000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
    } as never);
    const txPaymentCreate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "SENT",
              totalDue: 20000,
              totalPaid: 0,
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          payment: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: txPaymentCreate,
            findMany: vi.fn().mockResolvedValue([{ amount: 20000 }]),
          },
        }),
    );

    const notification = makeNotification({
      transaction: { status: "SUCCESS", original_request_id: "req-float" },
      order: { invoice_number: "inv1", amount: 20000.0 },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });

    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "PAID" });
    expect(txPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 20000 }),
      }),
    );
  });

  it("AC-13a — two distinct original_request_id values crediting the same invoice: first PAYs, second is OVERPAYMENT_FLAGGED (never two silent credits)", async () => {
    const { prisma } = await import("@/lib/db");

    // ── Notification 1: partial payment (400,000 of 1,000,000 due). ──
    vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce({
      id: "inv1",
      status: "SENT",
      totalDue: 1_000_000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
    } as never);
    const tx1InvoiceUpdate = vi.fn().mockResolvedValue({});
    const tx1PaymentCreate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "SENT",
              totalDue: 1_000_000,
              totalPaid: 0,
              dueDate: "2999-12-31",
            }),
            update: tx1InvoiceUpdate,
          },
          payment: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: tx1PaymentCreate,
            findMany: vi.fn().mockResolvedValue([{ amount: 400_000 }]),
          },
        }),
    );

    const notification1 = makeNotification({
      transaction: { status: "SUCCESS", original_request_id: "req-va-1" },
      order: { invoice_number: "inv1", amount: 400_000 },
    });
    const rawBody1 = JSON.stringify(notification1);
    const headers1 = signedHeaders(rawBody1, { target: "/api/doku/webhook" });
    const res1 = await POST(makeReq(rawBody1, headers1) as never);
    expect(res1.status).toBe(200);
    expect(await res1.json()).toMatchObject({ status: "PARTIALLY_PAID" });
    expect(tx1PaymentCreate).toHaveBeenCalledTimes(1);
    expect(tx1InvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PARTIALLY_PAID" }) }),
    );
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "req-va-1" },
        data: expect.objectContaining({ status: "PROCESSED" }),
      }),
    );

    // ── Notification 2: a DIFFERENT VA session's payment (700,000) for the
    // same invoice — a genuinely distinct original_request_id. Combined with
    // notification 1 this exceeds totalDue, so it must be flagged, not
    // silently absorbed into a second unflagged credit. ──
    vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce({
      id: "inv1",
      status: "PARTIALLY_PAID",
      totalDue: 1_000_000,
      totalPaid: 400_000,
      invoiceNumber: "INV-1",
    } as never);
    const tx2InvoiceUpdate = vi.fn().mockResolvedValue({});
    const tx2PaymentCreate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "PARTIALLY_PAID",
              totalDue: 1_000_000,
              totalPaid: 400_000,
            }),
            update: tx2InvoiceUpdate,
          },
          payment: {
            // Distinct paymentId (xenditPaymentId key) — the inner
            // idempotency lookup misses, so this is NOT a duplicate-delivery
            // short-circuit; it is a genuinely second payment.
            findUnique: vi.fn().mockResolvedValue(null),
            create: tx2PaymentCreate,
            findMany: vi
              .fn()
              .mockResolvedValue([{ amount: 400_000 }, { amount: 700_000 }]),
          },
        }),
    );

    const notification2 = makeNotification({
      transaction: { status: "SUCCESS", original_request_id: "req-va-2" },
      order: { invoice_number: "inv1", amount: 700_000 },
    });
    const rawBody2 = JSON.stringify(notification2);
    const headers2 = signedHeaders(rawBody2, { target: "/api/doku/webhook" });
    const res2 = await POST(makeReq(rawBody2, headers2) as never);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ status: "OVERPAID:PAID" });
    // The second payment IS credited (it really was received)...
    expect(tx2PaymentCreate).toHaveBeenCalledTimes(1);
    // ...but flagged for admin review, not silently folded in unflagged.
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "req-va-2" },
        data: expect.objectContaining({
          status: "ERROR",
          errorMessage: "OVERPAYMENT_FLAGGED",
        }),
      }),
    );
    // Exactly one PAID transition, exactly two Payment.create calls (both
    // genuinely distinct payments), never a duplicate/no-op credit.
    expect(tx1PaymentCreate).toHaveBeenCalledTimes(1);
    expect(tx2PaymentCreate).toHaveBeenCalledTimes(1);
  });

  /**
   * The likelier real-world double-pay shape under Virtual Account: DOKU permits
   * `invoice_number` reuse (A3), so a parent can hold two VA numbers for one
   * invoice and pay BOTH in full. The second, different payment is not credited
   * (it would push totalPaid past totalDue), but it is no longer silent: the
   * decision is made inside the invoice lock and the event is stored as an ERROR
   * so staff see money to refund (cycle 2026-10-21-unrecorded-gateway-payments).
   */
  it("two FULL payments on one invoice: second is not credited and is flagged DUPLICATE_PAYMENT_AFTER_PAID", async () => {
    const { prisma } = await import("@/lib/db");

    const paid = {
      id: "inv1",
      status: "PAID",
      totalDue: 1_000_000,
      totalPaid: 1_000_000,
      invoiceNumber: "INV-1",
    };
    vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce(paid as never);
    const txPaymentCreate = vi.fn();
    const txInvoiceUpdate = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: { findUnique: vi.fn().mockResolvedValue(paid), update: txInvoiceUpdate },
          payment: {
            findUnique: vi.fn().mockResolvedValue(null),
            findMany: vi.fn(),
            create: txPaymentCreate,
          },
        }),
    );

    const notification = makeNotification({
      transaction: { status: "SUCCESS", original_request_id: "req-va-2-full" },
      order: { invoice_number: "inv1", amount: 1_000_000 },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });
    const res = await POST(makeReq(rawBody, headers) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ERROR:duplicate_payment_after_paid" });
    expect(txPaymentCreate).not.toHaveBeenCalled();
    expect(txInvoiceUpdate).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "req-va-2-full" },
        data: expect.objectContaining({ status: "ERROR", errorMessage: "DUPLICATE_PAYMENT_AFTER_PAID" }),
      }),
    );
  });

  it("redelivery: payment id already recorded on a PAID invoice -> PROCESSED, nothing written, not flagged", async () => {
    const { prisma } = await import("@/lib/db");

    const paid = {
      id: "inv1",
      status: "PAID",
      totalDue: 1_000_000,
      totalPaid: 1_000_000,
      invoiceNumber: "INV-1",
    };
    vi.mocked(prisma.invoice.findUnique).mockResolvedValueOnce(paid as never);
    const txPaymentCreate = vi.fn();
    const txInvoiceUpdate = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: { findUnique: vi.fn().mockResolvedValue(paid), update: txInvoiceUpdate },
          payment: {
            // This payment id is already stored: a redelivery, not a second payment.
            findUnique: vi.fn().mockResolvedValue({ id: "p-old" }),
            findMany: vi.fn(),
            create: txPaymentCreate,
          },
        }),
    );

    const notification = makeNotification({
      transaction: { status: "SUCCESS", original_request_id: "req-redeliver" },
      order: { invoice_number: "inv1", amount: 1_000_000 },
    });
    const rawBody = JSON.stringify(notification);
    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });
    const res = await POST(makeReq(rawBody, headers) as never);

    expect(res.status).toBe(200);
    expect(txPaymentCreate).not.toHaveBeenCalled();
    expect(txInvoiceUpdate).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "req-redeliver" },
        data: expect.objectContaining({ status: "PROCESSED", invoiceId: "inv1" }),
      }),
    );
    expect(prisma.webhookEvent.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERROR" }) }),
    );
  });

  it("digest is computed over the exact received bytes — unusual key order/whitespace still verifies", async () => {
    // Hand-assemble a body string with non-canonical whitespace and key
    // order (NOT what JSON.stringify would produce) to prove the digest is
    // computed over the literal bytes received, not a re-serialisation.
    const rawBody =
      '{\n  "channel":   {"id":"VIRTUAL_ACCOUNT_BCA"},\n  "order":{"amount":1000,   "invoice_number": "inv1"},\n  "transaction":  {"original_request_id":"req-ws","status":"FAILED"}\n}';
    // Sanity: this parses to the same logical shape but is NOT byte-identical
    // to JSON.stringify(JSON.parse(rawBody)).
    expect(rawBody).not.toBe(JSON.stringify(JSON.parse(rawBody)));

    const headers = signedHeaders(rawBody, { target: "/api/doku/webhook" });
    const res = await POST(makeReq(rawBody, headers) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
  });
});
