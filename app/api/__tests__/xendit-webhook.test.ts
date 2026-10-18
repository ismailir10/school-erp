// Webhook handler contract tests for the rewritten T5 handler.
// Mocks @/lib/db so no real DB hits.
//
// T5 contract (post-rewrite):
//  - Phase 1 INSERT WebhookEvent always; P2002 → 200 short-circuit.
//  - Phase 2 errors mark row ERROR + return 200 (NOT 500 + DELETE).
//  - Phase 1 throws → 500 (no row committed; Xendit retry succeeds).
//  - xenditSessionId fallback when reference_id misses (PR #136 restored).
//  - Missing/zero amount → ERROR:MISSING_AMOUNT, no payment row.
//  - Overpayment > remaining + 1 IDR → credit + ERROR:OVERPAYMENT_FLAGGED.
//  - payment_session.expired → soft-revert SENT/PENDING_PAYMENT_LINK to
//    PENDING_PAYMENT_LINK (NOT destructive CANCELLED); PAID/CANCELLED
//    ignore.
//
// Coverage:
//  1. 401 on missing/mismatched x-callback-token
//  2. 400 on malformed JSON body
//  3. duplicate eventId (P2002) → 200 { duplicate: true }
//  4. payment_session.completed → invoice PAID + Payment row + PROCESSED
//  5. payment_session.expired → soft-revert to PENDING_PAYMENT_LINK
//  6. unknown event → 200 IGNORED, no Invoice mutation
//  7. invoice-not-found → 200 ERROR:invoice_not_found (T5b)
//  8. Phase 2 throw → ERROR row retained, 200 (no DELETE, no 500)
//  9. body.id missing → eventId synthesized with payload sha256 suffix
// 10. T5d missing amount → ERROR:missing_amount + no payment
// 11. T5d overpayment → credit + ERROR:OVERPAYMENT_FLAGGED
// 12. T5c xenditSessionId fallback (real PR #136 staging-tagihan- case)
// 13. T5e expired on PAID → IGNORED:already_paid (no revert)
import { describe, it, expect, vi, beforeEach } from "vitest";

const TOKEN = "test-callback-token-padding-32!!";
process.env.XENDIT_WEBHOOK_TOKEN = TOKEN;

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
  // Minimal Decimal shim — webhook + sumDecimals use add / gte / gt.
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
    // The processor falls back to a pendaftaran fee when no invoice matches
    // (cycle 2026-10-10-pendaftaran-fee-payment); none exists in these tests.
    enrollmentFee: { findUnique: vi.fn(), findFirst: vi.fn() },
    payment: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { POST } from "../xendit/webhook/route";

