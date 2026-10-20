// Cycle 2026-10-20-payment-link-expiry-display (D11): a poll that reports a session expired
// while the stored expiry is still more than 5 minutes away clears the link as before and
// writes exactly one warning line. A webhook, a near date or no stored date stay silent.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { invoiceUpdate, invoiceFresh } = vi.hoisted(() => ({
  invoiceUpdate: vi.fn(),
  invoiceFresh: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    $executeRaw: vi.fn(),
    invoice: { findUnique: invoiceFresh, updateMany: invoiceUpdate },
  };
  return {
    prisma: {
      webhookEvent: { create: vi.fn(), update: vi.fn() },
      invoice: { findUnique: vi.fn(), findFirst: vi.fn() },
      enrollmentFee: { findUnique: vi.fn(), findFirst: vi.fn() },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  };
});
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { prisma } from "@/lib/db";
import { processPaymentEvent } from "@/lib/payments/webhook-processor";

const NOW = new Date("2026-10-17T10:00:00Z");
const MIN = 60 * 1000;
const DEAD_LINK_CLEARED = { xenditSessionId: null, xenditPaymentUrl: null, paymentLinkExpiresAt: null };

function event(eventType: string) {
  return {
    provider: "doku" as const,
    eventId: `${eventType}:inv1`,
    eventType,
    kind: "SESSION_EXPIRED" as const,
    referenceId: "inv1",
    sessionId: "sess-1",
    paymentId: null,
    amount: null,
    currency: null,
    channelCode: null,
    rawPayload: {},
  };
}

async function expire(eventType: string, storedExpiry: Date | null) {
  const row = {
    id: "inv1",
    status: "SENT",
    invoiceNumber: "INV-2026-0001",
    dueDate: "2026-10-30",
    xenditSessionId: "sess-1",
    xenditPaymentUrl: "https://checkout.test/sess-1",
    paymentLinkExpiresAt: storedExpiry,
  };
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue(row as never);
  invoiceFresh.mockResolvedValue(row);
  return processPaymentEvent(event(eventType));
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  invoiceUpdate.mockReset().mockResolvedValue({ count: 1 });
  vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("poll reports expiry while the stored date is far off", () => {
  it("still clears the link as before and writes one warning naming the invoice, stored expiry and session", async () => {
    const stored = new Date(NOW.getTime() + 60 * MIN);
    const { body } = await expire("manual.refresh.expired", stored);
    expect(body).toMatchObject({ status: "LINK_CLEARED", invoiceId: "inv1" });
    expect(invoiceUpdate).toHaveBeenCalledTimes(1);
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: "inv1", xenditSessionId: "sess-1", xenditPaymentUrl: "https://checkout.test/sess-1" },
      data: DEAD_LINK_CLEARED,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("INV-2026-0001");
    expect(line).toContain(stored.toISOString());
    expect(line).toContain("sess-1");
    expect(line).not.toContain("checkout.test");
  });

  it("stays silent when the stored date is only 2 minutes away", async () => {
    const { body } = await expire("manual.refresh.expired", new Date(NOW.getTime() + 2 * MIN));
    expect(body).toMatchObject({ status: "LINK_CLEARED" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the stored date is already in the past", async () => {
    await expire("manual.refresh.expired", new Date(NOW.getTime() - 60 * MIN));
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when there is no stored date", async () => {
    const { body } = await expire("manual.refresh.expired", null);
    expect(body).toMatchObject({ status: "LINK_CLEARED" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent for a gateway webhook, even with a far stored date", async () => {
    const { body } = await expire("doku.expired", new Date(NOW.getTime() + 60 * MIN));
    expect(body).toMatchObject({ status: "LINK_CLEARED" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the poll's clear is ignored as a stale session", async () => {
    invoiceUpdate.mockResolvedValue({ count: 0 });
    const { body } = await expire("manual.refresh.expired", new Date(NOW.getTime() + 60 * MIN));
    expect(body).toMatchObject({ status: "IGNORED:stale_session" });
    expect(warn).not.toHaveBeenCalled();
  });
});
