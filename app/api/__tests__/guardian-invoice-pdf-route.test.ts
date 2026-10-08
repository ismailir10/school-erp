/**
 * Guard coverage for `GET /api/guardian/invoices/[id]/pdf` — the kuitansi
 * (paid-invoice receipt) PDF. Mirrors guardian-invoice-detail.test.ts but for
 * the PDF sibling, which shipped the same #397 null-email guard yet had zero
 * regression tests (payments-module-hardening audit, 2026-07-27).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSession, renderToBuffer, db } = vi.hoisted(() => ({
  getSession: vi.fn(),
  renderToBuffer: vi.fn(),
  db: {
    parent: { findFirst: vi.fn() },
    invoice: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ getSession }));
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

import { GET } from "../guardian/invoices/[id]/pdf/route";

const ctx = { params: Promise.resolve({ id: "inv-1" }) };

function guardianSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "u-1",
    email: "g@g.com",
    name: "G",
    role: "GUARDIAN",
    tenantId: "t-1",
    employeeId: null,
    parentId: "par-1",
    permissions: [] as string[],
    customRoleCode: null,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/guardian/invoices/[id]/pdf", () => {
  it("401 when unauthenticated", async () => {
    getSession.mockResolvedValue(null);
    expect((await GET({} as never, ctx)).status).toBe(401);
    expect(db.parent.findFirst).not.toHaveBeenCalled();
  });

  it("403 for non-guardian role", async () => {
    getSession.mockResolvedValue(guardianSession({ role: "SCHOOL_ADMIN" }));
    expect((await GET({} as never, ctx)).status).toBe(403);
    expect(db.parent.findFirst).not.toHaveBeenCalled();
  });

  it("404 when session has neither parentId nor email — never queries (null-email leak regression, #397)", async () => {
    getSession.mockResolvedValue(guardianSession({ parentId: null, email: null }));
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(404);
    expect(db.parent.findFirst).not.toHaveBeenCalled();
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("404 when session has empty-string email and no parentId (null-email leak regression, #397)", async () => {
    getSession.mockResolvedValue(guardianSession({ parentId: null, email: "" }));
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(404);
    expect(db.parent.findFirst).not.toHaveBeenCalled();
  });

  it("404 when invoice belongs to another parent's child (cross-family guard)", async () => {
    getSession.mockResolvedValue(guardianSession());
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "stu-1" }] });
    db.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-other",
      status: "PAID",
      lines: [],
      payments: [],
      student: { name: "X", nickname: null, enrollments: [] },
    });
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(404);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("names the SEMESTER (sekolah) class, never the daycare one, for a dual-enrolled student", async () => {
    getSession.mockResolvedValue(guardianSession());
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "stu-1" }] });
    db.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-1",
      invoiceNumber: "INV-0001",
      periodLabel: "April 2026",
      dueDate: new Date("2026-04-30"),
      totalDue: 250_000,
      totalPaid: 250_000,
      status: "PAID",
      paidAt: new Date("2026-04-15"),
      lines: [],
      payments: [],
      student: {
        name: "Anak",
        nickname: "Nak",
        enrollments: [
          {
            id: "enr-daycare",
            enrollDate: "2025-06-01",
            classSection: { name: "Daycare 1", program: { name: "Daycare", type: "YEAR_ROUND" } },
          },
          {
            id: "enr-sekolah",
            enrollDate: "2025-07-01",
            classSection: { name: "TKIT A", program: { name: "TKIT", type: "SEMESTER" } },
          },
        ],
      },
    });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    const props = renderToBuffer.mock.calls[0]![0].props.data;
    expect(props.className).toBe("TKIT A");
    expect(props.programName).toBe("TKIT");
  });

  it("prints Indonesian method labels in Riwayat Pembayaran, never raw enum names (PARX-9)", async () => {
    getSession.mockResolvedValue(guardianSession());
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "stu-1" }] });
    const payment = (id: string, method: string) => ({
      id,
      amount: 100_000,
      method,
      reference: null,
      paidAt: new Date("2026-04-15"),
    });
    db.invoice.findUnique.mockResolvedValue({
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
      payments: [
        payment("p1", "CASH"),
        payment("p2", "BANK_TRANSFER"),
        payment("p3", "XENDIT"),
        payment("p4", "DOKU"),
        payment("p5", "OTHER"),
      ],
      student: { name: "Anak", nickname: "Nak", enrollments: [] },
    });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    const props = renderToBuffer.mock.calls[0]![0].props.data;
    expect(props.payments.map((p: { method: string }) => p.method)).toEqual([
      "Tunai",
      "Transfer Bank",
      "Virtual Account",
      "Virtual Account",
      "Lainnya",
    ]);
  });

  it("hides the admin's internal payment reference but keeps a gateway reference (R2-P-6)", async () => {
    getSession.mockResolvedValue(guardianSession());
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "stu-1" }] });
    db.invoice.findUnique.mockResolvedValue({
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
      payments: [
        { id: "p1", amount: 250_000, method: "CASH", reference: "TT-Bulan-1", paidAt: new Date("2026-04-10") },
        { id: "p2", amount: 250_000, method: "XENDIT", reference: "xnd_va_123", paidAt: new Date("2026-04-15") },
      ],
      student: { name: "Anak", nickname: "Nak", enrollments: [] },
    });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    const props = renderToBuffer.mock.calls[0]![0].props.data;
    expect(props.payments.map((p: { reference: string | null }) => p.reference)).toEqual([null, "xnd_va_123"]);
  });

  it("issues a receipt for a PARTIALLY_PAID invoice, showing what is still owed (R2-P-6)", async () => {
    getSession.mockResolvedValue(guardianSession());
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "stu-1" }] });
    db.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-1",
      invoiceNumber: "INV-0001",
      periodLabel: "Juli 2026",
      dueDate: new Date("2026-07-30"),
      totalDue: 850_000,
      totalPaid: 400_000,
      status: "PARTIALLY_PAID",
      paidAt: null,
      lines: [],
      payments: [{ id: "p1", amount: 400_000, method: "CASH", reference: "Cicilan-1", paidAt: new Date("2026-07-10") }],
      student: { name: "Anak", nickname: "Nak", enrollments: [] },
    });
    db.tenant.findUnique.mockResolvedValue({ name: "An Nisaa" });
    renderToBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 fake"));

    const res = await GET({} as never, ctx);
    expect(res.status).toBe(200);
    const props = renderToBuffer.mock.calls[0]![0].props.data;
    expect(props.totalPaid).toBe(400_000);
    expect(props.remaining).toBe(450_000);
    expect(props.payments[0].reference).toBeNull();
  });

  it("404 for a non-PAID invoice — no unpaid receipt leaks", async () => {
    getSession.mockResolvedValue(guardianSession());
    db.parent.findFirst.mockResolvedValue({ guardians: [{ studentId: "stu-1" }] });
    db.invoice.findUnique.mockResolvedValue({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-1",
      status: "SENT",
      lines: [],
      payments: [],
      student: { name: "X", nickname: null, enrollments: [] },
    });
    const res = await GET({} as never, ctx);
    expect(res.status).toBe(404);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });
});
