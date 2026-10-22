/**
 * Coverage for `POST /api/guardian/invoices/[id]/check-payment` — the parent's
 * "I just paid, check it" endpoint. Same scoping chain as the guardian invoice
 * detail route (GUARDIAN role → parent row in tenant → child's invoice → same
 * tenant); every miss is a flat 404 and must never reach the reconciler.
 * The response carries only `{ code, status }`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { parentFindFirst, invoiceFindUnique, reconcileMock, rateLimitMock } = vi.hoisted(() => ({
  parentFindFirst: vi.fn(),
  invoiceFindUnique: vi.fn(),
  reconcileMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    parent: { findFirst: parentFindFirst },
    invoice: { findUnique: invoiceFindUnique },
  },
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: rateLimitMock,
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/payments/reconcile", () => ({
  reconcileInvoicePayment: reconcileMock,
}));

function session(overrides: Partial<{
  parentId: string | null;
  tenantId: string | null;
  role: "GUARDIAN" | "TEACHER" | "SUPER_ADMIN";
  email: string;
}> = {}) {
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

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    tenantId: "t-1",
    studentId: "stu-1",
    status: "SENT",
    xenditPaymentUrl: "https://pay.example/abc",
    ...overrides,
  };
}

function makeReq() {
  return new Request("http://localhost/api/guardian/invoices/inv-1/check-payment", {
    method: "POST",
  });
}

async function call() {
  const { POST } = await import("../guardian/invoices/[id]/check-payment/route");
  return POST(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });
}

async function asSession(s: ReturnType<typeof session> | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockReturnValue({ success: true, remaining: 5 });
  parentFindFirst.mockResolvedValue({ guardians: [{ studentId: "stu-1" }, { studentId: "stu-2" }] });
  invoiceFindUnique.mockResolvedValue(invoiceRow());
});

describe("POST /api/guardian/invoices/[id]/check-payment — auth", () => {
  it("401 without a session", async () => {
    await asSession(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it.each(["TEACHER", "SUPER_ADMIN"] as const)("403 for %s", async (role) => {
    await asSession(session({ role }));
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("403 for a guardian session without a tenant", async () => {
    await asSession(session({ tenantId: null }));
    const res = await call();
    expect(res.status).toBe(403);
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/guardian/invoices/[id]/check-payment — scoping", () => {
  it("404 for another family's invoice", async () => {
    await asSession(session());
    invoiceFindUnique.mockResolvedValue(invoiceRow({ studentId: "stu-other" }));
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("404 for another tenant's invoice", async () => {
    await asSession(session());
    invoiceFindUnique.mockResolvedValue(invoiceRow({ tenantId: "t-2" }));
    const res = await call();
    expect(res.status).toBe(404);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("404 for a missing invoice", async () => {
    await asSession(session());
    invoiceFindUnique.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("404 when no parent row matches the session", async () => {
    await asSession(session());
    parentFindFirst.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(invoiceFindUnique).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("404 when the session has neither parentId nor email", async () => {
    await asSession(session({ parentId: null, email: "" }));
    const res = await call();
    expect(res.status).toBe(404);
    expect(parentFindFirst).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("looks the parent up by tenant-scoped parentId", async () => {
    await asSession(session());
    reconcileMock.mockResolvedValue({ code: "NO_CHANGE", statusBefore: "SENT", statusAfter: "SENT" });
    await call();
    expect(parentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "par-1", tenantId: "t-1" } }),
    );
  });

  it("only counts ACTIVE guardian links when resolving the guardian's children", async () => {
    await asSession(session());
    reconcileMock.mockResolvedValue({ code: "NO_CHANGE", statusBefore: "SENT", statusAfter: "SENT" });
    await call();
    expect(parentFindFirst.mock.calls[0][0].select.guardians.where).toEqual({ status: "ACTIVE" });
  });

  it("falls back to a tenant-scoped email lookup when there is no parentId", async () => {
    await asSession(session({ parentId: null }));
    reconcileMock.mockResolvedValue({ code: "NO_CHANGE", statusBefore: "SENT", statusAfter: "SENT" });
    await call();
    expect(parentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "g@g.com", tenantId: "t-1" } }),
    );
  });
});

describe("POST /api/guardian/invoices/[id]/check-payment — rate limit", () => {
  it("429 past the limit, keyed by user + invoice, without reconciling", async () => {
    await asSession(session());
    rateLimitMock.mockReturnValue({ success: false, remaining: 0 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Terlalu sering memeriksa. Tunggu sebentar ya." });
    expect(rateLimitMock).toHaveBeenCalledWith("guardian-check-payment:u-1:inv-1", 6, 60_000);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("does not consume the limiter for a stranger's invoice", async () => {
    await asSession(session());
    invoiceFindUnique.mockResolvedValue(invoiceRow({ studentId: "stu-other" }));
    await call();
    expect(rateLimitMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/guardian/invoices/[id]/check-payment — skip rules", () => {
  it.each(["PAID", "CANCELLED", "DRAFT"])("SKIPPED for a %s invoice, no reconcile", async (status) => {
    await asSession(session());
    invoiceFindUnique.mockResolvedValue(invoiceRow({ status }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "SKIPPED", status });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("SKIPPED for an unpaid invoice without a payment link", async () => {
    await asSession(session());
    invoiceFindUnique.mockResolvedValue(invoiceRow({ xenditPaymentUrl: null }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "SKIPPED", status: "SENT" });
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/guardian/invoices/[id]/check-payment — reconcile", () => {
  it("passes the 10 s throttle and returns only { code, status }", async () => {
    await asSession(session());
    reconcileMock.mockResolvedValue({
      code: "UPDATED",
      message: "Pembayaran diterapkan (admin voice)",
      provider: "xendit",
      gatewayStatus: "PAID",
      statusBefore: "SENT",
      statusAfter: "PAID",
    });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ code: "UPDATED", status: "PAID" });
    expect(body).not.toHaveProperty("message");
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock).toHaveBeenCalledWith("inv-1", { minIntervalMs: 10_000 });
  });

  it("passes NO_CHANGE through", async () => {
    await asSession(session());
    reconcileMock.mockResolvedValue({
      code: "NO_CHANGE",
      message: "Baru saja diperiksa.",
      provider: "xendit",
      gatewayStatus: null,
      statusBefore: "OVERDUE",
      statusAfter: "OVERDUE",
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "NO_CHANGE", status: "OVERDUE" });
  });

  it("falls back to the invoice status when the result carries none", async () => {
    await asSession(session());
    reconcileMock.mockResolvedValue({
      code: "UNAVAILABLE",
      message: "x",
      provider: "xendit",
      gatewayStatus: null,
      statusBefore: null,
      statusAfter: null,
    });
    const res = await call();
    expect(await res.json()).toEqual({ code: "UNAVAILABLE", status: "SENT" });
  });

  it("maps a GATEWAY_ERROR result to 200 with that code", async () => {
    await asSession(session());
    reconcileMock.mockResolvedValue({
      code: "GATEWAY_ERROR",
      message: "Gateway down",
      provider: "xendit",
      gatewayStatus: null,
      statusBefore: "SENT",
      statusAfter: null,
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "GATEWAY_ERROR", status: "SENT" });
  });

  it("a throwing reconciler becomes 200 GATEWAY_ERROR with the current status and is logged", async () => {
    await asSession(session());
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    reconcileMock.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "GATEWAY_ERROR", status: "SENT" });
    expect(errSpy).toHaveBeenCalledWith("[GUARDIAN CHECK PAYMENT] failed", {
      invoiceId: "inv-1",
      error: "boom",
    });
    errSpy.mockRestore();
  });
});
