/**
 * Coverage for `POST /api/guardian/invoices/[id]/payment-link` — the parent's
 * "give me a working link" endpoint (cycle 2026-10-17-payment-link-on-demand).
 * Same scoping chain as `check-payment`: GUARDIAN role → parent row in tenant →
 * child's invoice → same tenant, every miss a flat 404 that must never reach the
 * gateway. The link logic itself is covered in `lib/payments/__tests__/ensure-link.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { parentFindFirst, invoiceFindUnique, reconcileMock, ensureMock, rateLimitMock } = vi.hoisted(() => ({
  parentFindFirst: vi.fn(),
  invoiceFindUnique: vi.fn(),
  reconcileMock: vi.fn(),
  ensureMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { parent: { findFirst: parentFindFirst }, invoice: { findUnique: invoiceFindUnique } },
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: rateLimitMock, getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/payments/reconcile", () => ({ reconcileInvoicePayment: reconcileMock }));
vi.mock("@/lib/payments/ensure-link", () => ({ ensurePaymentLink: ensureMock }));

function session(overrides: Partial<{ parentId: string | null; tenantId: string | null; role: "GUARDIAN" | "TEACHER" | "SUPER_ADMIN"; email: string }> = {}) {
  return {
    id: "u-1",
    email: overrides.email ?? "g@g.com",
    name: "G",
    role: overrides.role ?? "GUARDIAN",
    tenantId: overrides.tenantId === undefined ? "t-1" : overrides.tenantId,
    employeeId: null,
    parentId: overrides.parentId === undefined ? "par-1" : overrides.parentId,
    permissions: [] as string[],
    customRoleCode: null,
  };
}

const invoiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  tenantId: "t-1",
  studentId: "stu-1",
  xenditPaymentUrl: null,
  ...overrides,
});

async function call() {
  const { POST } = await import("../guardian/invoices/[id]/payment-link/route");
  const req = new Request("http://localhost/api/guardian/invoices/inv-1/payment-link", { method: "POST" });
  return POST(req as never, { params: Promise.resolve({ id: "inv-1" }) });
}

async function asSession(s: ReturnType<typeof session> | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rateLimitMock.mockReturnValue({ success: true, remaining: 5 });
  parentFindFirst.mockResolvedValue({ guardians: [{ studentId: "stu-1" }, { studentId: "stu-2" }] });
  invoiceFindUnique.mockResolvedValue(invoiceRow());
  reconcileMock.mockResolvedValue({ code: "NO_CHANGE", gatewayStatus: "ACTIVE" });
  ensureMock.mockResolvedValue({ kind: "READY", paymentUrl: "https://checkout.doku.com/new", created: true });
});

describe("auth", () => {
  it("401 without a session", async () => {
    await asSession(null);
    expect((await call()).status).toBe(401);
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it.each(["TEACHER", "SUPER_ADMIN"] as const)("403 for %s", async (role) => {
    await asSession(session({ role }));
    expect((await call()).status).toBe(403);
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("403 for a guardian session without a tenant", async () => {
    await asSession(session({ tenantId: null }));
    expect((await call()).status).toBe(403);
  });
});

describe("scoping", () => {
  beforeEach(() => asSession(session()));

  it("404 for another family's invoice", async () => {
    invoiceFindUnique.mockResolvedValue(invoiceRow({ studentId: "stu-other" }));
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(ensureMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("only an ACTIVE guardian link counts: this route writes, so a soft-deleted one must not", async () => {
    await call();
    expect(parentFindFirst.mock.calls[0][0].select.guardians.where).toEqual({ status: "ACTIVE" });
  });

  it("404 for another school's invoice", async () => {
    invoiceFindUnique.mockResolvedValue(invoiceRow({ tenantId: "t-2" }));
    expect((await call()).status).toBe(404);
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("404 for a missing invoice and for a guardian with no parent row", async () => {
    invoiceFindUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    parentFindFirst.mockResolvedValue(null);
    invoiceFindUnique.mockResolvedValue(invoiceRow());
    expect((await call()).status).toBe(404);
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("404 when the session has neither a parent id nor an email (would match any null-email parent)", async () => {
    await asSession(session({ parentId: null, email: "" }));
    expect((await call()).status).toBe(404);
    expect(parentFindFirst).not.toHaveBeenCalled();
  });

  it("429 once the parent keeps pressing, before any gateway work", async () => {
    rateLimitMock.mockReturnValue({ success: false, remaining: 0 });
    expect((await call()).status).toBe(429);
    expect(ensureMock).not.toHaveBeenCalled();
  });
});

describe("getting a link", () => {
  beforeEach(() => asSession(session()));

  it("an invoice with no link: creates one for this school and returns only the url", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paymentUrl: "https://checkout.doku.com/new", created: true });
    expect(ensureMock).toHaveBeenCalledWith("inv-1", "t-1", "http://localhost");
    // Nothing to ask the gateway about when there is no link.
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("an invoice that holds a link is checked at the gateway first, so an expired one is cleared or a payment credited", async () => {
    invoiceFindUnique.mockResolvedValue(invoiceRow({ xenditPaymentUrl: "https://checkout.doku.com/old" }));
    await call();
    expect(reconcileMock).toHaveBeenCalledWith("inv-1", { minIntervalMs: 10_000 });
    expect(reconcileMock.mock.invocationCallOrder[0]).toBeLessThan(ensureMock.mock.invocationCallOrder[0]);
  });

  it("a live link comes back unchanged and nothing new is reported as created", async () => {
    invoiceFindUnique.mockResolvedValue(invoiceRow({ xenditPaymentUrl: "https://checkout.doku.com/live" }));
    ensureMock.mockResolvedValue({ kind: "READY", paymentUrl: "https://checkout.doku.com/live", created: false });
    expect(await (await call()).json()).toEqual({ paymentUrl: "https://checkout.doku.com/live", created: false });
  });

  it.each(["ORDER_GENERATED", "PENDING"])(
    "a live order nobody has paid on yet (%s) comes back as a usable link",
    async (gatewayStatus) => {
      invoiceFindUnique.mockResolvedValue(invoiceRow({ xenditPaymentUrl: "https://checkout.doku.com/live" }));
      reconcileMock.mockResolvedValue({ code: "NO_CHANGE", gatewayStatus });
      ensureMock.mockResolvedValue({ kind: "READY", paymentUrl: "https://checkout.doku.com/live", created: false });
      const res = await call();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ paymentUrl: "https://checkout.doku.com/live", created: false });
    },
  );

  it("a failing pre-check preserves the link but does not claim that it still works", async () => {
    invoiceFindUnique.mockResolvedValue(invoiceRow({ xenditPaymentUrl: "https://checkout.doku.com/live" }));
    reconcileMock.mockRejectedValue(new Error("gateway down"));
    ensureMock.mockResolvedValue({ kind: "READY", paymentUrl: "https://checkout.doku.com/live", created: false });
    const res = await call();
    expect(res.status).toBe(502);
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it.each([
    { code: "UNAVAILABLE", gatewayStatus: null },
    { code: "GATEWAY_ERROR", gatewayStatus: null },
    { code: "NO_CHANGE", gatewayStatus: null },
    { code: "NO_CHANGE", gatewayStatus: "NEW_UNKNOWN_STATUS" },
  ])("an unverified check $code never returns a stored link as live", async (result) => {
    invoiceFindUnique.mockResolvedValue(invoiceRow({ xenditPaymentUrl: "https://dev.xen.to/old" }));
    reconcileMock.mockResolvedValue(result);
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Link belum bisa diperiksa. Coba lagi sebentar lagi, atau hubungi tata usaha." });
    expect(ensureMock).not.toHaveBeenCalled();
  });
});

describe("outcomes a parent can see", () => {
  beforeEach(() => asSession(session()));

  it("409 when the invoice cannot be paid by link (paid, cancelled, Link Gagal), without gateway wording", async () => {
    ensureMock.mockResolvedValue({ kind: "NOT_PAYABLE" });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Tagihan ini tidak bisa dibayar lewat link.", code: "NOT_PAYABLE" });
  });

  it("502 with a calm message when the link could not be made", async () => {
    ensureMock.mockResolvedValue({ kind: "FAILED" });
    const res = await call();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Link belum bisa dibuat. Coba lagi sebentar lagi, atau hubungi tata usaha.");
    expect(Object.keys(body)).toEqual(["error"]);
  });
});
