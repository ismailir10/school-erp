import { describe, it, expect, beforeEach, vi } from "vitest";
import { GatewayApiError } from "@/lib/payments/types";

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/payments/registry", () => ({
  getGateway: vi.fn(),
}));

/**
 * Cycle 2026-10-20-payment-link-expiry-display T1 (D2).
 *
 * The date stored with a new link is the expiry the app REQUESTED, computed once
 * before the retry loop, never the string the gateway echoes back. A gateway
 * string that does not parse must not fail the store after the order exists
 * (the caller's retry would then make a second order).
 */

const NOW = new Date("2026-10-20T03:00:00.000Z");

async function setup(createSession: ReturnType<typeof vi.fn>) {
  const { getGateway } = await import("@/lib/payments/registry");
  const { prisma } = await import("@/lib/db");

  vi.mocked(getGateway).mockReturnValue({
    id: "doku",
    createSession,
    ping: vi.fn(),
    fetchPaymentStatus: vi.fn(),
  } as never);
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
    id: "inv-1",
    tenantId: "tnt-1",
    status: "SENT",
    totalDue: 250000,
    totalPaid: 0,
    invoiceNumber: "INV-1",
    periodLabel: "Okt 2026",
    dueDate: "2026-11-10",
    paymentCheckedAt: null,
    student: { name: "Aisy", guardians: [] },
    lines: [],
  } as never);
  vi.mocked(prisma.invoice.updateMany).mockResolvedValue({ count: 1 } as never);
  return prisma;
}

describe("createPaymentSessionForInvoice — stores the requested link expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://talib.annisaasekolahku.com";
  });

  it("saves the requested instant with the link, ignoring an unparseable gateway expiry", async () => {
    const createSession = vi.fn().mockResolvedValue({
      id: "sess-1",
      paymentUrl: "https://checkout.example.test/abc",
      status: "PENDING",
      expiresAt: "not-a-date",
    });
    const prisma = await setup(createSession);

    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    const result = await createPaymentSessionForInvoice("inv-1", "tnt-1", undefined, { now: NOW });

    expect(result).toEqual({ paymentUrl: "https://checkout.example.test/abc", created: true });
    expect(createSession).toHaveBeenCalledTimes(1);
    const requested = (createSession.mock.calls[0][0] as { expiresAt: Date }).expiresAt;
    expect(requested).toBeInstanceOf(Date);

    const persist = vi
      .mocked(prisma.invoice.updateMany)
      .mock.calls.map((c) => c[0] as { data: Record<string, unknown> })
      .find((arg) => arg.data.xenditPaymentUrl === "https://checkout.example.test/abc");
    expect(persist).toBeDefined();
    expect(persist!.data.xenditSessionId).toBe("sess-1");
    expect(persist!.data.paymentLinkExpiresAt).toEqual(requested);
  });

  it("makes one order and requests one instant across a retried create", async () => {
    const createSession = vi
      .fn()
      .mockRejectedValueOnce(
        new GatewayApiError({ status: 503, code: "5xx", retriable: true, message: "unavailable" }),
      )
      .mockResolvedValueOnce({
        id: "sess-2",
        paymentUrl: "https://checkout.example.test/def",
        status: "PENDING",
        expiresAt: "garbage",
      });
    const prisma = await setup(createSession);

    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    await expect(
      createPaymentSessionForInvoice("inv-1", "tnt-1", undefined, { now: NOW }),
    ).resolves.toMatchObject({ created: true });

    expect(createSession).toHaveBeenCalledTimes(2);
    const first = (createSession.mock.calls[0][0] as { expiresAt: Date }).expiresAt;
    const second = (createSession.mock.calls[1][0] as { expiresAt: Date }).expiresAt;
    expect(second).toEqual(first);

    const persists = vi
      .mocked(prisma.invoice.updateMany)
      .mock.calls.map((c) => c[0] as { data: Record<string, unknown> })
      .filter((arg) => arg.data.xenditPaymentUrl !== undefined);
    expect(persists).toHaveLength(1);
    expect(persists[0].data.paymentLinkExpiresAt).toEqual(first);
  });
});
