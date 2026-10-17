import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth";

/**
 * GET /api/invoices/reminders and POST /api/invoices/[id]/reminder — the WhatsApp reminder
 * queue and its bookkeeping (cycle 2026-10-17-payment-link-reminders, T4). The message text
 * and queue order live in `lib/finance`; pinned here: who may call, tenant scoping, the
 * stamp + count + audit in one transaction, and the 409 / 422 / 429 refusals.
 */

const { getSessionMock, invFindMany, invFindFirst, invUpdate, userFindMany, rateLimitMock, auditMock, txMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  invFindMany: vi.fn(),
  invFindFirst: vi.fn(),
  invUpdate: vi.fn(),
  userFindMany: vi.fn(),
  rateLimitMock: vi.fn(),
  auditMock: vi.fn(),
  txMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findMany: invFindMany, findFirst: invFindFirst, fields: { totalDue: "totalDue-ref" } },
    user: { findMany: userFindMany },
    $transaction: txMock,
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: rateLimitMock }));
vi.mock("@/lib/audit", () => ({ recordAudit: auditMock }));

import { GET } from "../invoices/reminders/route";
import { POST } from "../invoices/[id]/reminder/route";

function session(permissions: string[] = ["payments.record"], role: SessionUser["role"] = "SCHOOL_ADMIN"): SessionUser {
  return { id: "u1", email: "a@t.local", name: "Admin", role, tenantId: "t1", employeeId: null, parentId: null, permissions, customRoleCode: null };
}

type Over = Record<string, unknown>;
function invoice(over: Over = {}) {
  return {
    id: "inv-1",
    tenantId: "t1",
    invoiceNumber: "INV-2026-0001",
    periodLabel: "Oktober 2026",
    dueDate: "2026-10-10",
    status: "SENT",
    totalDue: "500000",
    totalPaid: "100000",
    xenditPaymentUrl: "https://checkout.doku.com/x",
    lastRemindedAt: null,
    lastRemindedBy: null,
    remindCount: 0,
    student: { name: "Aisyah", guardians: [{ parent: { name: "Budi", whatsapp: "0812-1111-2222", phone: null } }] },
    ...over,
  };
}
const noNumber = { name: "Aisyah", guardians: [{ parent: { name: "Budi", whatsapp: null, phone: null } }] };

const getReq = (qs = "") => new Request(`http://localhost:3000/api/invoices/reminders${qs}`) as unknown as NextRequest;
const postReq = () => new Request("http://localhost:3000/api/invoices/inv-1/reminder", { method: "POST" }) as unknown as NextRequest;
const ctx = (id = "inv-1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(session());
  rateLimitMock.mockReturnValue({ success: true, remaining: 59 });
  invFindMany.mockResolvedValue([]);
  userFindMany.mockResolvedValue([]);
  invFindFirst.mockResolvedValue(invoice());
  invUpdate.mockImplementation(async ({ data }) => ({ lastRemindedAt: data.lastRemindedAt, remindCount: 1 }));
  txMock.mockImplementation(async (fn) => fn({ invoice: { update: invUpdate } }));
});