function makeReq(
  body: unknown,
  token: string | null = TOKEN,
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["x-callback-token"] = token;
  return new Request("http://localhost/api/xendit/webhook", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/xendit/webhook (T5 contract)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.webhookEvent.update).mockResolvedValue({} as never);
    vi.mocked(prisma.webhookEvent.delete).mockResolvedValue({} as never);
    // Default $transaction proxies callback to the same prisma mocks.
    vi.mocked(prisma.$transaction).mockImplementation(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $queryRaw: prisma.$queryRaw,
          invoice: prisma.invoice,
          payment: prisma.payment,
        }),
    );
  });

  it("401 when token is missing", async () => {
    const res = await POST(makeReq({}, null) as never);
    expect(res.status).toBe(401);
  });

  it("401 when token mismatches (same length)", async () => {
    const res = await POST(
      makeReq({ event: "x" }, "wrong-token-padding-of-32-bytes!!") as never,
    );
    expect(res.status).toBe(401);
  });

  it("400 on malformed JSON body", async () => {
    const res = await POST(makeReq("not-json{{") as never);
    expect(res.status).toBe(400);
    const { prisma } = await import("@/lib/db");
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it("duplicate eventId returns { duplicate: true } with 200", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.webhookEvent.create).mockRejectedValueOnce(
      new FakeP2002(),
    );
    const res = await POST(
      makeReq({
        id: "evt-1",
        event: "payment_session.completed",
        data: { reference_id: "inv1", status: "COMPLETED" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it("completed event flips invoice to PAID + creates Payment + marks PROCESSED", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
    } as never);
    // Capture inner-tx spies so we can assert on the actual mutations.
    const txInvoiceUpdate = vi.fn().mockResolvedValue({});
    const txPaymentCreate = vi.fn().mockResolvedValue({ id: "p1" });
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

    const res = await POST(
      makeReq({
        id: "evt-2",
        event: "payment_session.completed",
        data: {
          reference_id: "inv1",
          status: "COMPLETED",
          payment_id: "pay-1",
          amount: 1000,
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "PAID" });
    // Inner-tx mutations actually happened — note both xenditPaymentId
    // (UNIQUE idempotency key) AND reference (display) are written.
    expect(txPaymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceId: "inv1",
          amount: 1000,
          method: "XENDIT",
          xenditPaymentId: "pay-1",
          reference: "pay-1",
        }),
      }),
    );
    expect(txInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv1" },
        // totalPaid is now a Prisma.Decimal (matches FakeDecimal mock); compare
        // via .toString() to keep the assertion implementation-agnostic.
        data: expect.objectContaining({
          status: "PAID",
          totalPaid: expect.objectContaining({
            toString: expect.any(Function),
          }),
        }),
      }),
    );
    const updateCall = txInvoiceUpdate.mock.calls[0][0] as {
      data: { totalPaid: { toString: () => string } };
    };
    expect(updateCall.data.totalPaid.toString()).toBe("1000");
    // Outer audit row marked PROCESSED with invoice link.
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-2" },
        data: expect.objectContaining({
          status: "PROCESSED",
          invoiceId: "inv1",
        }),
      }),
    );
  });

  it("expired event soft-reverts SENT invoice → PENDING_PAYMENT_LINK + nulls xendit fields (T5e)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      invoiceNumber: "INV-1",
    } as never);
    const txInvoiceUpdate = vi.fn().mockResolvedValue({ count: 1 });
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "SENT",
              invoiceNumber: "INV-1",
              dueDate: "2099-01-01",
              xenditSessionId: "sess-1",
              xenditPaymentUrl: "https://checkout.test/sess-1",
            }),
            updateMany: txInvoiceUpdate,
          },
        }),
    );

    const res = await POST(
      makeReq({
        id: "evt-3",
        event: "payment_session.expired",
        data: { reference_id: "inv1", payment_session_id: "sess-1", status: "EXPIRED" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "REVERTED" });
    expect(txInvoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", xenditSessionId: "sess-1", xenditPaymentUrl: "https://checkout.test/sess-1" },
      data: {
        status: "PENDING_PAYMENT_LINK",
        xenditSessionId: null,
        xenditPaymentUrl: null,
      },
    });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-3" },
        data: expect.objectContaining({ status: "PROCESSED" }),
      }),
    );
  });

  it("unknown event returns 200 IGNORED + does not touch invoice", async () => {
    const { prisma } = await import("@/lib/db");
    const res = await POST(
      makeReq({
        id: "evt-4",
        event: "payment_method.activated",
        data: { foo: "bar" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-4" },
        data: expect.objectContaining({ status: "IGNORED" }),
      }),
    );
  });

  it("invoice-not-found on completed → 200 ERROR:invoice_not_found (T5b)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
    const res = await POST(
      makeReq({
        id: "evt-5",
        event: "payment_session.completed",
        data: { reference_id: "missing", status: "COMPLETED", payment_id: "pay-orphan", amount: 100000 },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ERROR:invoice_not_found",
    });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-5" },
        data: expect.objectContaining({ status: "ERROR" }),
      }),
    );
  });

  it("Phase 2 throw retains WebhookEvent + marks ERROR + returns 200 (T5)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
    } as never);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Error("DB went away"),
    );
    const res = await POST(
      makeReq({
        id: "evt-6",
        event: "payment_session.completed",
        data: { reference_id: "inv1", status: "COMPLETED", payment_id: "pay-tx", amount: 1000 },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(prisma.webhookEvent.delete).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-6" },
        data: expect.objectContaining({ status: "ERROR" }),
      }),
    );
  });

  it("inner Payment idempotency: existing xenditPaymentId short-circuits without create", async () => {
    // Two distinct provider deliveries (different eventId wrapper) for the
    // same underlying Xendit payment_id. Outer dedup misses (different
    // eventId), inner findUnique catches it.
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "PARTIALLY_PAID",
      totalDue: 1000,
      totalPaid: 1000,
      invoiceNumber: "INV-1",
    } as never);
    const txPaymentCreate = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "PARTIALLY_PAID",
              totalDue: 1000,
              totalPaid: 1000,
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          payment: {
            // The key assertion: existing row found by xenditPaymentId UNIQUE.
            findUnique: vi.fn().mockResolvedValue({ id: "p-existing" }),
            create: txPaymentCreate,
            findMany: vi.fn(),
          },
        }),
    );

    const res = await POST(
      makeReq({
        id: "evt-dup-payment",
        event: "payment_session.completed",
        data: {
          reference_id: "inv1",
          status: "COMPLETED",
          payment_id: "pay-1",
          amount: 1000,
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    // No payment.create call — existing row short-circuits the tx.
    expect(txPaymentCreate).not.toHaveBeenCalled();
  });

  it("rejects completed event with no payment_id and no payment_session_id", async () => {
    // Without an idempotency key, writing xenditPaymentId: NULL would defeat
    // the UNIQUE dedup (Postgres allows multi-NULL), so the handler must
    // refuse the create and mark the audit row IGNORED.
    const { prisma } = await import("@/lib/db");
    const res = await POST(
      makeReq({
        id: "evt-no-pid",
        event: "payment_session.completed",
        data: {
          reference_id: "inv1",
          status: "COMPLETED",
          // intentionally no payment_id and no payment_session_id
          amount: 1000,
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ERROR:missing_payment_id",
    });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-no-pid" },
        data: expect.objectContaining({ status: "ERROR" }),
      }),
    );
  });

  it("synthesizes eventId with sha256 suffix when body.id missing", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
    await POST(
      makeReq({
        // intentionally no `id` field
        event: "payment_session.completed",
        data: {
          reference_id: "inv1",
          payment_session_id: "ps_x",
          status: "COMPLETED",
        },
      }) as never,
    );
    const arg = vi.mocked(prisma.webhookEvent.create).mock.calls[0]?.[0] as
      | { data: { eventId: string } }
      | undefined;
    expect(arg).toBeDefined();
    expect(arg!.data.eventId).toMatch(
      /^payment_session\.completed:ps_x:COMPLETED:[a-f0-9]{16}$/,
    );
  });

  it.each([
    ["past its due date", "2020-01-31", "OVERDUE"],
    ["not yet due", "2999-12-31", "PARTIALLY_PAID"],
  ])("a partial gateway payment on an invoice %s leaves it %s", async (_label, dueDate, expected) => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
    } as never);
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
              dueDate,
            }),
            update: txInvoiceUpdate,
          },
          payment: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "p1" }),
            findMany: vi.fn().mockResolvedValue([{ amount: 400 }]),
          },
        }),
    );

    const res = await POST(
      makeReq({
        id: "evt-partial",
        event: "payment_session.completed",
        data: { reference_id: "inv1", status: "COMPLETED", payment_id: "pay-partial", amount: 400 },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: expected });
    expect(txInvoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: expected, paidAt: null }) }),
    );
  });

  it("T5d — missing amount → ERROR:missing_amount, no payment row", async () => {
    const { prisma } = await import("@/lib/db");
    const res = await POST(
      makeReq({
        id: "evt-no-amount",
        event: "payment_session.completed",
        data: {
          reference_id: "inv1",
          status: "COMPLETED",
          payment_id: "pay-x",
          // intentionally no amount
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ERROR:missing_amount" });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-no-amount" },
        data: expect.objectContaining({
          status: "ERROR",
          errorMessage: "MISSING_AMOUNT",
        }),
      }),
    );
  });

  it("currency guard — non-IDR completed event → ERROR:currency_mismatch, no credit", async () => {
    const { prisma } = await import("@/lib/db");
    const res = await POST(
      makeReq({
        id: "evt-usd",
        event: "payment_session.completed",
        data: {
          reference_id: "inv1",
          status: "COMPLETED",
          payment_id: "pay-usd",
          amount: 100_000,
          currency: "USD",
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ERROR:currency_mismatch" });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-usd" },
        data: expect.objectContaining({
          status: "ERROR",
          errorMessage: "CURRENCY_MISMATCH:USD",
        }),
      }),
    );
  });

  it("currency guard — explicit IDR still proceeds to invoice resolution", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
    const res = await POST(
      makeReq({
        id: "evt-idr",
        event: "payment_session.completed",
        data: {
          reference_id: "inv-missing",
          status: "COMPLETED",
          payment_id: "pay-idr",
          amount: 100_000,
          currency: "IDR",
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    // Passed the currency guard — reached invoice resolution (which misses here).
    expect(prisma.invoice.findUnique).toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ status: "ERROR:invoice_not_found" });
  });

  it("rate limit — 61st request from one IP inside a minute → 429 before token check", async () => {
    const ip = "203.0.113.77"; // dedicated IP so other tests' quota untouched
    const flood = () =>
      new Request("http://localhost/api/xendit/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ip,
        },
        body: JSON.stringify({}),
      });
    let last: Response | null = null;
    for (let i = 0; i < 60; i++) {
      last = await POST(flood() as never);
      expect(last.status).toBe(401); // no token — but not yet throttled
    }
    const throttled = await POST(flood() as never);
    expect(throttled.status).toBe(429);
  });

  it("T5d — overpayment is credited but flagged ERROR:OVERPAYMENT_FLAGGED", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      totalDue: 100_000,
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
              totalDue: 100_000,
              totalPaid: 0,
              invoiceNumber: "INV-1",
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          payment: {
            findUnique: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([{ amount: 200_000 }]),
            create: txPaymentCreate,
          },
        }),
    );
    const res = await POST(
      makeReq({
        id: "evt-overpaid",
        event: "payment_session.completed",
        data: {
          reference_id: "inv1",
          status: "COMPLETED",
          payment_id: "pay-over",
          amount: 200_000, // 100k overpayment vs remaining=100k
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "OVERPAID:PAID" });
    expect(txPaymentCreate).toHaveBeenCalled(); // payment still credited
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-overpaid" },
        data: expect.objectContaining({
          status: "ERROR",
          errorMessage: "OVERPAYMENT_FLAGGED",
        }),
      }),
    );
  });

  it("T5c — xenditSessionId fallback resolves invoice when reference_id misses (real PR #136 case)", async () => {
    // Real production payload: reference_id has legacy "staging-tagihan-"
    // prefix that findUnique misses; payment_session_id resolves via fallback.
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null); // refId miss
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      id: "cmodtjyva1g7n7bx7lzpw5oht",
      status: "SENT",
      totalDue: 800_000,
      totalPaid: 0,
      invoiceNumber: "INV-2026-0042",
    } as never);
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "cmodtjyva1g7n7bx7lzpw5oht",
              status: "SENT",
              totalDue: 800_000,
              totalPaid: 0,
              invoiceNumber: "INV-2026-0042",
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          payment: {
            findUnique: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([{ amount: 800_000 }]),
            create: vi.fn().mockResolvedValue({}),
          },
        }),
    );
    const res = await POST(
      makeReq({
        id: "evt-real",
        event: "payment_session.completed",
        data: {
          reference_id: "staging-tagihan-cmodtjyva1g7n7bx7lzpw5oht",
          status: "COMPLETED",
          payment_id: "py-baa5f75a-73b0-4d57-9476-58f1bb160168",
          payment_session_id: "ps-69ec4131991c6b6d61d2e989",
          amount: 800_000,
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "PAID" });
    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
      where: { xenditSessionId: "ps-69ec4131991c6b6d61d2e989" },
    });
  });

  it("T6 — completed event revalidates BOTH student-invoices AND parent-invoice-list tags", async () => {
    const { prisma } = await import("@/lib/db");
    const { revalidateTag } = await import("next/cache");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
    } as never);
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
            create: vi.fn().mockResolvedValue({ id: "p1" }),
            findMany: vi.fn().mockResolvedValue([{ amount: 1000 }]),
          },
        }),
    );
    const res = await POST(
      makeReq({
        id: "evt-t6-completed",
        event: "payment_session.completed",
        data: {
          reference_id: "inv1",
          status: "COMPLETED",
          payment_id: "pay-t6",
          amount: 1000,
        },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("student-invoices", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
  });

  it("T6 — expired event with resolved invoice revalidates BOTH tags", async () => {
    const { prisma } = await import("@/lib/db");
    const { revalidateTag } = await import("next/cache");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "SENT",
      invoiceNumber: "INV-1",
    } as never);
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "SENT",
              invoiceNumber: "INV-1",
              xenditSessionId: "sess-t6",
              xenditPaymentUrl: "https://checkout.test/sess-t6",
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        }),
    );
    const res = await POST(
      makeReq({
        id: "evt-t6-expired",
        event: "payment_session.expired",
        data: { reference_id: "inv1", payment_session_id: "sess-t6", status: "EXPIRED" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("student-invoices", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
  });

  it("T6 — expired event with no resolved invoice revalidates NEITHER tag", async () => {
    const { prisma } = await import("@/lib/db");
    const { revalidateTag } = await import("next/cache");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
    const res = await POST(
      makeReq({
        id: "evt-t6-expired-orphan",
        event: "payment_session.expired",
        data: { reference_id: "missing", status: "EXPIRED" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ERROR:invoice_not_found" });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("T5e — expired event on PAID invoice → IGNORED:already_paid (no destructive revert)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv1",
      status: "PAID",
      invoiceNumber: "INV-1",
    } as never);
    const txInvoiceUpdate = vi.fn().mockResolvedValue({});
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (cb: unknown) =>
        await (cb as (tx: unknown) => unknown)({
          $executeRaw: vi.fn().mockResolvedValue(0),
          invoice: {
            findUnique: vi.fn().mockResolvedValue({
              id: "inv1",
              status: "PAID",
              invoiceNumber: "INV-1",
            }),
            update: txInvoiceUpdate,
          },
        }),
    );
    const res = await POST(
      makeReq({
        id: "evt-exp-paid",
        event: "payment_session.expired",
        data: { reference_id: "inv1", status: "EXPIRED" },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "IGNORED:already_paid" });
    expect(txInvoiceUpdate).not.toHaveBeenCalled(); // no revert
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "evt-exp-paid" },
        data: expect.objectContaining({ status: "IGNORED" }),
      }),
    );
  });
});
