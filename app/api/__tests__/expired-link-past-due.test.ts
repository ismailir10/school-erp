// Cycle 2026-10-17-expired-link-overdue: what the nightly sweep does to an
// invoice whose payment link DOKU reports EXPIRED, per invoice status.
//
// The regression this pins (reproduced against Postgres, see the cycle doc): a
// past-due SENT invoice was reverted to PENDING_PAYMENT_LINK, which
// `finance-maintenance` never promotes and UNPAID_INVOICE_STATUSES excludes, so
// the family silently stopped owing it. Overdue and part-paid invoices kept a
// dead link. Tested at the processor seam, where the sweep's EXPIRED poll lands.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { processPaymentEvent } from "@/lib/payments/webhook-processor";

// 17:00 on 17 Oct in Jakarta. Literal dates, not derived from the clock the code reads.
const NOW = new Date("2026-10-17T10:00:00Z");
const PAST_DUE = "2026-10-16";
const DUE_TODAY = "2026-10-17";
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

type Update = { status?: string; xenditSessionId?: null; xenditPaymentUrl?: null };

/** What the processor wrote to the invoice row, or null when it wrote nothing. */
async function expire(status: string, dueDate: string): Promise<Update | null> {
  const row = { id: "inv1", status, invoiceNumber: "INV-2026-0001", dueDate };
  vi.mocked(prisma.invoice.findUnique).mockResolvedValue(row as never);
  invoiceFresh.mockResolvedValue(row);
  await processPaymentEvent(expiredEvent());
  const call = invoiceUpdate.mock.calls[0]?.[0] as { data: Update } | undefined;
  return call?.data ?? null;
}

const DEAD_LINK_CLEARED = { xenditSessionId: null, xenditPaymentUrl: null };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session expiry — SENT", () => {
  it("not yet due: back to PENDING_PAYMENT_LINK so a new link can be made", async () => {
    expect(await expire("SENT", NOT_YET_DUE)).toEqual({ status: "PENDING_PAYMENT_LINK", ...DEAD_LINK_CLEARED });
  });

  it("due today: still not past due, so back to PENDING_PAYMENT_LINK", async () => {
    expect(await expire("SENT", DUE_TODAY)).toEqual({ status: "PENDING_PAYMENT_LINK", ...DEAD_LINK_CLEARED });
  });

  // 18:00 UTC on the 17th is already 01:00 on the 18th in Jakarta, so an invoice
  // due the 17th is past due even though the UTC calendar day is still the 17th.
  it("past due by the Jakarta calendar while the UTC date is still the due date", async () => {
    vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));
    expect(await expire("SENT", DUE_TODAY)).toEqual({ status: "OVERDUE", ...DEAD_LINK_CLEARED });
  });

  // The gap-2 regression: a link expires at the end of the due date, so every
  // invoice unpaid at its due date lands here.
  it("past due: becomes OVERDUE and stays in the outstanding statuses", async () => {
    const written = await expire("SENT", PAST_DUE);
    expect(written).toEqual({ status: "OVERDUE", ...DEAD_LINK_CLEARED });
    expect(UNPAID_INVOICE_STATUSES as readonly string[]).toContain(written?.status);
  });
});

describe("session expiry — invoices that stay owed", () => {
  it.each(["OVERDUE", "PARTIALLY_PAID"])("%s keeps its status and loses only the dead link", async (status) => {
    expect(await expire(status, PAST_DUE)).toEqual(DEAD_LINK_CLEARED);
  });
});

describe("session expiry — untouched", () => {
  it.each(["PAID", "CANCELLED", "DRAFT"])("%s is never written", async (status) => {
    expect(await expire(status, PAST_DUE)).toBeNull();
  });

  it("PENDING_PAYMENT_LINK stays PENDING_PAYMENT_LINK even when past due (no link was ever live to chase)", async () => {
    expect(await expire("PENDING_PAYMENT_LINK", PAST_DUE)).toEqual({
      status: "PENDING_PAYMENT_LINK",
      ...DEAD_LINK_CLEARED,
    });
  });
});

describe("session expiry — idempotency", () => {
  it("a redelivered event (WebhookEvent P2002) writes nothing", async () => {
    vi.mocked(prisma.webhookEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
    );
    const { httpStatus } = await processPaymentEvent(expiredEvent());
    expect(httpStatus).toBe(200);
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });
});
