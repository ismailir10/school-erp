/**
 * GET /api/invoices/[id]/pdf — the admin kuitansi (FINX-9). Same PDF as the
 * guardian route (shared builder in lib/pdf/receipt-data.ts); this file covers
 * the admin gate, tenant scoping and the PAID / PARTIALLY_PAID-only rule.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSession, renderToBuffer, db } = vi.hoisted(() => ({
  getSession: vi.fn(),
  renderToBuffer: vi.fn(),
  db: {
    invoice: { findFirst: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession };
});
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer,
  StyleSheet: { create: (x: unknown) => x },
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Image: "Image",
}));
vi.mock("@/lib/pdf/invoice-receipt", () => ({ InvoiceReceiptPdf: "InvoiceReceiptPdf" }));

import { GET } from "../invoices/[id]/pdf/route";

const ctx = { params: Promise.resolve({ id: "inv-1" }) };

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "u-1",
    email: "a@t.local",
    name: "Bu Nur",
    role: "SCHOOL_ADMIN",
    tenantId: "t-1",
    employeeId: null,
    parentId: null,
    permissions: ["payments.record"] as string[],
    customRoleCode: null,
    ...overrides,
  };
}

const paidInvoice = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  tenantId: "t-1",
  studentId: "stu-1",
  invoiceNumber: "INV-0001",
  periodLabel: "April 2026",
  dueDate: new Date("2026-04-30"),
  totalDue: 500_000,
  totalPaid: 500_000,
  status: "PAID",
  paidAt: new Date("2026-04-15"),
  lines: [],
  payments: [{ id: "p1", amount: 500_000, method: "CASH", reference: null, paidAt: new Date("2026-04-15") }],
  student: { name: "Anak", nickname: "Nak", enrollments: [] },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(session());
  db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
  renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
});

describe("GET /api/invoices/[id]/pdf", () => {
  it.each([
    ["unauthenticated", null],
    ["a guardian", session({ role: "GUARDIAN", parentId: "par-1" })],
    ["a teacher", session({ role: "TEACHER", permissions: [] })],
    ["an admin without payments.record", session({ permissions: ["invoices.view"] })],
    ["a session without a tenant", session({ tenantId: null })],
  ])("403 for %s — nothing is read", async (_label, s) => {
    getSession.mockResolvedValue(s);
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(403);
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("404 for another tenant's invoice — the lookup is tenant-scoped", async () => {
    db.invoice.findFirst.mockResolvedValue(null);
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(404);
    expect(db.invoice.findFirst.mock.calls[0][0].where).toEqual({ id: "inv-1", tenantId: "t-1" });
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "SENT", "OVERDUE", "CANCELLED"])("409 with Indonesian copy for a %s invoice", async (status) => {
    db.invoice.findFirst.mockResolvedValue(paidInvoice({ status }));
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Kuitansi hanya tersedia untuk tagihan yang sudah dibayar.");
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("200 application/pdf for a PAID invoice, same filename as the guardian route", async () => {
    db.invoice.findFirst.mockResolvedValue(paidInvoice());
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="kuitansi-INV-0001.pdf"');
    const data = renderToBuffer.mock.calls[0]![0].props.data;
    expect(data).toMatchObject({ schoolName: "An Nisaa", invoiceNumber: "INV-0001", totalPaid: 500_000, remaining: 0 });
    expect(data.payments[0].method).toBe("Tunai");
  });

  it("200 for a PARTIALLY_PAID invoice, printing what is still owed", async () => {
    db.invoice.findFirst.mockResolvedValue(paidInvoice({ status: "PARTIALLY_PAID", totalPaid: 200_000, paidAt: null }));
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    const data = renderToBuffer.mock.calls[0]![0].props.data;
    expect(data.remaining).toBe(300_000);
    expect(data.paidAt).toBeNull();
  });

  it("SUPER_ADMIN with the permission is allowed too", async () => {
    getSession.mockResolvedValue(session({ role: "SUPER_ADMIN" }));
    db.invoice.findFirst.mockResolvedValue(paidInvoice());
    expect((await GET({} as never, ctx)).status).toBe(200);
  });
});
