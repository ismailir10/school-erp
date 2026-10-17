/**
 * Regression test for the double-slash bug observed in production webhook
 * payloads — `success_return_url` and `cancel_return_url` were being
 * emitted as `https://annisaa-erp-v3.vercel.app//payment/...` (note the
 * `//`) because `NEXT_PUBLIC_APP_URL` in Vercel env carries a trailing
 * slash and the helper concatenated `${APP_URL}/payment/...` directly.
 *
 * The fix: `lib/payments/session.ts` (moved from `lib/xendit/helpers.ts` in
 * cycle 2026-07-27-doku-payment-gateway T3) strips trailing slashes from
 * APP_URL. This test pins the behavior so future env changes can't
 * reintroduce it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}));

// The session helper resolves the active gateway via `getGateway()` instead
// of calling the Xendit client concretely (T3) — mock the registry seam
// rather than the client. `stripQuery` (used for log-line hygiene) is left
// real; it's a pure URL-string function with no network/side effects.
vi.mock("@/lib/payments/registry", () => ({
  getGateway: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("createXenditSessionForInvoice — APP_URL trailing-slash safety", () => {
  it("strips a trailing slash from NEXT_PUBLIC_APP_URL before constructing redirect URLs", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://annisaa-erp-v3.vercel.app/";

    const { getGateway } = await import("@/lib/payments/registry");
    const { prisma } = await import("@/lib/db");
    const createSessionMock = vi.fn().mockResolvedValue({
      id: "ps-x",
      paymentUrl: "https://x/y",
      status: "ACTIVE",
      expiresAt: new Date().toISOString(),
    });
    vi.mocked(getGateway).mockReturnValue({
      id: "xendit",
      createSession: createSessionMock,
      ping: vi.fn(),
      fetchPaymentStatus: vi.fn(),
    });
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-1",
      tenantId: "tnt-1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-1",
      periodLabel: "Apr 2026",
      student: { name: "Aisy", guardians: [] },
      lines: [],
    } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const { createXenditSessionForInvoice } = await import(
      "@/lib/xendit/helpers"
    );
    await createXenditSessionForInvoice("inv-1", "tnt-1");

    const args = createSessionMock.mock.calls[0]?.[0];
    expect(args?.successReturnUrl).toBe(
      "https://annisaa-erp-v3.vercel.app/parent/invoices?invoice=inv-1&paymentStatus=paid",
    );
    expect(args?.cancelReturnUrl).toBe(
      "https://annisaa-erp-v3.vercel.app/parent/invoices?invoice=inv-1&paymentStatus=cancel",
    );
    // Critical: no double slash anywhere except the protocol.
    expect(args?.successReturnUrl).not.toMatch(/(?<!:)\/\//);
    expect(args?.cancelReturnUrl).not.toMatch(/(?<!:)\/\//);
  });

  it("requestOrigin (staging) wins over NEXT_PUBLIC_APP_URL (prod) — return URLs stay on staging", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://annisaa-erp-v3.vercel.app";
    const stagingOrigin =
      "https://annisaa-erp-v3-git-staging-ismails-projects-196d40d3.vercel.app";

    const { getGateway } = await import("@/lib/payments/registry");
    const { prisma } = await import("@/lib/db");
    const createSessionMock = vi.fn().mockResolvedValue({
      id: "ps-staging",
      paymentUrl: "https://x/y",
      status: "ACTIVE",
      expiresAt: new Date().toISOString(),
    });
    vi.mocked(getGateway).mockReturnValue({
      id: "xendit",
      createSession: createSessionMock,
      ping: vi.fn(),
      fetchPaymentStatus: vi.fn(),
    });
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-2",
      tenantId: "tnt-1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-2",
      periodLabel: "Apr 2026",
      student: { name: "Aisy", guardians: [] },
      lines: [],
    } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const { createXenditSessionForInvoice } = await import(
      "@/lib/xendit/helpers"
    );
    await createXenditSessionForInvoice("inv-2", "tnt-1", stagingOrigin);

    const args = createSessionMock.mock.calls[0]?.[0];
    expect(args?.successReturnUrl).toBe(
      `${stagingOrigin}/parent/invoices?invoice=inv-2&paymentStatus=paid`,
    );
    expect(args?.cancelReturnUrl).toBe(
      `${stagingOrigin}/parent/invoices?invoice=inv-2&paymentStatus=cancel`,
    );
    // Critical: did NOT silently route back to prod via the env fallback.
    expect(args?.successReturnUrl).not.toContain("annisaa-erp-v3.vercel.app/parent");
    expect(args?.cancelReturnUrl).not.toContain("annisaa-erp-v3.vercel.app/parent");
  });
});
