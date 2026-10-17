import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth";

/**
 * POST /api/invoices/[id]/replace-payment-link — "Buat link baru" on one invoice (cycle
 * 2026-10-17-payment-link-reminders, T7). Pinned here: who may call, tenant scoping, that the
 * gateway is asked first (paid → no new link, unreadable → old link kept), that the old link
 * is cleared by compare-and-swap before the new one is made, and the audit + cache bust.
 */

const { getSessionMock, invFindFirst, invUpdateMany, rateLimitMock, auditMock, reconcileMock, ensureMock, revalidateMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    invFindFirst: vi.fn(),
    invUpdateMany: vi.fn(),
    rateLimitMock: vi.fn(),
    auditMock: vi.fn(),
    reconcileMock: vi.fn(),
    ensureMock: vi.fn(),
    revalidateMock: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("@/lib/db", () => ({ prisma: { invoice: { findFirst: invFindFirst, updateMany: invUpdateMany } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("@/lib/audit", () => ({ recordAudit: auditMock }));
vi.mock("@/lib/payments/reconcile", () => ({ reconcileInvoicePayment: reconcileMock }));
vi.mock("@/lib/payments/ensure-link", () => ({
  ensurePaymentLink: ensureMock,
  staleLinkCleared: (now: Date) => ({ cleared: true, paymentCheckedAt: now }),
}));
vi.mock("next/cache", () => ({ revalidateTag: revalidateMock }));

import { POST } from "../invoices/[id]/replace-payment-link/route";

function session(permissions: string[] = ["invoices.create"], role: SessionUser["role"] = "SCHOOL_ADMIN"): SessionUser {
  return { id: "u1", email: "a@t.local", name: "Admin", role, tenantId: "t1", employeeId: null, parentId: null, permissions, customRoleCode: null };
}

const OLD = { xenditSessionId: "sess-old", xenditPaymentUrl: "https://checkout.doku.com/old" };
function invoice(over: Record<string, unknown> = {}) {
  return { status: "SENT", totalDue: "500000", totalPaid: "0", ...OLD, ...over };
}

const req = () => new Request("http://localhost:3000/api/invoices/inv-1/replace-payment-link", { method: "POST" }) as unknown as NextRequest;
const ctx = () => ({ params: Promise.resolve({ id: "inv-1" }) });
const call = () => POST(req(), ctx());

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getSessionMock.mockResolvedValue(session());
  rateLimitMock.mockReturnValue({ success: true, remaining: 9 });
  invFindFirst.mockResolvedValue(invoice());
  invUpdateMany.mockResolvedValue({ count: 1 });
  reconcileMock.mockResolvedValue({ code: "NO_CHANGE", gatewayStatus: "ACTIVE" });
  ensureMock.mockResolvedValue({ kind: "READY", paymentUrl: "https://checkout.doku.com/new", created: true });
});

describe("access", () => {
  it("403 without a session, for a non-admin, or without invoices.create", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await call()).status).toBe(403);
    getSessionMock.mockResolvedValue(session(["invoices.create"], "TEACHER"));
    expect((await call()).status).toBe(403);
    getSessionMock.mockResolvedValue(session(["payments.record"]));
    expect((await call()).status).toBe(403);
    expect(invFindFirst).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("429 once the admin keeps pressing, before any lookup", async () => {
    rateLimitMock.mockReturnValue({ success: false, remaining: 0 });
    expect((await call()).status).toBe(429);
    expect(rateLimitMock).toHaveBeenCalledWith("replace-payment-link:u1", 10, 60_000);
    expect(invFindFirst).not.toHaveBeenCalled();
  });

  it("404 for another school's invoice: the lookup is scoped to the tenant and nothing reaches the gateway", async () => {
    invFindFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(invFindFirst.mock.calls[0][0].where).toEqual({ id: "inv-1", tenantId: "t1" });
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it.each([
    ["paid", { status: "PAID", totalPaid: "500000" }],
    ["cancelled", { status: "CANCELLED" }],
    ["draft", { status: "DRAFT" }],
    ["unpaid but nothing owed", { status: "PARTIALLY_PAID", totalPaid: "500000" }],
  ])("409 for an invoice that is %s", async (_name, over) => {
    invFindFirst.mockResolvedValue(invoice(over));
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Tagihan ini tidak perlu link baru." });
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(invUpdateMany).not.toHaveBeenCalled();
    expect(ensureMock).not.toHaveBeenCalled();
  });
});

describe("asking the gateway first", () => {
  it("the gateway says it was paid: PAID, no new link, old link untouched", async () => {
    reconcileMock.mockResolvedValue({ code: "UPDATED", gatewayStatus: "SUCCESS" });
    invFindFirst.mockResolvedValueOnce(invoice()).mockResolvedValueOnce(invoice({ status: "PAID", totalPaid: "500000" }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "PAID", message: "Pembayaran sudah masuk dan dicatat. Link baru tidak dibuat." });
    expect(invUpdateMany).not.toHaveBeenCalled();
    expect(ensureMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it.each([
    ["GATEWAY_ERROR", { code: "GATEWAY_ERROR", gatewayStatus: null }],
    ["UNAVAILABLE for another reason", { code: "UNAVAILABLE", gatewayStatus: null, unavailableReason: "GATEWAY_BUSY" }],
    ["NO_CHANGE with a status that is not a plain unpaid checkout", { code: "NO_CHANGE", gatewayStatus: "REFUNDED" }],
    // A skipped or throttled check never reached the gateway: no evidence, not "unpaid".
    ["NO_CHANGE from a check that never reached the gateway", { code: "NO_CHANGE", gatewayStatus: null }],
  ])("%s: 502, the old link is kept and not cleared", async (_name, result) => {
    reconcileMock.mockResolvedValue(result);
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Link belum bisa diperiksa. Coba lagi sebentar lagi." });
    expect(invUpdateMany).not.toHaveBeenCalled();
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it.each([
    ["without a session id", "NO_SESSION_ID"],
    ["for an unknown link host", "UNKNOWN_LINK_PROVIDER"],
  ])("UNAVAILABLE %s fails the same way every time: 502 with a message that says so, old link kept", async (_name, unavailableReason) => {
    reconcileMock.mockResolvedValue({ code: "UNAVAILABLE", gatewayStatus: null, unavailableReason });
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Link ini tidak bisa diperiksa otomatis. Hubungi tim teknis." });
    expect(invUpdateMany).not.toHaveBeenCalled();
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("a throwing check is a 502 too, with no raw error in the body", async () => {
    reconcileMock.mockRejectedValue(new Error("boom: secret"));
    const res = await call();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(invUpdateMany).not.toHaveBeenCalled();
  });

  it("an invoice with no link is not checked at the gateway and just gets one", async () => {
    invFindFirst.mockResolvedValue(invoice({ xenditSessionId: null, xenditPaymentUrl: null }));
    const res = await call();
    expect(await res.json()).toEqual({ outcome: "REPLACED", url: "https://checkout.doku.com/new", created: true });
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(invUpdateMany).not.toHaveBeenCalled();
    expect(ensureMock).toHaveBeenCalledTimes(1);
  });
});

describe("replacing the link", () => {
  it("a live link: CAS-clears exactly the link that was read, then makes the new one", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "REPLACED", url: "https://checkout.doku.com/new", created: true });

    const update = invUpdateMany.mock.calls[0][0];
    expect(update.where).toEqual({
      id: "inv-1",
      tenantId: "t1",
      // Only while still unpaid: a payment landing mid-flight must not lose its link.
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      xenditSessionId: "sess-old",
      xenditPaymentUrl: "https://checkout.doku.com/old",
    });
    expect(update.data).toMatchObject({ cleared: true });
    expect(update.data.paymentCheckedAt).toBeInstanceOf(Date);
    expect(reconcileMock.mock.invocationCallOrder[0]).toBeLessThan(invUpdateMany.mock.invocationCallOrder[0]);
    expect(invUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(ensureMock.mock.invocationCallOrder[0]);
    expect(ensureMock).toHaveBeenCalledWith("inv-1", "t1", "http://localhost:3000");
  });

  it.each(["ORDER_GENERATED", "PENDING"])(
    "a live order nobody has paid on yet (%s) is replaced",
    async (gatewayStatus) => {
      reconcileMock.mockResolvedValue({ code: "NO_CHANGE", gatewayStatus });
      const res = await call();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ outcome: "REPLACED", url: "https://checkout.doku.com/new", created: true });
      expect(invUpdateMany).toHaveBeenCalledTimes(1);
      expect(ensureMock).toHaveBeenCalledTimes(1);
    },
  );

  it("a gateway that has no order for the link (404) holds nothing paid on it: it is replaced", async () => {
    reconcileMock.mockResolvedValue({ code: "UNAVAILABLE", gatewayStatus: null, unavailableReason: "ORDER_NOT_FOUND" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(invUpdateMany).toHaveBeenCalledTimes(1);
    expect(ensureMock).toHaveBeenCalledTimes(1);
  });

  it("the reconcile already cleared an expired link: nothing left to clear, a new one is made", async () => {
    reconcileMock.mockResolvedValue({ code: "UPDATED", gatewayStatus: "EXPIRED" });
    invFindFirst
      .mockResolvedValueOnce(invoice())
      .mockResolvedValueOnce(invoice({ status: "OVERDUE", xenditSessionId: null, xenditPaymentUrl: null }));
    const res = await call();
    expect(await res.json()).toEqual({ outcome: "REPLACED", url: "https://checkout.doku.com/new", created: true });
    expect(invUpdateMany).not.toHaveBeenCalled();
    expect(ensureMock).toHaveBeenCalledTimes(1);
  });

  it("a partial payment credited by the check: the link is replaced so it charges the new remainder", async () => {
    reconcileMock.mockResolvedValue({ code: "UPDATED", gatewayStatus: "SUCCESS" });
    invFindFirst
      .mockResolvedValueOnce(invoice())
      .mockResolvedValueOnce(invoice({ status: "PARTIALLY_PAID", totalPaid: "200000" }));
    const res = await call();
    expect((await res.json()).outcome).toBe("REPLACED");
    expect(invUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("another admin replaced it first (CAS count 0): their link is returned and no third is made", async () => {
    invUpdateMany.mockResolvedValue({ count: 0 });
    invFindFirst
      .mockResolvedValueOnce(invoice()) // initial read
      .mockResolvedValueOnce(invoice()) // after the check
      .mockResolvedValueOnce(invoice({ xenditSessionId: "sess-2", xenditPaymentUrl: "https://checkout.doku.com/theirs" }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "REPLACED", url: "https://checkout.doku.com/theirs", created: false });
    expect(ensureMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("CAS lost to a clear (the link is gone, nobody made a new one yet): a new one is made", async () => {
    invUpdateMany.mockResolvedValue({ count: 0 });
    invFindFirst
      .mockResolvedValueOnce(invoice())
      .mockResolvedValueOnce(invoice())
      .mockResolvedValueOnce(invoice({ xenditSessionId: null, xenditPaymentUrl: null }));
    const res = await call();
    expect((await res.json()).url).toBe("https://checkout.doku.com/new");
    expect(ensureMock).toHaveBeenCalledTimes(1);
  });

  it("CAS lost because the invoice was paid meanwhile: PAID like the pre-check, no new link", async () => {
    invUpdateMany.mockResolvedValue({ count: 0 });
    invFindFirst
      .mockResolvedValueOnce(invoice())
      .mockResolvedValueOnce(invoice())
      .mockResolvedValueOnce(invoice({ status: "PAID", totalPaid: "500000" }));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "PAID", message: "Pembayaran sudah masuk dan dicatat. Link baru tidak dibuat." });
    expect(ensureMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("FAILED: 502 says the link will be retried, and the cache is still busted because the old link is gone", async () => {
    ensureMock.mockResolvedValue({ kind: "FAILED" });
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Link baru belum berhasil dibuat. Sistem akan mencoba lagi otomatis, atau coba lagi sebentar lagi.");
    // The old link is gone, so that is audited even though no new one exists.
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: "replace-payment-link",
      before: { url: "https://checkout.doku.com/old" },
      after: { url: null },
    });
    expect(revalidateMock).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
  });

  it("NOT_PAYABLE (it stopped being payable meanwhile): 409", async () => {
    ensureMock.mockResolvedValue({ kind: "NOT_PAYABLE" });
    expect((await call()).status).toBe(409);
  });
});

describe("bookkeeping", () => {
  it("audits the clear right after the CAS and the new url once it exists, and busts both parent-facing cache tags", async () => {
    await call();
    const entry = { tenantId: "t1", actorId: "u1", entity: "Invoice", entityId: "inv-1", action: "replace-payment-link" };
    expect(auditMock).toHaveBeenCalledTimes(2);
    expect(auditMock).toHaveBeenNthCalledWith(1, {
      ...entry,
      before: { url: "https://checkout.doku.com/old" },
      after: { url: null },
    });
    expect(auditMock).toHaveBeenNthCalledWith(2, {
      ...entry,
      before: { url: null },
      after: { url: "https://checkout.doku.com/new" },
    });
    expect(invUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(auditMock.mock.invocationCallOrder[0]);
    expect(auditMock.mock.invocationCallOrder[0]).toBeLessThan(ensureMock.mock.invocationCallOrder[0]);
    expect(revalidateMock).toHaveBeenCalledWith("parent-invoice-list", { expire: 0 });
    expect(revalidateMock).toHaveBeenCalledWith("student-invoices", { expire: 0 });
  });

  it("changes nothing, so busts nothing, when the check fails", async () => {
    reconcileMock.mockResolvedValue({ code: "GATEWAY_ERROR", gatewayStatus: null });
    await call();
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
