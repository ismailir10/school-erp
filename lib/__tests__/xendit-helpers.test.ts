import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}));

// The session helper now resolves the active gateway via `getGateway()`
// (cycle 2026-07-27-doku-payment-gateway T3) instead of calling the Xendit
// client concretely, so the seam to mock moved from `@/lib/xendit/client`'s
// `createXenditSession` to the registry's `getGateway`.
vi.mock("@/lib/payments/registry", () => ({
  getGateway: vi.fn(),
}));

import { resolveAppOrigin } from "../xendit/helpers";

describe("resolveAppOrigin", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  });

  it("returns requestOrigin when provided (wins over env)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://prod.example.com";
    expect(resolveAppOrigin("https://preview-abc.vercel.app")).toBe(
      "https://preview-abc.vercel.app",
    );
  });

  it("falls back to NEXT_PUBLIC_APP_URL when requestOrigin missing", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://prod.example.com";
    expect(resolveAppOrigin()).toBe("https://prod.example.com");
  });

  it("throws descriptive error when both requestOrigin and env are missing", () => {
    expect(() => resolveAppOrigin()).toThrow(/No app origin available/);
    expect(() => resolveAppOrigin(undefined)).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  // Pinned per cycle 2026-04-27-finance-ui-polish T7. Without this, a future
  // refactor that drops the requestOrigin parameter or reorders the priority
  // chain could silently route preview/staging traffic back to prod.
  it("preview/staging origin survives even when prod env is set (priority pin)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://annisaa-erp-v3.vercel.app";
    const stagingOrigin =
      "https://annisaa-erp-v3-git-staging-ismails-projects-196d40d3.vercel.app";
    expect(resolveAppOrigin(stagingOrigin)).toBe(stagingOrigin);
    const previewOrigin = "https://annisaa-erp-v3-git-feat-x-ismails-projects.vercel.app";
    expect(resolveAppOrigin(previewOrigin)).toBe(previewOrigin);
  });
});

describe("createXenditSessionForInvoice — withXenditRetry wrapping", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://annisaa-erp-v3.vercel.app";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  });

  // Pinned per cycle 2026-04-27-invoice-create-auto-retry T3. The wrap around
  // the gateway's createSession() must surface the typed XenditApiError
  // (GatewayApiError) after the retry budget is exhausted so route-handler
  // callers (T4) can prefix-tag paymentLinkError on `error.code`. Regression
  // here would silently re-throw a generic Error and the prefix tagger would
  // fall through to "unknown:".
  it("propagates XenditApiError with code:'5xx' after 3 retry attempts", async () => {
    vi.useFakeTimers();

    const { getGateway } = await import("@/lib/payments/registry");
    const { XenditApiError } = await import("@/lib/xendit/client");
    const { prisma } = await import("@/lib/db");

    const transient5xx = new XenditApiError({
      status: 503,
      code: "5xx",
      retriable: true,
      message: "Xendit returned 503",
    });
    const createSessionMock = vi.fn().mockRejectedValue(transient5xx);
    vi.mocked(getGateway).mockReturnValue({
      id: "xendit",
      createSession: createSessionMock,
      ping: vi.fn(),
      fetchPaymentStatus: vi.fn(),
    });

    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-5xx",
      tenantId: "tnt-1",
      status: "SENT",
      totalDue: 1000,
      totalPaid: 0,
      invoiceNumber: "INV-5XX",
      periodLabel: "Apr 2026",
      student: { name: "Aisy", guardians: [] },
      lines: [],
    } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const { createXenditSessionForInvoice } = await import("../xendit/helpers");

    const promise = createXenditSessionForInvoice("inv-5xx", "tnt-1");
    // Backoffs: 250ms (after attempt 1) + 1000ms (after attempt 2) = 1250ms
    // Use a bare `.catch` to swallow the rejection while we drive timers,
    // then assert the rejection on the original promise below.
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1250);

    await expect(promise).rejects.toBeInstanceOf(XenditApiError);
    await expect(promise).rejects.toMatchObject({ code: "5xx", status: 503 });

    // Exactly 3 attempts — the retry budget is MAX_ATTEMPTS=3. A 4th would
    // breach the per-request budget math in the cycle spec.
    expect(createSessionMock).toHaveBeenCalledTimes(3);
    // DB persist (step 4) must NOT run when the wrapped call throws — the
    // `await` on the wrap short-circuits before `prisma.invoice.update`.
    expect(vi.mocked(prisma.invoice.update)).not.toHaveBeenCalled();
  });
});

