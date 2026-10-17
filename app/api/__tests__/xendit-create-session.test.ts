import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin session — passes route's authz gate.
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ tenantId: "tnt-1", role: "ADMIN", userId: "u-1", permissions: ["invoices.create"] })),
  isAdminRole: (r: string) => r === "ADMIN" || r === "SUPER_ADMIN",
}));

// Disable rate-limit for these tests — each `it` issues several requests against
// the same `anonymous` key and the route caps at 5/min.
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ success: true, remaining: 99 })),
  getClientIp: vi.fn(() => "test-ip"),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

// Mock the helper at the boundary the route imports it from. This keeps tests
// focused on the route's idempotency + paymentLinkError write-back behavior;
// the helper's own DB updates are out of scope.
vi.mock("@/lib/payments/session", () => ({
  createPaymentSessionForInvoice: vi.fn(),
}));

import { POST } from "../xendit/create-session/route";

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/xendit/create-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/xendit/create-session — idempotency + paymentLinkError write-back", () => {
  beforeEach(() => vi.clearAllMocks());

  it("existing-session path: returns existing URL, does NOT call Xendit, clears paymentLinkError defensively", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-existing",
      tenantId: "tnt-1",
      invoiceNumber: "INV-EXIST-1",
      status: "SENT",
      totalDue: 100000,
      totalPaid: 0,
      xenditSessionId: "xnd-sess-already",
      xenditPaymentUrl: "https://checkout.xendit.co/web/already-here",
      paymentLinkError: null,
      student: { name: "Aisyah" },
      lines: [{ labelSnapshot: "SPP" }],
    } as never);

    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const res = await POST(makeReq({ invoiceIds: ["inv-existing"] }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.created).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toEqual({
      studentName: "Aisyah",
      invoiceNumber: "INV-EXIST-1",
      paymentUrl: "https://checkout.xendit.co/web/already-here",
    });

    // The helper (which would call the Xendit API) MUST NOT be invoked.
    expect(createPaymentSessionForInvoice).not.toHaveBeenCalled();

    // paymentLinkError cleared defensively.
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-existing" },
      data: { paymentLinkError: null },
    });
  });

  it("Xendit success path: helper called, status flipped to SENT with paymentLinkError null", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-fresh",
      tenantId: "tnt-1",
      invoiceNumber: "INV-FRESH-1",
      status: "DRAFT",
      totalDue: 250000,
      totalPaid: 0,
      xenditSessionId: null,
      xenditPaymentUrl: null,
      paymentLinkError: null,
      student: { name: "Budi" },
      lines: [{ labelSnapshot: "SPP" }],
    } as never);

    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.xendit.co/web/new-url", created: true,
    });

    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const res = await POST(makeReq({ invoiceIds: ["inv-fresh"] }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.created).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].paymentUrl).toBe("https://checkout.xendit.co/web/new-url");

    expect(createPaymentSessionForInvoice).toHaveBeenCalledWith(
      "inv-fresh",
      "tnt-1",
      expect.stringMatching(/^https?:\/\//),
    );

    // Status flip + paymentLinkError clear in the same update.
    const updateCall = vi.mocked(prisma.invoice.update).mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: "inv-fresh" });
    expect(updateCall?.data).toMatchObject({ status: "SENT", paymentLinkError: null });
    expect(updateCall?.data).toHaveProperty("sentAt");
    expect(updateCall?.data?.sentAt).toBeInstanceOf(Date);
  });

  // The expiry sweep clears a dead link on OVERDUE / PARTIALLY_PAID invoices
  // (cycle 2026-10-17-expired-link-overdue), which makes a fresh link reachable
  // for them. Issuing it must not demote them to SENT.
  it.each(["OVERDUE", "PARTIALLY_PAID"])(
    "a fresh link on a %s invoice keeps its status",
    async (status) => {
      const { prisma } = await import("@/lib/db");
      const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-owed",
        tenantId: "tnt-1",
        invoiceNumber: "INV-OWED-1",
        status,
        totalDue: 250000,
        totalPaid: status === "PARTIALLY_PAID" ? 100000 : 0,
        xenditSessionId: null,
        xenditPaymentUrl: null,
        paymentLinkError: null,
        student: { name: "Citra" },
        lines: [{ labelSnapshot: "SPP" }],
      } as never);
      vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
        paymentUrl: "https://checkout.doku.com/new", created: true,
      });
      vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

      const res = await POST(makeReq({ invoiceIds: ["inv-owed"] }) as never);
      expect((await res.json()).created).toBe(1);

      const data = vi.mocked(prisma.invoice.update).mock.calls[0]?.[0]?.data;
      expect(data).toEqual({ paymentLinkError: null });
    },
  );

  it.each(["OVERDUE", "PARTIALLY_PAID"])(
    "a failed link on a %s invoice records the error but does not move it to PENDING_PAYMENT_LINK",
    async (status) => {
      const { prisma } = await import("@/lib/db");
      const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

      vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
        id: "inv-owed",
        tenantId: "tnt-1",
        invoiceNumber: "INV-OWED-1",
        status,
        totalDue: 250000,
        totalPaid: 0,
        xenditSessionId: null,
        xenditPaymentUrl: null,
        paymentLinkError: null,
        student: { name: "Citra" },
        lines: [{ labelSnapshot: "SPP" }],
      } as never);
      vi.mocked(createPaymentSessionForInvoice).mockRejectedValue(new Error("gateway down"));
      vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

      const body = await (await POST(makeReq({ invoiceIds: ["inv-owed"] }) as never)).json();
      expect(body.failed).toBe(1);

      const data = vi.mocked(prisma.invoice.update).mock.calls[0]?.[0]?.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("status");
      expect(data.paymentLinkError).toEqual(expect.any(String));
    },
  );

  it("Xendit failure path: persists status=PENDING_PAYMENT_LINK + paymentLinkError, increments failed", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-fail",
      tenantId: "tnt-1",
      invoiceNumber: "INV-FAIL-1",
      status: "DRAFT",
      totalDue: 100000,
      totalPaid: 0,
      xenditSessionId: null,
      xenditPaymentUrl: null,
      paymentLinkError: null,
      student: { name: "Citra" },
      lines: [{ labelSnapshot: "SPP" }],
    } as never);

    vi.mocked(createPaymentSessionForInvoice).mockRejectedValue(
      new Error("Xendit 503 Service Unavailable")
    );
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const res = await POST(makeReq({ invoiceIds: ["inv-fail"] }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.created).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results).toHaveLength(0);
    expect(body.errors).toEqual(["Citra: Xendit 503 Service Unavailable"]);

    // The failure write-back: status flips to PENDING_PAYMENT_LINK and the
    // error message is persisted for diagnosis + retry. The persisted column
    // is prefix-tagged via formatPaymentLinkError — generic Error → "unknown:".
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "inv-fail" },
      data: {
        status: "PENDING_PAYMENT_LINK",
        paymentLinkError: "unknown: Xendit 503 Service Unavailable",
      },
    });
  });

  it("retry of PENDING_PAYMENT_LINK invoice succeeds: status flips to SENT, paymentLinkError cleared", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    // Invoice was previously flagged after a Xendit failure — has the diagnostic
    // message but no session yet. Admin clicks "Coba Lagi"; helper succeeds.
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-retry",
      tenantId: "tnt-1",
      invoiceNumber: "INV-RETRY-1",
      status: "PENDING_PAYMENT_LINK",
      totalDue: 175000,
      totalPaid: 0,
      xenditSessionId: null,
      xenditPaymentUrl: null,
      paymentLinkError: "Previous failure: Xendit timeout",
      student: { name: "Dewi" },
      lines: [{ labelSnapshot: "SPP" }],
    } as never);

    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.xendit.co/web/retry-success", created: true,
    });
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const res = await POST(makeReq({ invoiceIds: ["inv-retry"] }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.created).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results[0].paymentUrl).toBe("https://checkout.xendit.co/web/retry-success");

    // The single update on the success path carries both the SENT flip AND
    // the paymentLinkError clear — that's the retry-of-PENDING contract.
    const updateCall = vi.mocked(prisma.invoice.update).mock.calls[0]?.[0];
    expect(updateCall?.data).toMatchObject({ status: "SENT", paymentLinkError: null });
  });

  it("mixed batch: 1 already-sessioned + 1 success + 1 failure → counts and per-row results align", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    // findUnique called once per invoiceId in order.
    vi.mocked(prisma.invoice.findUnique)
      .mockResolvedValueOnce({
        id: "inv-a",
        tenantId: "tnt-1",
        invoiceNumber: "INV-A",
        status: "SENT",
        totalDue: 100000,
        totalPaid: 0,
        xenditSessionId: "xnd-existing-A",
        xenditPaymentUrl: "https://checkout.xendit.co/web/A-url",
        paymentLinkError: null,
        student: { name: "Aisyah" },
        lines: [{ labelSnapshot: "SPP" }],
      } as never)
      .mockResolvedValueOnce({
        id: "inv-b",
        tenantId: "tnt-1",
        invoiceNumber: "INV-B",
        status: "DRAFT",
        totalDue: 100000,
        totalPaid: 0,
        xenditSessionId: null,
        xenditPaymentUrl: null,
        paymentLinkError: null,
        student: { name: "Budi" },
        lines: [{ labelSnapshot: "SPP" }],
      } as never)
      .mockResolvedValueOnce({
        id: "inv-c",
        tenantId: "tnt-1",
        invoiceNumber: "INV-C",
        status: "DRAFT",
        totalDue: 100000,
        totalPaid: 0,
        xenditSessionId: null,
        xenditPaymentUrl: null,
        paymentLinkError: null,
        student: { name: "Citra" },
        lines: [{ labelSnapshot: "SPP" }],
      } as never);

    // Helper is called only for B and C. B succeeds, C throws.
    vi.mocked(createPaymentSessionForInvoice)
      .mockResolvedValueOnce({ paymentUrl: "https://checkout.xendit.co/web/B-url", created: true })
      .mockRejectedValueOnce(new Error("Xendit 500"));

    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const res = await POST(
      makeReq({ invoiceIds: ["inv-a", "inv-b", "inv-c"] }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(3);
    expect(body.created).toBe(2); // A (existing) + B (fresh success)
    expect(body.failed).toBe(1); // C (Xendit failure)
    expect(body.results).toHaveLength(2);
    expect(body.results.map((r: { invoiceNumber: string }) => r.invoiceNumber).sort()).toEqual([
      "INV-A",
      "INV-B",
    ]);
    expect(body.errors).toEqual(["Citra: Xendit 500"]);

    // Helper called exactly twice — NOT for inv-a (already sessioned).
    expect(createPaymentSessionForInvoice).toHaveBeenCalledTimes(2);
    expect(createPaymentSessionForInvoice).toHaveBeenNthCalledWith(
      1,
      "inv-b",
      "tnt-1",
      expect.stringMatching(/^https?:\/\//),
    );
    expect(createPaymentSessionForInvoice).toHaveBeenNthCalledWith(
      2,
      "inv-c",
      "tnt-1",
      expect.stringMatching(/^https?:\/\//),
    );

    // Three updates: A (defensive clear), B (SENT + clear), C (PENDING + error).
    const updateCalls = vi.mocked(prisma.invoice.update).mock.calls.map((c) => c[0]);
    expect(updateCalls).toHaveLength(3);

    const aUpdate = updateCalls.find((c) => c?.where.id === "inv-a");
    expect(aUpdate?.data).toEqual({ paymentLinkError: null });

    const bUpdate = updateCalls.find((c) => c?.where.id === "inv-b");
    expect(bUpdate?.data).toMatchObject({ status: "SENT", paymentLinkError: null });

    const cUpdate = updateCalls.find((c) => c?.where.id === "inv-c");
    // Prefix-tagged via formatPaymentLinkError — generic Error → "unknown:".
    expect(cUpdate?.data).toEqual({
      status: "PENDING_PAYMENT_LINK",
      paymentLinkError: "unknown: Xendit 500",
    });
  });
});

// Cycle 2026-07-27-doku-payment-gateway T3 — two defects the audit surfaced:
// (1) `await req.json()` was unguarded (a malformed body threw and yielded an
// unhandled 500); (2) `invoiceIds` had no length cap while every sibling bulk
// route caps at 25 via zod (`retryPaymentLinksSchema`, `generateBatchSchema`).
describe("POST /api/xendit/create-session — request validation", () => {
  beforeEach(() => vi.clearAllMocks());

  function makeRawReq(rawBody: string) {
    return new Request("http://localhost:3000/api/xendit/create-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });
  }

  it("returns 400 'Malformed body' when the request body is not valid JSON", async () => {
    const { prisma } = await import("@/lib/db");

    const res = await POST(makeRawReq("{not valid json") as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Malformed body" });

    // Must short-circuit before any DB lookup.
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 'Validasi gagal' with issues when invoiceIds.length > 25", async () => {
    const overCap = Array.from({ length: 26 }, (_, i) => `inv-${i}`);

    const res = await POST(makeReq({ invoiceIds: overCap }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validasi gagal");
    expect(body.issues).toBeDefined();
  });

  it("accepts the singular invoiceId form (single-invoice action) and processes it", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-single",
      tenantId: "tnt-1",
      invoiceNumber: "INV-SINGLE-1",
      status: "DRAFT",
      totalDue: 100000,
      totalPaid: 0,
      xenditSessionId: null,
      xenditPaymentUrl: null,
      paymentLinkError: null,
      student: { name: "Eka" },
      lines: [{ labelSnapshot: "SPP" }],
    } as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.xendit.co/web/single", created: true,
    });
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const res = await POST(makeReq({ invoiceId: "inv-single" }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.created).toBe(1);
    expect(body.results[0]).toEqual({
      studentName: "Eka",
      invoiceNumber: "INV-SINGLE-1",
      paymentUrl: "https://checkout.xendit.co/web/single",
    });
    expect(createPaymentSessionForInvoice).toHaveBeenCalledWith(
      "inv-single",
      "tnt-1",
      expect.stringMatching(/^https?:\/\//),
    );
  });
});
