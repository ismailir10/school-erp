import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/payments/session", () => ({
  createPaymentSessionForInvoice: vi.fn(),
}));

import { retryPaymentLinks } from "../xendit-retry";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retryPaymentLinks — empty candidates", () => {
  it("returns zeros and an empty results array when no PENDING invoices match", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const out = await retryPaymentLinks("tnt-1", null);

    expect(out).toEqual({
      retried: 0,
      succeeded: 0,
      stillFailed: 0,
      results: [],
    });
    // Helper must not be touched when there's nothing to retry.
    expect(createPaymentSessionForInvoice).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });
});

describe("retryPaymentLinks — mixed success/failure", () => {
  it("3 PENDING invoices, 2 succeed + 1 throws → retried=3, succeeded=2, stillFailed=1; updates correct shape per outcome", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    const candidates = [
      { id: "i-1", invoiceNumber: "INV-2026-0001", studentId: "s-1", student: { name: "Aisyah" } },
      { id: "i-2", invoiceNumber: "INV-2026-0002", studentId: "s-2", student: { name: "Budi" } },
      { id: "i-3", invoiceNumber: "INV-2026-0003", studentId: "s-3", student: { name: "Citra" } },
    ];
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(candidates as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    vi.mocked(createPaymentSessionForInvoice).mockImplementation(async (invoiceId) => {
      if (invoiceId === "i-3") throw new Error("Xendit 503");
      return { paymentUrl: `https://checkout.xendit.co/web/${invoiceId}`, created: true };
    });

    const out = await retryPaymentLinks("tnt-1", null);

    expect(out.retried).toBe(3);
    expect(out.succeeded).toBe(2);
    expect(out.stillFailed).toBe(1);
    expect(out.results).toHaveLength(3);

    const succeededRows = out.results.filter((r) => r.status === "SENT");
    const failedRows = out.results.filter((r) => r.status === "PENDING_PAYMENT_LINK");
    expect(succeededRows).toHaveLength(2);
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0]).toMatchObject({
      invoiceId: "i-3",
      invoiceNumber: "INV-2026-0003",
      studentId: "s-3",
      studentName: "Citra",
      status: "PENDING_PAYMENT_LINK",
      // Prefix-tagged via formatPaymentLinkError — generic Error → "unknown:".
      error: "unknown: Xendit 503",
    });

    // T4 — every result row carries studentName for the failure-detail UI.
    for (const r of out.results) {
      expect(r.studentName).toBeTruthy();
    }

    // 2 successes get { status: SENT, paymentLinkError: null, sentAt: Date }
    const updateCalls = vi.mocked(prisma.invoice.update).mock.calls.map((c) => c[0]);

    const successUpdates = updateCalls.filter(
      (c) => c.where.id === "i-1" || c.where.id === "i-2"
    );
    expect(successUpdates).toHaveLength(2);
    for (const u of successUpdates) {
      expect(u.data).toMatchObject({ status: "SENT", paymentLinkError: null });
      expect((u.data as { sentAt: Date }).sentAt).toBeInstanceOf(Date);
    }

    // The 1 failure gets { paymentLinkError: <msg> } (no status change).
    // Prefix-tagged via formatPaymentLinkError — generic Error → "unknown:".
    const failUpdate = updateCalls.find((c) => c.where.id === "i-3");
    expect(failUpdate?.data).toEqual({ paymentLinkError: "unknown: Xendit 503" });
  });
});

describe("retryPaymentLinks — invoiceIds filter", () => {
  it('passes id: { in: invoiceIds } to the where clause when invoiceIds is provided', async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await retryPaymentLinks("tnt-1", ["i1", "i2"]);

    expect(prisma.invoice.findMany).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.invoice.findMany).mock.calls[0][0];
    expect(arg?.where).toMatchObject({
      tenantId: "tnt-1",
      status: "PENDING_PAYMENT_LINK",
      id: { in: ["i1", "i2"] },
    });
    expect(arg?.take).toBe(25);
    expect(arg?.orderBy).toEqual({ createdAt: "asc" });
    expect(createPaymentSessionForInvoice).not.toHaveBeenCalled();
  });

  it("does NOT add an id filter when invoiceIds is null (retries all PENDING)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await retryPaymentLinks("tnt-1", null);

    const arg = vi.mocked(prisma.invoice.findMany).mock.calls[0][0];
    expect(arg?.where).toMatchObject({
      tenantId: "tnt-1",
      status: "PENDING_PAYMENT_LINK",
    });
    expect((arg?.where as Record<string, unknown>).id).toBeUndefined();
  });

  it("does NOT add an id filter when invoiceIds is an empty array (treats as retry-all)", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await retryPaymentLinks("tnt-1", []);

    const arg = vi.mocked(prisma.invoice.findMany).mock.calls[0][0];
    expect((arg?.where as Record<string, unknown>).id).toBeUndefined();
  });
});

describe("retryPaymentLinks — 25-invoice with 3 Xendit failures", () => {
  it("3 of 25 calls fail → 3 entries with error + studentName populated in results", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    const candidates = Array.from({ length: 25 }, (_, i) => ({
      id: `i-${i + 1}`,
      invoiceNumber: `INV-2026-${String(i + 1).padStart(4, "0")}`,
      studentId: `s-${i + 1}`,
      student: { name: `Student ${i + 1}` },
    }));
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(candidates as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const failingIds = new Set(["i-5", "i-12", "i-20"]);
    vi.mocked(createPaymentSessionForInvoice).mockImplementation(async (invoiceId) => {
      if (failingIds.has(invoiceId)) throw new Error("Xendit 503");
      return { paymentUrl: `https://checkout.xendit.co/web/${invoiceId}`, created: true };
    });

    const out = await retryPaymentLinks("tnt-1", null);

    expect(out.retried).toBe(25);
    expect(out.succeeded).toBe(22);
    expect(out.stillFailed).toBe(3);

    const failures = out.results.filter((r) => r.status === "PENDING_PAYMENT_LINK");
    expect(failures).toHaveLength(3);
    for (const f of failures) {
      if (f.status === "PENDING_PAYMENT_LINK") {
        // Prefix-tagged via formatPaymentLinkError — generic Error → "unknown:".
        expect(f.error).toBe("unknown: Xendit 503");
        expect(f.studentName).toBeTruthy();
        expect(f.studentId).toBeTruthy();
      }
    }
    const failedIds = new Set(failures.map((f) => f.invoiceId));
    expect(failedIds).toEqual(new Set(["i-5", "i-12", "i-20"]));
  });
});

describe("retryPaymentLinks — 25-invoice happy path", () => {
  it("fans out 25 candidates in parallel and reports all succeeded", async () => {
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");

    const candidates = Array.from({ length: 25 }, (_, i) => ({
      id: `i-${i + 1}`,
      invoiceNumber: `INV-2026-${String(i + 1).padStart(4, "0")}`,
      studentId: `s-${i + 1}`,
      student: { name: `Student ${i + 1}` },
    }));
    vi.mocked(prisma.invoice.findMany).mockResolvedValue(candidates as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    vi.mocked(createPaymentSessionForInvoice).mockImplementation(async (invoiceId) => {
      return { paymentUrl: `https://checkout.xendit.co/web/${invoiceId}`, created: true };
    });

    const out = await retryPaymentLinks("tnt-1", null);

    expect(out.retried).toBe(25);
    expect(out.succeeded).toBe(25);
    expect(out.stillFailed).toBe(0);
    expect(vi.mocked(createPaymentSessionForInvoice)).toHaveBeenCalledTimes(25);
  });
});
