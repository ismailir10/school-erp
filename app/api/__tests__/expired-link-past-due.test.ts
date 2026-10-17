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

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { processPaymentEvent } from "@/lib/payments/webhook-processor";

// 17:00 on 17 Oct in Jakarta. Literal dates, not derived from the clock the code reads.
const NOW = new Date("2026-10-17T10:00:00Z");
const PAST_DUE = "2026-10-16";
const DUE_TODAY = "2026-10-17";
const NOT_YET_DUE = "2026-10-18";

function expiredEvent(sessionId = "sess-1") {
  return {
    provider: "doku" as const,
    eventId: "manual:doku:inv1:EXPIRED:sess-1",
    eventType: "manual.refresh.expired",
    kind: "SESSION_EXPIRED" as const,
    referenceId: "inv1",
    sessionId,
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
  const row = { id: "inv1", status, invoiceNumber: "INV-2026-0001", dueDate, xenditSessionId: "sess-1", xenditPaymentUrl: "https://checkout.test/sess-1" };
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
  invoiceUpdate.mockReset().mockResolvedValue({ count: 1 });
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

describe("session expiry — a superseded session", () => {
  // A parent or admin replaced the link, so S2 is live and a late expiry for S1 arrives.
  async function expireWith(eventSession: string, storedSession: string | null, status = "OVERDUE", storedUrl = storedSession ? `https://checkout.test/${storedSession}` : null) {
    const row = { id: "inv1", status, invoiceNumber: "INV-2026-0001", dueDate: PAST_DUE, xenditSessionId: storedSession, xenditPaymentUrl: storedUrl };
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(row as never);
    invoiceFresh.mockResolvedValue(row);
    await processPaymentEvent(expiredEvent(eventSession));
    return invoiceUpdate.mock.calls[0]?.[0] ?? null;
  }

  it("an expiry for the OLD session leaves the live replacement link untouched", async () => {
    expect(await expireWith("sess-1", "sess-2")).toBeNull();
  });

  it.each(["SENT", "PARTIALLY_PAID"])("also for a %s invoice", async (status) => {
    expect(await expireWith("sess-1", "sess-2", status)).toBeNull();
  });

  it("an expiry for the CURRENT session still clears it", async () => {
    expect(await expireWith("sess-2", "sess-2")).toMatchObject({ data: { xenditSessionId: null, xenditPaymentUrl: null } });
  });

  it("an old named expiry on an already cleared invoice is ignored", async () => {
    expect(await expireWith("sess-1", null)).toBeNull();
  });

  it.each(["OVERDUE", "SENT"])("a named expiry still clears a URL-only %s session", async (status) => {
    expect(await expireWith("sess-1", null, status, "https://checkout.test/url-only")).toMatchObject({
      where: { id: "inv1", xenditSessionId: null, xenditPaymentUrl: "https://checkout.test/url-only" },
      data: { xenditSessionId: null, xenditPaymentUrl: null },
    });
  });

  it.each(["OVERDUE", "SENT"])("a URL-only replacement installed after the %s read survives the clear", async (status) => {
    const row = { id: "inv1", status, invoiceNumber: "INV-1", dueDate: PAST_DUE, xenditSessionId: null, xenditPaymentUrl: "https://checkout.test/old" };
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ ...row } as never);
    invoiceFresh.mockResolvedValue({ ...row });
    invoiceUpdate.mockImplementationOnce(async ({ where, data }) => {
      row.xenditPaymentUrl = "https://checkout.test/new";
      if (where.xenditPaymentUrl !== row.xenditPaymentUrl) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    });

    const { body } = await processPaymentEvent(expiredEvent());

    expect(body).toMatchObject({ status: "IGNORED:stale_session" });
    expect(row).toMatchObject({ status, xenditSessionId: null, xenditPaymentUrl: "https://checkout.test/new" });
  });

  it.each(["OVERDUE", "PARTIALLY_PAID", "SENT", "PENDING_PAYMENT_LINK"])("a replacement installed after the %s read survives the clear", async (status) => {
    const row = { id: "inv1", status, invoiceNumber: "INV-1", dueDate: PAST_DUE, xenditSessionId: null as string | null, xenditPaymentUrl: null as string | null };
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({ ...row } as never);
    invoiceFresh.mockResolvedValue({ ...row });
    invoiceUpdate.mockImplementationOnce(async ({ where, data }) => {
      // The creator is outside the expiry's advisory lock and installs its replacement
      // after the read. The database evaluates the session predicate against this new row.
      row.xenditSessionId = "sess-2";
      row.xenditPaymentUrl = "https://checkout.test/sess-2";
      if (where.xenditSessionId !== row.xenditSessionId) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    });

    const { body } = await processPaymentEvent({ ...expiredEvent(), sessionId: null });

    expect(body).toMatchObject({ status: "IGNORED:stale_session" });
    expect(row).toMatchObject({ status, xenditSessionId: "sess-2", xenditPaymentUrl: "https://checkout.test/sess-2" });
    expect(invoiceUpdate.mock.calls[0][0].where).toEqual({ id: "inv1", xenditSessionId: null, xenditPaymentUrl: null });
  });

  it("an event that names no session (DOKU) behaves as before", async () => {
    const row = { id: "inv1", status: "OVERDUE", invoiceNumber: "INV-1", dueDate: PAST_DUE, xenditSessionId: "sess-2", xenditPaymentUrl: "https://checkout.test/sess-2" };
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue(row as never);
    invoiceFresh.mockResolvedValue(row);
    await processPaymentEvent({ ...expiredEvent(), sessionId: null });
    expect(invoiceUpdate).toHaveBeenCalledTimes(1);
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
