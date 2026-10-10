import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { feeFindFirst, feeFindUnique, getSession, isAdminRole, reconcile } = vi.hoisted(() => ({
  feeFindFirst: vi.fn(),
  feeFindUnique: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { enrollmentFee: { findFirst: feeFindFirst, findUnique: feeFindUnique } } }));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/payments/reconcile", () => ({ reconcileEnrollmentFee: reconcile }));

import { POST } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const ctx = (id = "app-1") => ({ params: Promise.resolve({ id }) });
const post = () => new NextRequest("http://localhost/api/enrollments/app-1/fee/refresh", { method: "POST" });

const row = (over: Record<string, unknown> = {}) => ({
  status: "UNPAID",
  method: null,
  baseAmount: "300000",
  discountPercent: 0,
  discountReason: null,
  amount: "300000",
  paidAt: null,
  note: null,
  linkError: null,
  lastCheckedAt: null,
  paymentUrl: null,
  sessionExpiresAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  getSession.mockResolvedValue({
    id: "u-1",
    tenantId: "t-1",
    role: "SCHOOL_ADMIN",
    permissions: ["admissions.view", "admissions.edit", "payments.record"],
  });
  isAdminRole.mockReturnValue(true);
  feeFindFirst.mockResolvedValue({ id: "fee-1" });
  feeFindUnique.mockResolvedValue(row());
  reconcile.mockResolvedValue({ code: "NO_CHANGE", message: "Belum ada pembayaran masuk." });
});

describe("POST /api/enrollments/[id]/fee/refresh", () => {
  it("403 for a viewer without admissions.edit, before the gateway is asked", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await POST(post(), ctx())).status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("403 without payments.record: crediting a payment is a finance action, as it is for invoices", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] });
    expect((await POST(post(), ctx())).status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("403 with payments.record but not admissions.edit", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "payments.record"] });
    expect((await POST(post(), ctx())).status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("surfaces a payment that needs review so it is not mistaken for a quiet no-change", async () => {
    reconcile.mockResolvedValue({ code: "NEEDS_REVIEW", message: "Ada pembayaran yang jumlahnya berbeda dari biaya pendaftaran…" });
    const body = await (await POST(post(), ctx())).json();
    expect(body.code).toBe("NEEDS_REVIEW");
    expect(body.message).toMatch(/jumlahnya berbeda/);
  });

  it("403 for a non-admin", async () => {
    isAdminRole.mockReturnValue(false);
    expect((await POST(post(), ctx())).status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("404 for a fee outside the session's tenant, without polling the gateway", async () => {
    feeFindFirst.mockResolvedValue(null);
    expect((await POST(post(), ctx("foreign"))).status).toBe(404);
    expect(feeFindFirst.mock.calls[0][0].where).toEqual({ applicationId: "foreign", tenantId: "t-1" });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("asks the gateway with no throttle (staff want the answer now) and returns the message and the fresh fee", async () => {
    reconcile.mockResolvedValue({ code: "UPDATED", message: "Pembayaran ditemukan di gateway — biaya pendaftaran ditandai LUNAS." });
    feeFindUnique.mockResolvedValue(row({ status: "PAID", method: "DOKU", paidAt: new Date("2026-10-10T03:05:00.000Z") }));
    const res = await POST(post(), ctx());

    expect(reconcile).toHaveBeenCalledWith("fee-1", { minIntervalMs: 0 });
    const body = await res.json();
    expect(body.code).toBe("UPDATED");
    expect(body.message).toMatch(/LUNAS/);
    expect(body.fee).toMatchObject({ status: "PAID", method: "DOKU", paidAt: "2026-10-10T03:05:00.000Z" });
  });

  it("passes a no-change answer through", async () => {
    const body = await (await POST(post(), ctx())).json();
    expect(body).toMatchObject({ code: "NO_CHANGE", message: "Belum ada pembayaran masuk." });
    expect(body.fee.status).toBe("UNPAID");
  });

  it("never returns gateway data", async () => {
    feeFindUnique.mockResolvedValue(row({ paymentUrl: "https://doku.example/SECRET", sessionExpiresAt: new Date(Date.now() + 1e8) }));
    const text = await (await POST(post(), ctx())).text();
    expect(text).not.toContain("SECRET");
    expect(text).not.toMatch(/paymentUrl|gatewaySessionId|paymentId/);
  });

  it("429 after 20 polls in a minute (each is an outbound gateway request)", async () => {
    for (let i = 0; i < 20; i++) expect((await POST(post(), ctx())).status).toBe(200);
    const res = await POST(post(), ctx());
    expect(res.status).toBe(429);
    expect(reconcile).toHaveBeenCalledTimes(20);
  });
});
