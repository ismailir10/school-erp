/**
 * One link per invoice, tested where races actually happen (cycle 2026-10-17-payment-link-on-demand,
 * review of PR #666). The real `createPaymentSessionForInvoice`, `ensurePaymentLink` and
 * `reconcileInvoicePayment` run against a small STATEFUL fake of the invoice table, so concurrent
 * callers interleave at every `await` instead of each seeing a mock. Only the gateway is stubbed.
 *
 * What the review reproduced and these pin: a parent and the existing admin action both creating a
 * session; an admin refresh erasing the creation claim; a slow creator overwriting a newer link;
 * a link written onto an invoice that was paid meanwhile.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = {
  id: string;
  tenantId: string;
  status: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string;
  totalDue: number;
  totalPaid: number;
  xenditSessionId: string | null;
  xenditPaymentUrl: string | null;
  paymentCheckedAt: Date | null;
};

const { state, gateway } = vi.hoisted(() => ({
  state: { row: null as unknown as Row },
  gateway: {
    id: "doku",
    createSession: vi.fn(),
    fetchPaymentStatus: vi.fn(),
  },
}));

// Just enough of Prisma's `where` for the shapes the code under test uses.
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    const value = (row as Record<string, unknown>)[key];
    if (cond === null) return value === null;
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    if (typeof cond === "object") {
      const c = cond as Record<string, unknown>;
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("lt" in c) return value instanceof Date && value.getTime() < (c.lt as Date).getTime();
      if ("lte" in c) return value instanceof Date && value.getTime() <= (c.lte as Date).getTime();
    }
    return value === cond;
  });
}

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === state.row.id
          ? {
              ...state.row,
              student: { name: "Aisyah", guardians: [] },
              lines: [{ labelSnapshot: "SPP", finalAmount: 850000 }],
            }
          : null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        // yield first so concurrent callers interleave exactly as separate requests would
        await Promise.resolve();
        if (!matches(state.row, where)) return { count: 0 };
        Object.assign(state.row, data);
        return { count: 1 };
      },
      update: async ({ data }: { data: Partial<Row> }) => {
        Object.assign(state.row, data);
        return state.row;
      },
    },
  },
}));
vi.mock("@/lib/payments/registry", () => ({ getGateway: () => gateway }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { createPaymentSessionForInvoice } from "@/lib/payments/session";
import { ensurePaymentLink } from "@/lib/payments/ensure-link";
import { reconcileInvoicePayment } from "@/lib/payments/reconcile";

const ORIGIN = "https://app.test";
const slowSession = (id: string, ms = 80) => async () => {
  await new Promise((r) => setTimeout(r, ms));
  return { id, paymentUrl: `https://checkout.doku.com/${id}`, expiresAt: new Date().toISOString() };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.row = {
    id: "inv1",
    tenantId: "t1",
    status: "OVERDUE",
    invoiceNumber: "INV-2026-0001",
    periodLabel: "Oktober 2026",
    dueDate: "2026-10-01",
    totalDue: 850000,
    totalPaid: 0,
    xenditSessionId: null,
    xenditPaymentUrl: null,
    paymentCheckedAt: null,
  };
  gateway.createSession.mockImplementation(slowSession("S1"));
  gateway.fetchPaymentStatus.mockResolvedValue({
    state: "PENDING", rawStatus: "PENDING", paymentId: null, amount: null, currency: null, channelCode: null, raw: {},
  });
});

describe("exactly one session, whoever asks", () => {
  it("two callers of the shared creation function at once make one session and both get its link", async () => {
    const [a, b] = await Promise.all([
      createPaymentSessionForInvoice("inv1", "t1", ORIGIN, { waitForWinnerMs: 3000 }),
      createPaymentSessionForInvoice("inv1", "t1", ORIGIN, { waitForWinnerMs: 3000 }),
    ]);
    expect(gateway.createSession).toHaveBeenCalledTimes(1);
    expect(a?.paymentUrl).toBe("https://checkout.doku.com/S1");
    expect(b?.paymentUrl).toBe("https://checkout.doku.com/S1");
    expect([a?.created, b?.created].sort()).toEqual([false, true]);
    expect(state.row.xenditSessionId).toBe("S1");
  });

  // The review's P2: the parent endpoint and the EXISTING admin "Buat Link Pembayaran" (which calls
  // the creation function directly, never `ensurePaymentLink`) used to be able to make two sessions.
  it("a parent's request and the existing admin action racing make one session", async () => {
    const [parent, admin] = await Promise.all([
      ensurePaymentLink("inv1", "t1", ORIGIN, { waitForWinnerMs: 3000 }),
      createPaymentSessionForInvoice("inv1", "t1", ORIGIN, { waitForWinnerMs: 3000 }),
    ]);
    expect(gateway.createSession).toHaveBeenCalledTimes(1);
    expect(parent).toMatchObject({ kind: "READY", paymentUrl: "https://checkout.doku.com/S1" });
    expect(admin?.paymentUrl).toBe("https://checkout.doku.com/S1");
    expect(state.row.xenditSessionId).toBe("S1");
  });

  it("an invoice that already holds a link is returned as it is, never replaced", async () => {
    state.row.xenditSessionId = "OLD";
    state.row.xenditPaymentUrl = "https://checkout.doku.com/OLD";
    const r = await createPaymentSessionForInvoice("inv1", "t1", ORIGIN, { waitForWinnerMs: 0 });
    expect(r).toEqual({ paymentUrl: "https://checkout.doku.com/OLD", created: false });
    expect(gateway.createSession).not.toHaveBeenCalled();
  });
});

describe("a payment check cannot erase the creation claim", () => {
  // The review's P2: the existing per-invoice admin refresh stamps paymentCheckedAt unconditionally.
  it("an admin refresh while a link is being created leaves the claim, so a second creator still cannot start", async () => {
    gateway.createSession.mockImplementation(slowSession("S1", 200));
    const creating = createPaymentSessionForInvoice("inv1", "t1", ORIGIN, { waitForWinnerMs: 3000 });
    await new Promise((r) => setTimeout(r, 40)); // the claim is held and the gateway call is out

    const claimBefore = state.row.paymentCheckedAt;
    expect(claimBefore && claimBefore.getTime()).toBeGreaterThan(Date.now()); // a stamp in the future
    await reconcileInvoicePayment("inv1"); // the admin's "Cek status pembayaran", no throttle
    expect(state.row.paymentCheckedAt?.getTime()).toBe(claimBefore!.getTime()); // untouched

    const second = await ensurePaymentLink("inv1", "t1", ORIGIN, { waitForWinnerMs: 0 });
    expect(second).toEqual({ kind: "FAILED" }); // it could not claim, and did not create
    expect(gateway.createSession).toHaveBeenCalledTimes(1);

    expect((await creating)?.paymentUrl).toBe("https://checkout.doku.com/S1");
    expect(state.row.xenditPaymentUrl).toBe("https://checkout.doku.com/S1");
  });

  it("an ordinary check still stamps the time when nobody is creating a link", async () => {
    await reconcileInvoicePayment("inv1");
    expect(state.row.paymentCheckedAt).toBeInstanceOf(Date);
    expect(state.row.paymentCheckedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("persisting only while the claim stands", () => {
  it("a creator that lost its claim does not overwrite the link that won", async () => {
    gateway.createSession.mockImplementation(async () => {
      // while our gateway call is out, someone else's link lands and our claim is gone
      Object.assign(state.row, {
        xenditSessionId: "WINNER",
        xenditPaymentUrl: "https://checkout.doku.com/WINNER",
        paymentCheckedAt: new Date(0),
      });
      return { id: "S1", paymentUrl: "https://checkout.doku.com/S1", expiresAt: new Date().toISOString() };
    });
    const r = await createPaymentSessionForInvoice("inv1", "t1", ORIGIN, { waitForWinnerMs: 0 });
    expect(r).toEqual({ paymentUrl: "https://checkout.doku.com/WINNER", created: false });
    expect(state.row.xenditSessionId).toBe("WINNER"); // session id and URL still belong together
    expect(state.row.xenditPaymentUrl).toBe("https://checkout.doku.com/WINNER");
  });

  it("an invoice paid while the session was being made gets no link written onto it", async () => {
    gateway.createSession.mockImplementation(async () => {
      state.row.status = "PAID";
      return { id: "S1", paymentUrl: "https://checkout.doku.com/S1", expiresAt: new Date().toISOString() };
    });
    expect(await createPaymentSessionForInvoice("inv1", "t1", ORIGIN, { waitForWinnerMs: 0 })).toBeNull();
    expect(state.row.xenditPaymentUrl).toBeNull();
  });

  it("a cancelled invoice is declined before any gateway work", async () => {
    state.row.status = "CANCELLED";
    expect(await createPaymentSessionForInvoice("inv1", "t1", ORIGIN)).toBeNull();
    expect(gateway.createSession).not.toHaveBeenCalled();
  });
});

describe("after a failed create", () => {
  const boom = async () => {
    throw new Error("gateway down");
  };

  it("an admin retry is not held back: the claim is given back and the previous stamp restored", async () => {
    const previous = new Date(Date.now() - 3_600_000); // an hour ago: an old check, not a claim
    state.row.paymentCheckedAt = previous;
    gateway.createSession.mockImplementation(boom);

    await expect(createPaymentSessionForInvoice("inv1", "t1", ORIGIN)).rejects.toThrow("gateway down");

    expect(state.row.paymentCheckedAt?.getTime()).toBe(previous.getTime());
    gateway.createSession.mockImplementation(slowSession("S2", 1));
    expect((await createPaymentSessionForInvoice("inv1", "t1", ORIGIN))?.paymentUrl).toBe("https://checkout.doku.com/S2");
  });

  it("the parent and bulk path keep the claim, so a failing invoice rests instead of being retried per press", async () => {
    gateway.createSession.mockImplementation(boom);
    expect(await ensurePaymentLink("inv1", "t1", ORIGIN, { waitForWinnerMs: 0 })).toEqual({ kind: "FAILED" });
    expect(state.row.paymentCheckedAt!.getTime()).toBeGreaterThan(Date.now());

    gateway.createSession.mockClear();
    expect(await ensurePaymentLink("inv1", "t1", ORIGIN, { waitForWinnerMs: 0 })).toEqual({ kind: "FAILED" });
    expect(gateway.createSession).not.toHaveBeenCalled(); // no second gateway call inside the window
  });
});
