import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { feeFindFirst, feeFindUnique, feeUpdate, executeRaw, transaction, getSession, isAdminRole, recordAudit } = vi.hoisted(() => ({
  feeFindFirst: vi.fn(),
  feeFindUnique: vi.fn(),
  feeUpdate: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { enrollmentFee: { findFirst: feeFindFirst }, $transaction: transaction },
}));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/audit", () => ({ recordAudit }));

import { PATCH } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const ctx = (id = "app-1") => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/enrollments/app-1/fee", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const FULL = {
  id: "u-1",
  tenantId: "t-1",
  role: "SCHOOL_ADMIN",
  permissions: ["admissions.view", "admissions.edit", "payments.record", "fees.edit"],
};

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
  getSession.mockResolvedValue(FULL);
  isAdminRole.mockReturnValue(true);
  feeFindFirst.mockResolvedValue({ id: "fee-1" });
  feeFindUnique.mockResolvedValue(row());
  feeUpdate.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({ ...row(), ...arg.data }));
  executeRaw.mockResolvedValue(1);
  recordAudit.mockResolvedValue(undefined);
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ $executeRaw: executeRaw, enrollmentFee: { findUnique: feeFindUnique, update: feeUpdate } }),
  );
});

describe("PATCH /api/enrollments/[id]/fee — access", () => {
  it("401/403 without a session or a non-admin", async () => {
    getSession.mockResolvedValue(null);
    expect((await PATCH(patch({ action: "WAIVE" }), ctx())).status).toBe(403);
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "TEACHER" });
    isAdminRole.mockReturnValue(false);
    expect((await PATCH(patch({ action: "WAIVE" }), ctx())).status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("403 for an admin with only admissions.view, before any read or write", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await PATCH(patch({ action: "WAIVE" }), ctx())).status).toBe(403);
    expect(feeFindFirst).not.toHaveBeenCalled();
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it("finds the fee through the application AND the session's tenant; a foreign or unknown one is 404", async () => {
    feeFindFirst.mockResolvedValue(null);
    const res = await PATCH(patch({ action: "WAIVE" }), ctx("other-tenants-app"));
    expect(res.status).toBe(404);
    expect(feeFindFirst.mock.calls[0][0].where).toEqual({ applicationId: "other-tenants-app", tenantId: "t-1" });
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it("429 once a session has made 30 changes in a minute", async () => {
    for (let i = 0; i < 30; i++) expect((await PATCH(patch({ action: "WAIVE" }), ctx())).status).not.toBe(429);
    expect((await PATCH(patch({ action: "WAIVE" }), ctx())).status).toBe(429);
  });
});

describe("PATCH /api/enrollments/[id]/fee — validation", () => {
  it.each([
    ["invalid JSON", "{nope"],
    ["no action", {}],
    ["an unknown action", { action: "REFUND" }],
    ["a discount above 100", { action: "DISCOUNT", discountPercent: 101, reason: "x" }],
    ["a negative discount", { action: "DISCOUNT", discountPercent: -5, reason: "x" }],
    ["a fractional discount", { action: "DISCOUNT", discountPercent: 12.5, reason: "x" }],
    ["a string discount", { action: "DISCOUNT", discountPercent: "20", reason: "x" }],
    ["a discount with no reason", { action: "DISCOUNT", discountPercent: 20 }],
    ["a discount with a blank reason", { action: "DISCOUNT", discountPercent: 20, reason: "   " }],
    ["mark paid with an unknown method", { action: "MARK_PAID", method: "DOKU" }],
    ["mark paid with no method", { action: "MARK_PAID" }],
    ["a note over 300 characters", { action: "WAIVE", note: "x".repeat(301) }],
  ])("400 for %s, and nothing is read or written", async (_n, body) => {
    const res = await PATCH(patch(body), ctx());
    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it("ignores any amount or status a client sends alongside a valid action", async () => {
    await PATCH(patch({ action: "WAIVE", amount: 1, status: "PAID", tenantId: "evil", paymentId: "x" }), ctx());
    const data = feeUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("WAIVED");
    expect(data).not.toHaveProperty("amount");
    expect(data).not.toHaveProperty("tenantId");
    expect(data).not.toHaveProperty("paymentId");
  });
});

describe("PATCH /api/enrollments/[id]/fee — DISCOUNT", () => {
  it("re-prices from the snapshotted base fee, records the reason, and drops any stored payment link", async () => {
    const res = await PATCH(patch({ action: "DISCOUNT", discountPercent: 20, reason: "Early bird gelombang 1" }), ctx());
    expect(res.status).toBe(200);

    const data = feeUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({ discountPercent: 20, discountReason: "Early bird gelombang 1", amount: 240_000 });
    expect(data).toMatchObject({ paymentUrl: null, sessionExpiresAt: null, linkError: null });
    // The session id is KEPT: a parent who already opened the old order can still
    // pay it, and reconcile / the sweep poll on that id so the payment stays findable.
    expect(data).not.toHaveProperty("gatewaySessionId");
    // Still owed: the status is not touched.
    expect(data).not.toHaveProperty("status");
    const body = await res.json();
    expect(body.fee).toMatchObject({ status: "UNPAID", amount: 240_000, baseAmount: 300_000, discountPercent: 20 });
  });

  it("a discount is applied to the BASE, never compounded on an earlier one", async () => {
    feeFindUnique.mockResolvedValue(row({ discountPercent: 20, amount: "240000" }));
    await PATCH(patch({ action: "DISCOUNT", discountPercent: 50, reason: "Saudara kandung" }), ctx());
    expect(feeUpdate.mock.calls[0][0].data.amount).toBe(150_000);
  });

  it("0 clears the discount and its reason and restores the full fee", async () => {
    feeFindUnique.mockResolvedValue(row({ discountPercent: 20, discountReason: "x", amount: "240000" }));
    await PATCH(patch({ action: "DISCOUNT", discountPercent: 0 }), ctx());
    expect(feeUpdate.mock.calls[0][0].data).toMatchObject({ discountPercent: 0, discountReason: null, amount: 300_000 });
  });

  it("100 waives the fee outright", async () => {
    const res = await PATCH(patch({ action: "DISCOUNT", discountPercent: 100, reason: "Beasiswa" }), ctx());
    expect(res.status).toBe(200);
    expect(feeUpdate.mock.calls[0][0].data).toMatchObject({ amount: 0, status: "WAIVED", method: "WAIVED", markedBy: "u-1" });
    expect((await res.json()).fee.status).toBe("WAIVED");
  });

  it("warns (hadLiveLink) when the parent holds a link that still works, so staff can think before changing the amount under them", async () => {
    feeFindUnique.mockResolvedValue(row({ paymentUrl: "https://doku.example/x", sessionExpiresAt: new Date(Date.now() + 86_400_000) }));
    const body = await (await PATCH(patch({ action: "DISCOUNT", discountPercent: 20, reason: "x" }), ctx())).json();
    expect(body.hadLiveLink).toBe(true);
  });

  it("no warning when there is no live link", async () => {
    const body = await (await PATCH(patch({ action: "DISCOUNT", discountPercent: 20, reason: "x" }), ctx())).json();
    expect(body.hadLiveLink).toBe(false);
  });
});

describe("PATCH /api/enrollments/[id]/fee — MARK_PAID and WAIVE", () => {
  it("MARK_PAID: paid by cash, who and when recorded, link dropped", async () => {
    const res = await PATCH(patch({ action: "MARK_PAID", method: "CASH", note: "Dibayar di TU" }), ctx());
    expect(res.status).toBe(200);
    const data = feeUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "PAID", method: "CASH", markedBy: "u-1", note: "Dibayar di TU", paymentUrl: null });
    expect(data.paidAt).toBeInstanceOf(Date);
    expect((await res.json()).fee.status).toBe("PAID");
  });

  it("MARK_PAID by bank transfer, with no note", async () => {
    await PATCH(patch({ action: "MARK_PAID", method: "BANK_TRANSFER" }), ctx());
    expect(feeUpdate.mock.calls[0][0].data).toMatchObject({ method: "BANK_TRANSFER", note: null });
  });

  it("WAIVE: waived, who recorded, link dropped", async () => {
    await PATCH(patch({ action: "WAIVE", note: "Anak guru" }), ctx());
    expect(feeUpdate.mock.calls[0][0].data).toMatchObject({
      status: "WAIVED",
      method: "WAIVED",
      markedBy: "u-1",
      note: "Anak guru",
      paymentUrl: null,
      sessionExpiresAt: null,
    });
    expect(feeUpdate.mock.calls[0][0].data).not.toHaveProperty("gatewaySessionId");
  });
});

describe("PATCH /api/enrollments/[id]/fee — finance permissions on top of admissions.edit", () => {
  const as = (permissions: string[]) =>
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions });

  it("MARK_PAID needs payments.record: an admissions clerk cannot declare a fee paid in cash", async () => {
    as(["admissions.view", "admissions.edit", "fees.edit"]);
    const res = await PATCH(patch({ action: "MARK_PAID", method: "CASH" }), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/izin/);
    expect(feeFindFirst).not.toHaveBeenCalled();
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["WAIVE", { action: "WAIVE" }],
    ["a discount", { action: "DISCOUNT", discountPercent: 20, reason: "x" }],
    ["a 100% discount (which waives)", { action: "DISCOUNT", discountPercent: 100, reason: "x" }],
  ])("%s needs fees.edit: giving up revenue is not an admissions-only power", async (_n, body) => {
    as(["admissions.view", "admissions.edit", "payments.record"]);
    const res = await PATCH(patch(body), ctx());
    expect(res.status).toBe(403);
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it("each key opens only its own actions", async () => {
    as(["admissions.view", "admissions.edit", "payments.record"]);
    expect((await PATCH(patch({ action: "MARK_PAID", method: "BANK_TRANSFER" }), ctx())).status).toBe(200);
    as(["admissions.view", "admissions.edit", "fees.edit"]);
    expect((await PATCH(patch({ action: "WAIVE" }), ctx())).status).toBe(200);
  });

  it("the finance keys alone are not enough: admissions.edit is still the baseline", async () => {
    as(["payments.record", "fees.edit", "admissions.view"]);
    expect((await PATCH(patch({ action: "WAIVE" }), ctx())).status).toBe(403);
  });
});

describe("PATCH /api/enrollments/[id]/fee — a working link survives a change that does not change the price", () => {
  const live = { paymentUrl: "https://doku.example/x", sessionExpiresAt: new Date(Date.now() + 86_400_000) };

  it("re-saving the same percent leaves the link and the session alone", async () => {
    feeFindUnique.mockResolvedValue(row({ discountPercent: 20, discountReason: "Early bird", amount: "240000", ...live }));
    await PATCH(patch({ action: "DISCOUNT", discountPercent: 20, reason: "Early bird" }), ctx());
    const data = feeUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("paymentUrl");
    expect(data).not.toHaveProperty("sessionExpiresAt");
    expect(data).not.toHaveProperty("gatewaySessionId");
  });

  it("setting 0 on an undiscounted fee changes nothing about the link", async () => {
    feeFindUnique.mockResolvedValue(row(live));
    await PATCH(patch({ action: "DISCOUNT", discountPercent: 0 }), ctx());
    expect(feeUpdate.mock.calls[0][0].data).not.toHaveProperty("paymentUrl");
  });

  it("editing only the reason keeps the link too", async () => {
    feeFindUnique.mockResolvedValue(row({ discountPercent: 20, discountReason: "Lama", amount: "240000", ...live }));
    await PATCH(patch({ action: "DISCOUNT", discountPercent: 20, reason: "Baru" }), ctx());
    const data = feeUpdate.mock.calls[0][0].data;
    expect(data.discountReason).toBe("Baru");
    expect(data).not.toHaveProperty("paymentUrl");
  });

  it("an actual price change still drops it", async () => {
    feeFindUnique.mockResolvedValue(row({ discountPercent: 20, amount: "240000", ...live }));
    await PATCH(patch({ action: "DISCOUNT", discountPercent: 30, reason: "x" }), ctx());
    expect(feeUpdate.mock.calls[0][0].data).toMatchObject({ paymentUrl: null, sessionExpiresAt: null });
  });
});

describe("PATCH /api/enrollments/[id]/fee — state and consistency", () => {
  it.each(["PAID", "WAIVED"])("409 and no write when the fee is already %s (a webhook or another admin got there first)", async (status) => {
    feeFindUnique.mockResolvedValue(row({ status }));
    const res = await PATCH(patch({ action: "WAIVE" }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/sudah selesai/);
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("takes the SAME per-fee advisory lock the payment processor takes, and re-reads the status under it", async () => {
    await PATCH(patch({ action: "WAIVE" }), ctx());
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(String(executeRaw.mock.calls[0][0].join("?"))).toContain("pg_advisory_xact_lock(hashtext(");
    expect(executeRaw.mock.calls[0][1]).toBe("fee-1");
    // lock → read → write, in that order
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(feeFindUnique.mock.invocationCallOrder[0]);
    expect(feeFindUnique.mock.invocationCallOrder[0]).toBeLessThan(feeUpdate.mock.invocationCallOrder[0]);
  });

  it("404 when the fee disappears between the lookup and the lock", async () => {
    feeFindUnique.mockResolvedValue(null);
    expect((await PATCH(patch({ action: "WAIVE" }), ctx())).status).toBe(404);
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it("writes an audit row in the SAME transaction with before and after", async () => {
    await PATCH(patch({ action: "DISCOUNT", discountPercent: 20, reason: "Early bird" }), ctx());
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [entry, tx] = recordAudit.mock.calls[0];
    expect(tx).toBeDefined();
    expect(entry).toMatchObject({
      tenantId: "t-1",
      actorId: "u-1",
      entity: "EnrollmentFee",
      entityId: "fee-1",
      action: "fee.discount",
      before: { status: "UNPAID", amount: 300_000, discountPercent: 0 },
      after: { status: "UNPAID", amount: 240_000, discountPercent: 20, reason: "Early bird" },
    });
  });

  it("an audit failure rolls the change back (the audit is required, not best-effort)", async () => {
    recordAudit.mockRejectedValue(new Error("audit down"));
    await expect(PATCH(patch({ action: "WAIVE" }), ctx())).rejects.toThrow("audit down");
  });

  it("the audit names each action", async () => {
    await PATCH(patch({ action: "MARK_PAID", method: "CASH" }), ctx());
    await PATCH(patch({ action: "WAIVE" }), ctx());
    expect(recordAudit.mock.calls.map((c) => c[0].action)).toEqual(["fee.mark_paid", "fee.waive"]);
  });

  it("never returns gateway data", async () => {
    feeFindUnique.mockResolvedValue(row({ paymentUrl: "https://doku.example/SECRET", sessionExpiresAt: new Date(Date.now() + 1e8) }));
    const text = await (await PATCH(patch({ action: "WAIVE" }), ctx())).text();
    expect(text).not.toContain("SECRET");
    expect(text).not.toMatch(/paymentUrl|gatewaySessionId|paymentId/);
  });
});
