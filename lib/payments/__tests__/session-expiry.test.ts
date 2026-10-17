import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}));

vi.mock("@/lib/payments/registry", () => ({
  getGateway: vi.fn(),
}));

/**
 * Cycle 2026-08-20-invoice-due-date-to-gateway T3.
 *
 * The regression test for the reported bug. `createPaymentSessionForInvoice`
 * loaded `invoice.dueDate` and then handed the gateway a hardcoded 7-day
 * expiry, so every Virtual Account expired seven days after issue regardless of
 * what the admin had entered. Nothing failed, nothing logged, and the invoice
 * looked correct in Talib — the mismatch was only visible on the document DOKU
 * sent the parent.
 *
 * The unit tests in `resolve-session-expiry.test.ts` prove the policy is right.
 * These prove the session builder actually CALLS it — which is the half that
 * was broken. Reverting `session.ts` to any constant fails the first test here.
 */

async function createSessionFor(dueDate: string) {
  const { getGateway } = await import("@/lib/payments/registry");
  const { prisma } = await import("@/lib/db");

  const createSession = vi.fn().mockResolvedValue({
    id: "sess-1",
    paymentUrl: "https://checkout.example.test/abc",
    status: "PENDING",
    expiresAt: "2026-11-10T16:59:59Z",
  });
  vi.mocked(getGateway).mockReturnValue({
    id: "doku",
    createSession,
    ping: vi.fn(),
    fetchPaymentStatus: vi.fn(),
  });

  vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
    id: "inv-due",
    tenantId: "tnt-1",
    status: "SENT",
    totalDue: 250000,
    totalPaid: 0,
    invoiceNumber: "INV-DUE",
    periodLabel: "Okt 2026",
    dueDate,
    student: { name: "Aisy", guardians: [] },
    lines: [],
  } as never);
  vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

  const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
  await createPaymentSessionForInvoice("inv-due", "tnt-1");

  return createSession.mock.calls[0][0] as { expiresAt: Date };
}

describe("createPaymentSessionForInvoice — expiry derives from the invoice's due date", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://talib.annisaasekolahku.com";
    // Pin the clock. `nDaysFromNowAsYmd` derives a WIB calendar date from
    // `Date.now()`, and the two-due-dates test calls it twice; if a WIB
    // midnight (17:00 UTC) fell between those calls the dates would land a day
    // apart and the test would fail for a reason that has nothing to do with
    // the code under test. Vanishingly unlikely, trivially preventable.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T03:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  });

  it("sends end-of-due-date WIB, not a fixed number of days from now", async () => {
    // Far enough out to clear the 1-day floor and stay under the 30-day cap for
    // any plausible run date, so this asserts the exact derived instant.
    const dueDate = nDaysFromNowAsYmd(14);
    const params = await createSessionFor(dueDate);

    expect(params.expiresAt.toISOString()).toBe(`${dueDate}T16:59:59.000Z`);
  });

  it("moves when the due date moves — the defining property the bug lacked", async () => {
    const near = await createSessionFor(nDaysFromNowAsYmd(10));
    const far = await createSessionFor(nDaysFromNowAsYmd(20));

    expect(far.expiresAt.getTime()).toBeGreaterThan(near.expiresAt.getTime());

    // Roughly ten days apart. Under the old hardcoded expiry both of these
    // were byte-identical, which is exactly what the finance admin saw.
    const gapDays = (far.expiresAt.getTime() - near.expiresAt.getTime()) / 86_400_000;
    expect(gapDays).toBeCloseTo(10, 5);
  });

  it("is not 7 days from now for a due date that is not 7 days out", async () => {
    const params = await createSessionFor(nDaysFromNowAsYmd(14));
    const sevenDaysOut = Date.now() + 7 * 86_400_000;

    // The specific wrong answer this cycle removed.
    expect(Math.abs(params.expiresAt.getTime() - sevenDaysOut)).toBeGreaterThan(
      6 * 86_400_000,
    );
  });

  it("still yields a usable window for an overdue invoice", async () => {
    const params = await createSessionFor("2020-01-01");
    expect(params.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

/**
 * A `YYYY-MM-DD` whose end-of-day WIB is `n` days out. Derived from the current
 * date rather than hardcoded so the test does not rot, and expressed in WIB so
 * it matches how the production value is written.
 */
function nDaysFromNowAsYmd(n: number): string {
  const wibNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const target = new Date(wibNow.getTime() + n * 86_400_000);
  return target.toISOString().slice(0, 10);
}
