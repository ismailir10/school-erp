// Reproduces cycle 2026-10-17-expired-link-overdue gap 2 at the seam CI can
// reach without a database: what the nightly sweep does to a past-due invoice
// whose payment link DOKU reports EXPIRED.
//
// Real behaviour (reproduced against Postgres, see the cycle doc): the sweep
// (00:30 UTC) reverts the SENT invoice to PENDING_PAYMENT_LINK and clears its
// link; `finance-maintenance` (01:00 UTC) then promotes only SENT → OVERDUE, so
// the invoice is never promoted, and PENDING_PAYMENT_LINK is not in
// UNPAID_INVOICE_STATUSES — the family silently stops owing it on every surface.
//
// `it.fails` pins the bug without breaking CI: it passes while the invariant is
// violated and goes red the moment the bug is fixed, which is the cue to turn
// it into a plain `it` (T2 of the cycle).
import { describe, it, expect, vi, beforeEach } from "vitest";

const { invoiceUpdate, invoiceFresh } = vi.hoisted(() => ({
  invoiceUpdate: vi.fn(),
  invoiceFresh: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    $executeRaw: vi.fn(),
    invoice: { findUnique: invoiceFresh, update: invoiceUpdate },
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
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { processPaymentEvent } from "@/lib/payments/webhook-processor";

const YESTERDAY = new Date(Date.now() + 7 * 3600e3 - 86400e3).toISOString().slice(0, 10);

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

/** Status the invoice row ends on after the processor handles the event. */
async function statusAfterExpiry(status: string, dueDate: string) {
  const row = { id: "inv1", status, invoiceNumber: "INV-2026-0001", dueDate };
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue(row as never);
  invoiceFresh.mockResolvedValue(row);
  await processPaymentEvent(expiredEvent());
  const call = invoiceUpdate.mock.calls[0]?.[0] as { data: { status?: string } } | undefined;
  return call?.data.status ?? status; // no update → the status did not change
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("session expiry on a past-due invoice (nightly sweep)", () => {
  it("control: a not-yet-due SENT invoice reverts to PENDING_PAYMENT_LINK so a new link can be made", async () => {
    const tomorrow = new Date(Date.now() + 7 * 3600e3 + 86400e3).toISOString().slice(0, 10);
    expect(await statusAfterExpiry("SENT", tomorrow)).toBe("PENDING_PAYMENT_LINK");
  });

  // GAP 2. A past-due SENT invoice is money the family still owes.
  it.fails("never moves a past-due unpaid invoice out of the outstanding statuses", async () => {
    const after = await statusAfterExpiry("SENT", YESTERDAY);
    expect(UNPAID_INVOICE_STATUSES as readonly string[]).toContain(after);
  });
});