describe("GET /api/invoices/reminders", () => {
  it("403 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await GET(getReq())).status).toBe(403);
    expect(invFindMany).not.toHaveBeenCalled();
  });

  it("403 for a non-admin role", async () => {
    getSessionMock.mockResolvedValue(session(["payments.record"], "TEACHER"));
    expect((await GET(getReq())).status).toBe(403);
  });

  it("403 without payments.record (invoices.view alone is not enough)", async () => {
    getSessionMock.mockResolvedValue(session(["invoices.view"]));
    expect((await GET(getReq())).status).toBe(403);
    expect(invFindMany).not.toHaveBeenCalled();
  });

  it("asks only for this tenant's unpaid invoices that still owe money", async () => {
    await GET(getReq());
    expect(invFindMany.mock.calls[0][0].where).toEqual({
      tenantId: "t1",
      status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      totalPaid: { lt: "totalDue-ref" },
    });
  });

  it("selects only the columns the queue reads, with the guardian's name and numbers", async () => {
    await GET(getReq());
    const args = invFindMany.mock.calls[0][0];
    expect(args.include).toBeUndefined();
    expect(args.select).toMatchObject({ id: true, totalDue: true, totalPaid: true, xenditPaymentUrl: true, remindCount: true });
    expect(args.select).not.toHaveProperty("tenantId");
    expect(args.select.student.select.guardians).toEqual({
      where: { isPrimary: true, status: "ACTIVE" },
      take: 1,
      select: { parent: { select: { name: true, whatsapp: true, phone: true } } },
    });
  });

  it("caps the fetch at 2000 and says so in meta.truncated only when the cap was hit", async () => {
    await GET(getReq());
    expect(invFindMany.mock.calls[0][0].take).toBe(2000);
    expect((await (await GET(getReq())).json()).meta.truncated).toBe(false);

    invFindMany.mockResolvedValue(Array.from({ length: 2000 }, (_, i) => invoice({ id: `i${i}`, invoiceNumber: `N${i}` })));
    expect((await (await GET(getReq())).json()).meta.truncated).toBe(true);
  });

  it("orders never-reminded first, then oldest reminder, then oldest due date", async () => {
    invFindMany.mockResolvedValue([
      invoice({ id: "recent", invoiceNumber: "C", lastRemindedAt: new Date("2026-10-16T00:00:00Z"), lastRemindedBy: "u9" }),
      invoice({ id: "never-late", invoiceNumber: "B", dueDate: "2026-10-15" }),
      invoice({ id: "old", invoiceNumber: "D", lastRemindedAt: new Date("2026-10-01T00:00:00Z") }),
      invoice({ id: "never-early", invoiceNumber: "A", dueDate: "2026-10-01" }),
    ]);
    userFindMany.mockResolvedValue([{ id: "u9", name: "Siti", email: "s@t.local" }]);
    const body = await (await GET(getReq())).json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["never-early", "never-late", "old", "recent"]);
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 4, totalPages: 1 });
    const recent = body.data[3];
    expect(recent).toMatchObject({ lastRemindedAt: "2026-10-16T00:00:00.000Z", lastRemindedByName: "Siti" });
    expect(userFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["u9"] }, tenantId: "t1" });
  });

  it("counts invoices without a usable number in meta.excludedNoNumber and leaves them out", async () => {
    invFindMany.mockResolvedValue([
      invoice({ id: "ok" }),
      invoice({ id: "nope", student: noNumber }),
      invoice({ id: "none", student: { name: "X", guardians: [] } }),
    ]);
    const body = await (await GET(getReq())).json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["ok"]);
    expect(body.meta).toEqual({ excludedNoNumber: 2, truncated: false });
    expect(body.pagination.total).toBe(1);
  });

  it("gives a waUrl only when the invoice has a payment link", async () => {
    invFindMany.mockResolvedValue([
      invoice({ id: "linked", invoiceNumber: "A" }),
      invoice({ id: "unlinked", invoiceNumber: "B", xenditPaymentUrl: null }),
    ]);
    const body = await (await GET(getReq())).json();
    const [linked, unlinked] = body.data;
    expect(linked.hasLink).toBe(true);
    expect(decodeURIComponent(linked.waUrl)).toContain("https://checkout.doku.com/x");
    expect(unlinked).toMatchObject({ hasLink: false, waUrl: null });
    expect(linked).toMatchObject({ remaining: 400000, totalDue: 500000, totalPaid: 100000, studentName: "Aisyah", guardianName: "Budi", remindCount: 0, lastRemindedByName: null });
  });

  it("drops settled invoices and paginates the queue in memory", async () => {
    invFindMany.mockResolvedValue([
      invoice({ id: "a", invoiceNumber: "A" }),
      invoice({ id: "b", invoiceNumber: "B" }),
      invoice({ id: "c", invoiceNumber: "C" }),
      invoice({ id: "paid", invoiceNumber: "D", totalPaid: "500000" }),
    ]);
    const body = await (await GET(getReq("?page=2&pageSize=2"))).json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["c"]);
    expect(body.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });

  it("is never cached", async () => {
    expect((await GET(getReq())).headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/invoices/[id]/reminder", () => {
  it("403 without a session, for a non-admin and without payments.record", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    expect((await POST(postReq(), ctx())).status).toBe(403);
    getSessionMock.mockResolvedValueOnce(session(["payments.record"], "TEACHER"));
    expect((await POST(postReq(), ctx())).status).toBe(403);
    getSessionMock.mockResolvedValueOnce(session(["invoices.view", "invoices.create"]));
    expect((await POST(postReq(), ctx())).status).toBe(403);
    expect(invFindFirst).not.toHaveBeenCalled();
  });

  it("429 when pressed too often, before touching the database", async () => {
    rateLimitMock.mockReturnValue({ success: false, remaining: 0 });
    expect((await POST(postReq(), ctx())).status).toBe(429);
    expect(rateLimitMock).toHaveBeenCalledWith("invoice-reminder:u1", 60, 60_000);
    expect(invFindFirst).not.toHaveBeenCalled();
  });

  it("404 for another school's invoice (looked up by id AND tenant)", async () => {
    invFindFirst.mockResolvedValue(null);
    expect((await POST(postReq(), ctx("theirs"))).status).toBe(404);
    expect(invFindFirst.mock.calls[0][0].where).toEqual({ id: "theirs", tenantId: "t1" });
    expect(invUpdate).not.toHaveBeenCalled();
  });

  it.each(["PAID", "CANCELLED", "DRAFT"])("409 for a %s invoice", async (status) => {
    invFindFirst.mockResolvedValue(invoice({ status }));
    expect((await POST(postReq(), ctx())).status).toBe(409);
    expect(invUpdate).not.toHaveBeenCalled();
  });

  it("409 when nothing is left to pay, with copy that fits every refusal", async () => {
    invFindFirst.mockResolvedValue(invoice({ totalPaid: "500000" }));
    const res = await POST(postReq(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Tagihan ini tidak perlu diingatkan sekarang.");
  });

  it("422 when the guardian has no number WhatsApp can open", async () => {
    invFindFirst.mockResolvedValue(invoice({ student: noNumber }));
    expect((await POST(postReq(), ctx())).status).toBe(422);
    expect(invUpdate).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("stamps time and admin, increments the count and audits in the same transaction", async () => {
    invFindFirst.mockResolvedValue(
      invoice({ remindCount: 2, lastRemindedAt: new Date("2026-10-01T00:00:00Z"), lastRemindedBy: "u7" }),
    );
    invUpdate.mockImplementation(async ({ data }) => ({ lastRemindedAt: data.lastRemindedAt, remindCount: 3 }));
    const res = await POST(postReq(), ctx());
    expect(res.status).toBe(200);

    const update = invUpdate.mock.calls[0][0];
    expect(update.where).toEqual({ id: "inv-1" });
    expect(update.data.lastRemindedBy).toBe("u1");
    expect(update.data.lastRemindedAt).toBeInstanceOf(Date);
    expect(update.data.remindCount).toEqual({ increment: 1 });

    const [entry, tx] = auditMock.mock.calls[0];
    expect(tx).toEqual({ invoice: { update: invUpdate } });
    expect(entry).toMatchObject({
      tenantId: "t1",
      actorId: "u1",
      entity: "Invoice",
      entityId: "inv-1",
      action: "remind",
      before: { lastRemindedAt: "2026-10-01T00:00:00.000Z", lastRemindedBy: "u7", remindCount: 2 },
      after: { lastRemindedBy: "u1", remindCount: 3 },
    });

    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["lastRemindedAt", "remindCount", "waUrl"]);
    expect(body.remindCount).toBe(3);
    expect(body.lastRemindedAt).toBe(update.data.lastRemindedAt.toISOString());
  });

  it("builds the message with the payment link when there is one", async () => {
    const body = await (await POST(postReq(), ctx())).json();
    expect(body.waUrl).toMatch(/^https:\/\/wa\.me\/62812/);
    expect(decodeURIComponent(body.waUrl)).toContain("https://checkout.doku.com/x");
  });

  it("falls back to the parent portal address without a link", async () => {
    invFindFirst.mockResolvedValue(invoice({ xenditPaymentUrl: null }));
    const body = await (await POST(postReq(), ctx())).json();
    expect(decodeURIComponent(body.waUrl)).toContain("http://localhost:3000/parent/invoices");
  });

  it("fails the request when the audit row cannot be written (the transaction aborts)", async () => {
    auditMock.mockRejectedValueOnce(new Error("audit down"));
    await expect(POST(postReq(), ctx())).rejects.toThrow("audit down");
  });
});