// Cycle 2026-07-29-doku-all-va-channels. Under DOKU the gateway emails the
// Virtual Account number to `customer.email`; if the primary guardian has no
// address the parent never learns which VA to pay and the invoice stalls at
// SENT with no error anywhere. These pin the passthrough and make the
// no-email case observable.
describe("createPaymentSessionForInvoice — guardian contact passthrough", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;

  async function runWith(guardians: unknown[]) {
    const { getGateway } = await import("@/lib/payments/registry");
    const { prisma } = await import("@/lib/db");

    const createSession = vi.fn().mockResolvedValue({
      id: "sess-1",
      paymentUrl: "https://checkout.example.test/abc",
      status: "PENDING",
      expiresAt: "2026-08-05T00:00:00Z",
    });
    vi.mocked(getGateway).mockReturnValue({
      id: "doku",
      createSession,
      ping: vi.fn(),
      fetchPaymentStatus: vi.fn(),
    });

    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-mail",
      tenantId: "tnt-1",
      status: "SENT",
      totalDue: 250000,
      totalPaid: 0,
      invoiceNumber: "INV-MAIL",
      periodLabel: "Jul 2026",
      // Required since cycle 2026-08-20-invoice-due-date-to-gateway — session
      // expiry derives from it. Without it these fixtures take the malformed-
      // date fallback, which passes but stops resembling production.
      dueDate: "2026-07-31",
      student: { name: "Aisy", guardians },
      lines: [],
    } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    await createPaymentSessionForInvoice("inv-mail", "tnt-1");
    return createSession;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://talib.annisaasekolahku.com";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  });

  it("passes the primary guardian's email + name + whatsapp to the gateway", async () => {
    const createSession = await runWith([
      {
        parent: {
          name: "Bu Sari",
          email: "sari@example.test",
          whatsapp: "081234567890",
          phone: "0217654321",
        },
      },
    ]);

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.mock.calls[0][0]).toMatchObject({
      customerName: "Bu Sari",
      customerEmail: "sari@example.test",
      // whatsapp wins over phone — it is the channel An Nisaa' parents read.
      customerPhone: "081234567890",
      // Same origin the request came in on, so preview/staging/prod each get
      // their own notifications instead of whatever Back Office happens to
      // have configured.
      notificationUrl: "https://talib.annisaasekolahku.com/api/doku/webhook",
    });
  });

  it("falls back to phone when the guardian has no whatsapp", async () => {
    const createSession = await runWith([
      { parent: { name: "Pak Budi", email: "budi@example.test", whatsapp: null, phone: "0217654321" } },
    ]);

    expect(createSession.mock.calls[0][0]).toMatchObject({
      customerPhone: "0217654321",
    });
  });

  it("sends customerEmail undefined and warns when the primary guardian has no email", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const createSession = await runWith([
      { parent: { name: "Ibu Nur", email: null, whatsapp: null, phone: null } },
    ]);

    expect(createSession.mock.calls[0][0].customerEmail).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[PAYMENT SESSION NO CUSTOMER EMAIL]",
      expect.objectContaining({ invoiceId: "inv-mail", hasPrimaryGuardian: true }),
    );
  });

  it("queries only ACTIVE primary guardians, and customerEmail comes from that ACTIVE row", async () => {
    const { prisma } = await import("@/lib/db");
    const createSession = await runWith([
      { parent: { name: "Bu Sari", email: "sari@example.test", whatsapp: "081234567890", phone: null } },
    ]);

    expect(vi.mocked(prisma.invoice.findUnique).mock.calls[0][0]).toMatchObject({
      include: { student: { include: { guardians: { where: { isPrimary: true, status: "ACTIVE" } } } } },
    });
    expect(createSession.mock.calls[0][0]).toMatchObject({
      customerEmail: "sari@example.test",
    });
  });

  it("warns with hasPrimaryGuardian:false and falls back to the student name when no primary guardian exists", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const createSession = await runWith([]);

    expect(createSession.mock.calls[0][0]).toMatchObject({
      customerName: "Aisy",
      customerEmail: undefined,
    });
    expect(warn).toHaveBeenCalledWith(
      "[PAYMENT SESSION NO CUSTOMER EMAIL]",
      expect.objectContaining({ hasPrimaryGuardian: false }),
    );
  });
});
