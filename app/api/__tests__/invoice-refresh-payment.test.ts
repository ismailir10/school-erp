import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

/**
 * Route + reconciler coverage for the admin "Perbarui pembayaran" action
 * (cycle 2026-07-28-manual-payment-refresh).
 *
 * The gateway is mocked — these tests never touch a real Xendit/DOKU endpoint.
 * `processPaymentEvent` is mocked too: its own transition semantics are
 * already covered by `xendit-webhook.test.ts` / the DOKU webhook tests, and
 * the contract asserted here is that the reconciler hands it a correctly
 * shaped `NormalizedPaymentEvent` and never performs a transition itself.
 */

const {
  getSessionMock,
  fetchPaymentStatusMock,
  processPaymentEventMock,
  invoiceFindUniqueMock,
  invoiceUpdateMock,
  invoiceUpdateManyMock,
  rateLimitMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  fetchPaymentStatusMock: vi.fn(),
  processPaymentEventMock: vi.fn(),
  invoiceFindUniqueMock: vi.fn(),
  invoiceUpdateMock: vi.fn(),
  invoiceUpdateManyMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  isAdminRole: (role: string) =>
    role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      findUnique: invoiceFindUniqueMock,
      update: invoiceUpdateMock,
      updateMany: invoiceUpdateManyMock,
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/payments/registry", () => ({
  getGateway: () => ({
    id: "xendit",
    createSession: vi.fn(),
    ping: vi.fn(),
    fetchPaymentStatus: fetchPaymentStatusMock,
  }),
}));

vi.mock("@/lib/payments/webhook-processor", () => ({
  processPaymentEvent: processPaymentEventMock,
}));

import { POST } from "../invoices/[id]/refresh-payment/route";
import { reconcileInvoicePayment } from "@/lib/payments/reconcile";
import { GatewayApiError } from "@/lib/payments/types";

const INVOICE_ID = "cmodtjyva1g7n7bx7lzpw5oht";

function makeSession(role: SessionUser["role"], tenantId: string | null = "t1"): SessionUser {
  return {
    id: "u1",
    email: "admin@test.local",
    name: "Admin",
    role,
    tenantId,
    employeeId: null,
    parentId: null,
    permissions: ["payments.record"],
    customRoleCode: null,
  };
}

/** `prisma.invoice.findUnique` is called for the tenant check, the pre-state
 * read, and the post-state read. Queue the shapes each call expects. */
function stubInvoice({
  tenantId = "t1",
  statusBefore = "SENT",
  statusAfter = statusBefore,
  sessionId = "ps-abc",
  paidBefore = 0,
  paidAfter = paidBefore,
}: {
  tenantId?: string;
  statusBefore?: string;
  statusAfter?: string;
  sessionId?: string | null;
  paidBefore?: number;
  paidAfter?: number;
} = {}) {
  invoiceFindUniqueMock.mockReset();
  invoiceFindUniqueMock
    .mockResolvedValueOnce({ id: INVOICE_ID, tenantId }) // route tenant check
    .mockResolvedValueOnce({
      id: INVOICE_ID,
      status: statusBefore,
      invoiceNumber: "INV-001",
      xenditSessionId: sessionId,
      totalPaid: paidBefore,
    }) // reconciler pre-read
    .mockResolvedValueOnce({ status: statusAfter, totalPaid: paidAfter }); // reconciler post-read
}

/** Same, minus the route's tenant-check read — for calling the reconciler
 * directly. Queueing the extra row here would shift every later read by one. */
function stubInvoiceDirect({
  statusBefore = "SENT",
  statusAfter = statusBefore,
  sessionId = "ps-abc",
}: {
  statusBefore?: string;
  statusAfter?: string;
  sessionId?: string | null;
} = {}) {
  invoiceFindUniqueMock.mockReset();
  invoiceFindUniqueMock
    .mockResolvedValueOnce({
      id: INVOICE_ID,
      status: statusBefore,
      invoiceNumber: "INV-001",
      xenditSessionId: sessionId,
    })
    .mockResolvedValueOnce({ status: statusAfter });
}

