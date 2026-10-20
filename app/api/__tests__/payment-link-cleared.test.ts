// Cycle 2026-10-20-payment-link-expiry-display, D3: the stored link expiry goes away
// wherever the link goes away. One table over every write that drops a link, so a new
// clear site that forgets the date fails here. Sites:
//   - `staleLinkCleared`, the shared helper behind record-payment, reverse-payment and
//     replace-payment-link (their route tests pin that they apply it);
//   - the webhook processor's two clears (OVERDUE/PARTIALLY_PAID keep status; SENT /
//     Link Gagal revert or promote);
//   - void.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { invoiceUpdateMany, invoiceUpdate, invoiceFindUnique, getSessionMock } = vi.hoisted(() => ({
  invoiceUpdateMany: vi.fn(),
  invoiceUpdate: vi.fn(),
  invoiceFindUnique: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    $executeRaw: vi.fn(),
    invoice: { findUnique: invoiceFindUnique, updateMany: invoiceUpdateMany, update: invoiceUpdate },
    payment: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
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
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<object>()), after: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSession: getSessionMock,
}));

import { prisma } from "@/lib/db";
import { LINK_CLEARED } from "@/lib/payments/link-cleared";
import { staleLinkCleared } from "@/lib/payments/ensure-link";
import { processPaymentEvent } from "@/lib/payments/webhook-processor";

// Literal dates, not derived from the clock the code reads.
const PAST_DUE = "2026-10-16";
const NOT_YET_DUE = "2026-10-18";

function expiredEvent() {
  return {
    provider: "doku" as const,
    eventId: "manual:doku:inv1:EXPIRED:sess-1",
    eventType: "manual.refresh.expired",
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

/** What the processor wrote to the invoice when a live link expired on `status`. */
async function processorClear(status: string, dueDate: string): Promise<Record<string, unknown>> {
  const row = {
    id: "inv1", status, invoiceNumber: "INV-1", dueDate,
    xenditSessionId: "sess-1", xenditPaymentUrl: "https://checkout.test/sess-1",
    paymentLinkExpiresAt: new Date("2026-10-19T00:00:00Z"),
  };
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue(row as never);
  invoiceFindUnique.mockResolvedValue(row);
  await processPaymentEvent(expiredEvent());
  return (invoiceUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

async function voidClear(): Promise<Record<string, unknown>> {
  getSessionMock.mockResolvedValue({
    id: "u-1", email: "a@test.com", name: "Admin", role: "SUPER_ADMIN", tenantId: "tnt-1",
    employeeId: null, parentId: null, permissions: [], customRoleCode: null,
  });
  invoiceFindUnique.mockResolvedValue({
    id: "inv-1", tenantId: "tnt-1", status: "SENT", totalPaid: 0,
    xenditSessionId: "sess-1", xenditPaymentUrl: "https://checkout.test/sess-1",
    paymentLinkExpiresAt: new Date("2026-10-19T00:00:00Z"),
  });
  const { POST } = await import("../invoices/[id]/void/route");
  const res = await POST(new Request("http://localhost/api/invoices/inv-1/void", { method: "POST" }) as never, {
    params: Promise.resolve({ id: "inv-1" }),
  });
  expect(res.status).toBe(200);
  return (invoiceUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  invoiceUpdateMany.mockResolvedValue({ count: 1 });
  invoiceUpdate.mockResolvedValue({ id: "inv-1" });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("every write that clears a payment link also clears its expiry date", () => {
  const sites: Array<[string, () => Promise<Record<string, unknown>> | Record<string, unknown>]> = [
    ["the shared constant", () => ({ ...LINK_CLEARED })],
    ["staleLinkCleared (record payment, reverse payment, replace link)", () => staleLinkCleared(new Date("2026-10-20T00:00:00Z"))],
    ["webhook processor: OVERDUE keeps its status", () => processorClear("OVERDUE", PAST_DUE)],
    ["webhook processor: PARTIALLY_PAID keeps its status", () => processorClear("PARTIALLY_PAID", PAST_DUE)],
    ["webhook processor: SENT before its due date", () => processorClear("SENT", NOT_YET_DUE)],
    ["webhook processor: SENT past its due date", () => processorClear("SENT", PAST_DUE)],
    ["webhook processor: Link Gagal invoice", () => processorClear("PENDING_PAYMENT_LINK", NOT_YET_DUE)],
    ["void", voidClear],
  ];

  it.each(sites)("%s", async (_name, run) => {
    const data = await run();
    expect(data).toMatchObject({
      xenditSessionId: null,
      xenditPaymentUrl: null,
      paymentLinkExpiresAt: null,
    });
  });
});