function req() {
  return new Request(
    `http://localhost:3000/api/invoices/${INVOICE_ID}/refresh-payment`,
    { method: "POST" },
  );
}

function call() {
  return POST(req() as never, { params: Promise.resolve({ id: INVOICE_ID }) });
}

const PENDING_STATUS = {
  state: "PENDING" as const,
  rawStatus: "ACTIVE",
  paymentId: null,
  amount: null,
  currency: "IDR",
  channelCode: null,
  raw: {},
};

const COMPLETED_STATUS = {
  state: "COMPLETED" as const,
  rawStatus: "COMPLETED",
  paymentId: "py-1",
  amount: 800000,
  currency: "IDR",
  channelCode: "BCA",
  raw: { status: "COMPLETED" },
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockReturnValue({ success: true, remaining: 9 });
  invoiceUpdateMock.mockResolvedValue({});
  invoiceUpdateManyMock.mockResolvedValue({ count: 1 });
  getSessionMock.mockResolvedValue(makeSession("SCHOOL_ADMIN"));
  processPaymentEventMock.mockResolvedValue({
    httpStatus: 200,
    body: { ok: true, status: "PAID" },
  });
});

describe("POST /api/invoices/[id]/refresh-payment — auth", () => {
  it("403s an unauthenticated caller", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(403);
    expect(fetchPaymentStatusMock).not.toHaveBeenCalled();
  });

  it("403s a teacher", async () => {
    getSessionMock.mockResolvedValue(makeSession("TEACHER"));
    const res = await call();
    expect(res.status).toBe(403);
    expect(fetchPaymentStatusMock).not.toHaveBeenCalled();
  });

  it("403s a guardian — parents must never reconcile their own invoice", async () => {
    getSessionMock.mockResolvedValue(makeSession("GUARDIAN"));
    const res = await call();
    expect(res.status).toBe(403);
    expect(fetchPaymentStatusMock).not.toHaveBeenCalled();
  });

  it("403s an admin with no tenant", async () => {
    getSessionMock.mockResolvedValue(makeSession("SCHOOL_ADMIN", null));
    expect((await call()).status).toBe(403);
  });

  it("404s a cross-tenant invoice without touching the gateway", async () => {
    stubInvoice({ tenantId: "other-tenant" });
    const res = await call();
    expect(res.status).toBe(404);
    expect(fetchPaymentStatusMock).not.toHaveBeenCalled();
  });

  it("429s past the per-user-per-invoice rate limit, before any gateway call", async () => {
    stubInvoice();
    rateLimitMock.mockReturnValue({ success: false, remaining: 0 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(fetchPaymentStatusMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoices/[id]/refresh-payment — outcomes", () => {
  it("credits a completed session and reports UPDATED", async () => {
    stubInvoice({ statusBefore: "SENT", statusAfter: "PAID" });
    fetchPaymentStatusMock.mockResolvedValue(COMPLETED_STATUS);
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.code).toBe("UPDATED");
    expect(body.message).toContain("LUNAS");
    expect(body.statusBefore).toBe("SENT");
    expect(body.statusAfter).toBe("PAID");
  });

  it("reports NO_CHANGE for a still-pending session and writes no audit row", async () => {
    stubInvoice({ statusBefore: "SENT" });
    fetchPaymentStatusMock.mockResolvedValue(PENDING_STATUS);
    const body = await (await call()).json();
    expect(body.code).toBe("NO_CHANGE");
    expect(body.gatewayStatus).toBe("ACTIVE");
    // PENDING must never reach the processor — no WebhookEvent noise, and no
    // chance of an accidental transition.
    expect(processPaymentEventMock).not.toHaveBeenCalled();
  });

  it("does NOT revert on a FAILED attempt — the payment link stays usable", async () => {
    stubInvoice({ statusBefore: "SENT" });
    fetchPaymentStatusMock.mockResolvedValue({
      ...PENDING_STATUS,
      state: "FAILED",
      rawStatus: "CANCELED",
    });
    const body = await (await call()).json();
    expect(body.code).toBe("NO_CHANGE");
    expect(processPaymentEventMock).not.toHaveBeenCalled();
  });

  it("reports ALREADY_PAID without changing anything", async () => {
    stubInvoice({ statusBefore: "PAID", statusAfter: "PAID" });
    fetchPaymentStatusMock.mockResolvedValue(COMPLETED_STATUS);
    processPaymentEventMock.mockResolvedValue({
      httpStatus: 200,
      body: { ok: true, status: "PAID:already" },
    });
    const body = await (await call()).json();
    expect(body.code).toBe("ALREADY_PAID");
    expect(body.statusBefore).toBe("PAID");
    expect(body.statusAfter).toBe("PAID");
  });

  it("tells the admin the link was cleared when a not-yet-due SENT invoice keeps its status (D10)", async () => {
    stubInvoice({ statusBefore: "SENT", statusAfter: "SENT" });
    fetchPaymentStatusMock.mockResolvedValue({
      ...PENDING_STATUS,
      state: "EXPIRED",
      rawStatus: "EXPIRED",
    });
    processPaymentEventMock.mockResolvedValue({ httpStatus: 200, body: { ok: true, status: "LINK_CLEARED" } });
    const body = await (await call()).json();
    expect(body.code).toBe("UPDATED");
    expect(body.statusAfter).toBe("SENT");
    expect(body.message).toContain("Link lama dihapus");
    expect(processPaymentEventMock.mock.calls[0][0].kind).toBe("SESSION_EXPIRED");
  });

  it("keys an expiry on the session, so a reissued link that expires later is not deduped away", async () => {
    const eventIds: string[] = [];
    for (const sessionId of ["ps-first", "ps-second"]) {
      stubInvoice({ statusBefore: "OVERDUE", statusAfter: "OVERDUE", sessionId });
      fetchPaymentStatusMock.mockResolvedValue({ ...PENDING_STATUS, state: "EXPIRED", rawStatus: "EXPIRED" });
      processPaymentEventMock.mockResolvedValue({ httpStatus: 200, body: { ok: true, status: "LINK_CLEARED" } });
      await call();
      eventIds.push(processPaymentEventMock.mock.calls.at(-1)?.[0].eventId);
    }
    expect(eventIds[0]).not.toBe(eventIds[1]);
    expect(eventIds[0]).toContain("ps-first");
  });

  it("tells the admin the dead link was cleared when an expired SENT invoice is past due", async () => {
    stubInvoice({ statusBefore: "SENT", statusAfter: "OVERDUE" });
    fetchPaymentStatusMock.mockResolvedValue({ ...PENDING_STATUS, state: "EXPIRED", rawStatus: "EXPIRED" });
    processPaymentEventMock.mockResolvedValue({ httpStatus: 200, body: { ok: true, status: "PROMOTED_OVERDUE" } });
    const body = await (await call()).json();
    expect(body.code).toBe("UPDATED");
    expect(body.message).toContain("Link lama dihapus");
  });

  it("reports a cleared link even though an OVERDUE invoice keeps its status", async () => {
    stubInvoice({ statusBefore: "OVERDUE", statusAfter: "OVERDUE" });
    fetchPaymentStatusMock.mockResolvedValue({ ...PENDING_STATUS, state: "EXPIRED", rawStatus: "EXPIRED" });
    processPaymentEventMock.mockResolvedValue({ httpStatus: 200, body: { ok: true, status: "LINK_CLEARED" } });
    const body = await (await call()).json();
    expect(body.code).toBe("UPDATED");
    expect(body.statusAfter).toBe("OVERDUE");
    expect(body.message).toContain("Link lama dihapus");
  });

  it("reports a partial payment on an OVERDUE invoice even though its status stays OVERDUE", async () => {
    stubInvoice({ statusBefore: "OVERDUE", statusAfter: "OVERDUE", paidBefore: 0, paidAfter: 300000 });
    fetchPaymentStatusMock.mockResolvedValue(COMPLETED_STATUS);
    const body = await (await call()).json();
    expect(body.code).toBe("UPDATED");
    expect(body.statusAfter).toBe("OVERDUE");
    expect(body.message).toContain("Pembayaran sebagian ditemukan");
  });

  it("surfaces a refund for manual handling instead of swallowing it", async () => {
    stubInvoice({ statusBefore: "PAID", statusAfter: "PAID" });
    fetchPaymentStatusMock.mockResolvedValue({
      ...COMPLETED_STATUS,
      state: "REFUNDED",
      rawStatus: "REFUNDED",
    });
    processPaymentEventMock.mockResolvedValue({
      httpStatus: 200,
      body: { ok: true, error: "REFUND_UNHANDLED" },
    });
    const body = await (await call()).json();
    expect(body.message).toContain("refund");
    const dispatched = processPaymentEventMock.mock.calls[0][0];
    expect(dispatched.kind).toBe("UNHANDLED");
    expect(dispatched.ignoreReason).toBe("REFUND_UNHANDLED");
  });

  it("reports UNAVAILABLE when no session id was ever recorded", async () => {
    stubInvoice({ sessionId: null });
    fetchPaymentStatusMock.mockResolvedValue({
      ...PENDING_STATUS,
      state: "UNAVAILABLE",
      rawStatus: null,
      unavailableReason: "NO_SESSION_ID",
    });
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.code).toBe("UNAVAILABLE");
    expect(body.message).toContain("ID sesi pembayaran");
    expect(processPaymentEventMock).not.toHaveBeenCalled();
  });

  it("502s on a gateway failure without mutating the invoice", async () => {
    stubInvoice({ statusBefore: "SENT" });
    fetchPaymentStatusMock.mockRejectedValue(
      new GatewayApiError({
        status: 503,
        code: "5xx",
        retriable: true,
        message: "upstream down",
      }),
    );
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.code).toBe("GATEWAY_ERROR");
    expect(body.statusAfter).toBe("SENT");
    expect(processPaymentEventMock).not.toHaveBeenCalled();
  });

  it("maps a 401 from the gateway to a credentials message, not a generic error", async () => {
    stubInvoice();
    fetchPaymentStatusMock.mockRejectedValue(
      new GatewayApiError({
        status: 401,
        code: "401",
        retriable: false,
        message: "unauthorized",
      }),
    );
    const body = await (await call()).json();
    expect(body.message).toContain("Kredensial");
  });
});

describe("reconcileInvoicePayment — event shape + idempotency", () => {
  it("hands the processor a deterministic eventId and the polled fields verbatim", async () => {
    stubInvoiceDirect({ statusBefore: "SENT", statusAfter: "PAID" });
    fetchPaymentStatusMock.mockResolvedValue(COMPLETED_STATUS);

    await reconcileInvoicePayment(INVOICE_ID);

    const dispatched = processPaymentEventMock.mock.calls[0][0];
    expect(dispatched.eventId).toBe(`manual:xendit:${INVOICE_ID}:COMPLETED:py-1`);
    expect(dispatched.kind).toBe("PAYMENT_COMPLETED");
    expect(dispatched.referenceId).toBe(INVOICE_ID);
    expect(dispatched.paymentId).toBe("py-1");
    expect(dispatched.amount).toBe(800000);
    expect(dispatched.currency).toBe("IDR");
    expect(dispatched.channelCode).toBe("BCA");
    expect(dispatched.eventType).toBe("manual.refresh.completed");
  });

  it("reports NO_CHANGE when the identical gateway state was already processed", async () => {
    // Second click, unchanged gateway state: the processor short-circuits on
    // the WebhookEvent unique index and reports a duplicate.
    stubInvoiceDirect({ statusBefore: "PAID", statusAfter: "PAID" });
    fetchPaymentStatusMock.mockResolvedValue(COMPLETED_STATUS);
    processPaymentEventMock.mockResolvedValue({
      httpStatus: 200,
      body: { ok: true, duplicate: true },
    });
    const out = await reconcileInvoicePayment(INVOICE_ID);
    expect(out.code).toBe("ALREADY_PAID");
    expect(out.duplicate).toBe(true);
  });

  it("returns NOT_FOUND when the invoice vanished between checks", async () => {
    invoiceFindUniqueMock.mockReset();
    invoiceFindUniqueMock.mockResolvedValue(null);
    const out = await reconcileInvoicePayment(INVOICE_ID);
    expect(out.code).toBe("NOT_FOUND");
    expect(fetchPaymentStatusMock).not.toHaveBeenCalled();
    expect(invoiceUpdateMock).not.toHaveBeenCalled();
    expect(invoiceUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("reconcileInvoicePayment — paymentCheckedAt stamp + throttle", () => {
  const NOW = new Date("2026-10-16T08:00:00.000Z");

  it("stamps paymentCheckedAt before polling on a normal reconcile", async () => {
    stubInvoiceDirect();
    fetchPaymentStatusMock.mockResolvedValue(PENDING_STATUS);

    const out = await reconcileInvoicePayment(INVOICE_ID, { now: NOW });

    expect(out.code).toBe("NO_CHANGE");
    // A guarded write: it replaces a stamp that is null or not in the future, so it can never
    // erase a link-creation claim (a stamp in the future, see lib/payments/session.ts).
    expect(invoiceUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: INVOICE_ID,
        OR: [{ paymentCheckedAt: null }, { paymentCheckedAt: { lte: NOW } }],
      },
      data: { paymentCheckedAt: NOW },
    });
    expect(invoiceUpdateMock).not.toHaveBeenCalled();
    expect(invoiceUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchPaymentStatusMock.mock.invocationCallOrder[0],
    );
  });

  it("answers NO_CHANGE without a gateway call when the claim finds a recent stamp", async () => {
    stubInvoiceDirect();
    invoiceUpdateManyMock.mockResolvedValue({ count: 0 });

    const out = await reconcileInvoicePayment(INVOICE_ID, { minIntervalMs: 10_000, now: NOW });

    expect(out.code).toBe("NO_CHANGE");
    expect(out.message).toBe("Baru saja diperiksa.");
    expect(out.statusBefore).toBe("SENT");
    expect(out.statusAfter).toBe("SENT");
    expect(fetchPaymentStatusMock).not.toHaveBeenCalled();
    expect(processPaymentEventMock).not.toHaveBeenCalled();
  });

  it("claims atomically against a null or older-than-interval stamp, then polls", async () => {
    stubInvoiceDirect();
    fetchPaymentStatusMock.mockResolvedValue(PENDING_STATUS);

    const out = await reconcileInvoicePayment(INVOICE_ID, { minIntervalMs: 10_000, now: NOW });

    expect(out.code).toBe("NO_CHANGE");
    expect(out.message).toBe("Belum ada pembayaran masuk.");
    expect(invoiceUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: INVOICE_ID,
        OR: [
          { paymentCheckedAt: null },
          { paymentCheckedAt: { lt: new Date(NOW.getTime() - 10_000) } },
        ],
      },
      data: { paymentCheckedAt: NOW },
    });
    expect(invoiceUpdateMock).not.toHaveBeenCalled();
    expect(fetchPaymentStatusMock).toHaveBeenCalledTimes(1);
  });

  it("does not stamp a missing invoice", async () => {
    invoiceFindUniqueMock.mockReset();
    invoiceFindUniqueMock.mockResolvedValue(null);

    const out = await reconcileInvoicePayment(INVOICE_ID, { minIntervalMs: 10_000, now: NOW });

    expect(out.code).toBe("NOT_FOUND");
    expect(invoiceUpdateMock).not.toHaveBeenCalled();
    expect(invoiceUpdateManyMock).not.toHaveBeenCalled();
  });
});
