import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";

// In-memory tx mock — the route's transaction body issues two operations:
//   1. nextInvoiceNumber → tx.$queryRaw twice (advisory lock + last-number lookup)
//   2. tx.invoice.create({ ..., lines: { create: [...] } }) → returns the new id
//
// The fee-component lookup, student check, and guardian lookup happen on the
// outer prisma client (see vi.mock below).
const txMock = {
  $queryRaw: vi.fn(),
  invoice: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findFirst: vi.fn() },
    feeComponentDef: { findMany: vi.fn() },
    studentGuardian: { findFirst: vi.fn() },
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

// The route audits the created invoice inside the transaction; the tx mock has no auditLog table.
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});


// Mock the Xendit helper at the boundary the route imports it from. Its own
// DB writes are out of scope here — we control success/failure/null directly.
vi.mock("@/lib/payments/session", () => ({
  createPaymentSessionForInvoice: vi.fn(),
}));

import { POST } from "../invoices/route";

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminSession() {
  return {
    id: "u-1",
    email: "admin@test.com",
    name: "Admin",
    role: "SUPER_ADMIN" as const,
    tenantId: "tnt-1",
    employeeId: null,
    parentId: null,
    permissions: [] as string[],
    customRoleCode: null,
  };
}

const validBody = {
  studentId: "s-1",
  periodLabel: "April 2026",
  dueDate: "2026-04-30",
  lines: [
    { feeComponentId: "fc-1", amount: 100_000 },
    { feeComponentId: "fc-2", amount: 50_000 },
  ],
};

/**
 * Wire the prisma + tx mocks for a happy-path manual create.
 * Returns the freshly-created invoice id used downstream by Xendit + re-fetch.
 */
function wireHappyPath({
  invoiceId = "inv-new",
  invoiceNumber = "INV-2026-0001",
  totalDue = 150_000,
  finalStatus = "SENT",
  paymentLinkError = null as string | null,
  xenditPaymentUrl = "https://checkout.xendit.co/web/inv-new" as string | null,
  xenditSessionId = "xnd-sess-1" as string | null,
}: {
  invoiceId?: string;
  invoiceNumber?: string;
  totalDue?: number;
  finalStatus?: string;
  paymentLinkError?: string | null;
  xenditPaymentUrl?: string | null;
  xenditSessionId?: string | null;
} = {}) {
  // Post-T1: reserveInvoiceNumbers is a single atomic INSERT … ON CONFLICT
  // … RETURNING. One $queryRaw call, returns the bumped lastNumber.
  txMock.$queryRaw.mockResolvedValueOnce([{ lastNumber: 1 }]);

  txMock.invoice.create.mockResolvedValueOnce({ id: invoiceId });

  return { invoiceId, invoiceNumber, totalDue, finalStatus, paymentLinkError, xenditPaymentUrl, xenditSessionId };
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.$queryRaw.mockReset();
  txMock.invoice.create.mockReset();
});

describe("POST /api/invoices — auth", () => {
  it("returns 403 when there is no session", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(403);
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it("returns 403 for TEACHER role", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue({
      ...adminSession(),
      role: "TEACHER" as const,
    });

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(403);
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it("returns 403 for an admin without invoices.create", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue({
      ...adminSession(),
      role: "SCHOOL_ADMIN",
      permissions: ["invoices.view"],
    });

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden", missing: "invoices.create" });
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

});

describe("POST /api/invoices — validation", () => {
  it("returns 400 when studentId missing", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    const res = await POST(
      makeReq({
        periodLabel: "April 2026",
        dueDate: "2026-04-30",
        lines: [{ feeComponentId: "fc-1", amount: 100_000 }],
      }) as never
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validasi gagal");
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "studentId" })]));
  });

  it("returns 400 when lines is empty", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    const res = await POST(
      makeReq({ ...validBody, lines: [] }) as never
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when a line amount is negative", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    const res = await POST(
      makeReq({
        ...validBody,
        lines: [{ feeComponentId: "fc-1", amount: -100 }],
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when dueDate format is wrong", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    const res = await POST(
      makeReq({ ...validBody, dueDate: "30/04/2026" }) as never
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/invoices — retired payment mode", () => {
  it("refuses a body carrying `payment` with 400 and writes nothing", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    const res = await POST(
      makeReq({
        ...validBody,
        payment: {
          idempotencyKey: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
          method: "CASH",
          paidAt: "2026-04-01",
        },
      }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validasi gagal");
    expect(body.errors).toEqual([expect.objectContaining({ field: "payment" })]);
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txMock.invoice.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoices — business validation", () => {
  it("returns 400 when the student is missing, not ACTIVE, or in another tenant", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/tidak ditemukan atau tidak aktif/i);
    // Tenant + ACTIVE scoping lives in the where-clause.
    expect(prisma.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s-1", tenantId: "tnt-1", status: "ACTIVE" },
      })
    );
    // Must short-circuit before fee-component lookup or transaction.
    expect(prisma.feeComponentDef.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 'tidak valid' when a fee component is cross-tenant or disabled", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);

    // Body asks for fc-1 + fc-2; we return only fc-1 → simulates fc-2 being
    // owned by another tenant or disabled.
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
    ] as never);

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/tidak valid/i);
    // Transaction must not run.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoices — happy path", () => {
  it("Xendit succeeds → 201, status=SENT, xenditPaymentUrl set, totalDue computed server-side", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
      { id: "fc-2", label: "Seragam" },
    ] as never);
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue({
      parentId: "p-1",
    } as never);

    wireHappyPath();

    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.xendit.co/web/inv-new", created: true,
    });

    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    // The post-Xendit re-fetch returns the final shape.
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-new",
      invoiceNumber: "INV-2026-0001",
      totalDue: 150_000,
      status: "SENT",
      xenditPaymentUrl: "https://checkout.xendit.co/web/inv-new",
      xenditSessionId: "xnd-sess-1",
      paymentLinkError: null,
      lines: [
        { feeComponentId: "fc-1", labelSnapshot: "SPP", amount: 100_000, finalAmount: 100_000 },
        { feeComponentId: "fc-2", labelSnapshot: "Seragam", amount: 50_000, finalAmount: 50_000 },
      ],
    } as never);

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.id).toBe("inv-new");
    expect(body.status).toBe("SENT");
    expect(body.xenditPaymentUrl).toBe("https://checkout.xendit.co/web/inv-new");
    expect(body.xenditError).toBeUndefined();
    expect(body.paid).toBeUndefined();
    expect(body.lines).toHaveLength(2);

    // The status flip update — paymentLinkError cleared, sentAt set.
    const updateCall = vi.mocked(prisma.invoice.update).mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: "inv-new" });
    expect(updateCall?.data).toMatchObject({ status: "SENT", paymentLinkError: null });
    expect(updateCall?.data?.sentAt).toBeInstanceOf(Date);

    // Server-side totalDue: assert the Decimal passed to invoice.create equals 150_000.
    // (Client-supplied total is ignored — there isn't one in validBody.)
    const createCall = txMock.invoice.create.mock.calls[0]?.[0];
    expect(Number(createCall?.data?.totalDue)).toBe(150_000);
    expect(createCall?.data?.status).toBe("PENDING_PAYMENT_LINK");
    expect(createCall?.data?.parentId).toBe("p-1");
  });
});

describe("POST /api/invoices — guardian lookup", () => {
  it("excludes an INACTIVE primary guardian from the billing-parent lookup", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
      { id: "fc-2", label: "Seragam" },
    ] as never);
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue({
      parentId: "p-1",
    } as never);

    wireHappyPath();

    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.xendit.co/web/inv-new", created: true,
    });
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-new",
      invoiceNumber: "INV-2026-0001",
      totalDue: 150_000,
      status: "SENT",
      xenditPaymentUrl: "https://checkout.xendit.co/web/inv-new",
      xenditSessionId: "xnd-sess-1",
      paymentLinkError: null,
      lines: [],
    } as never);

    await POST(makeReq(validBody) as never);

    expect(prisma.studentGuardian.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPrimary: true, status: "ACTIVE" }),
      }),
    );
  });
});

describe("POST /api/invoices — Xendit failure paths", () => {
  it("helper throws → 201, status=PENDING_PAYMENT_LINK, paymentLinkError set, xenditError surfaced", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
      { id: "fc-2", label: "Seragam" },
    ] as never);
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue({
      parentId: "p-1",
    } as never);

    wireHappyPath();

    vi.mocked(createPaymentSessionForInvoice).mockRejectedValue(new Error("Xendit 503"));
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-new",
      invoiceNumber: "INV-2026-0001",
      totalDue: 150_000,
      status: "PENDING_PAYMENT_LINK",
      xenditPaymentUrl: null,
      xenditSessionId: null,
      // Fixture mirrors the new prefix-tagged write format.
      paymentLinkError: "unknown: Xendit 503",
      lines: [],
    } as never);

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.status).toBe("PENDING_PAYMENT_LINK");
    expect(body.paymentLinkError).toBe("unknown: Xendit 503");
    // Prefix-tagged via formatPaymentLinkError — generic Error → "unknown:".
    expect(body.xenditError).toBe("unknown: Xendit 503");

    // The failure update writes paymentLinkError; status was already
    // PENDING_PAYMENT_LINK from invoice.create, so no status flip needed.
    const updateCall = vi.mocked(prisma.invoice.update).mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: "inv-new" });
    expect(updateCall?.data).toEqual({ paymentLinkError: "unknown: Xendit 503" });
  });

  it("helper returns null → 201, status=PENDING_PAYMENT_LINK, xenditError = 'Gagal membuat sesi pembayaran'", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(getSession).mockResolvedValue(adminSession());

    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
      { id: "fc-2", label: "Seragam" },
    ] as never);
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue({
      parentId: "p-1",
    } as never);

    wireHappyPath();

    // Helper-returns-null branch: TOCTOU guard tripped (PAID/CANCELLED mid-flight,
    // or remaining went to 0). Should be surfaced as a diagnostic.
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue(null);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-new",
      invoiceNumber: "INV-2026-0001",
      totalDue: 150_000,
      status: "PENDING_PAYMENT_LINK",
      xenditPaymentUrl: null,
      xenditSessionId: null,
      // Fixture mirrors the new prefix-tagged write format.
      paymentLinkError: "unknown: Gagal membuat sesi pembayaran",
      lines: [],
    } as never);

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.status).toBe("PENDING_PAYMENT_LINK");
    // The TOCTOU/null-result branch is wrapped in an Error and prefix-tagged
    // so the breakdown endpoint can aggregate it.
    expect(body.xenditError).toBe("unknown: Gagal membuat sesi pembayaran");

    const updateCall = vi.mocked(prisma.invoice.update).mock.calls[0]?.[0];
    expect(updateCall?.data).toEqual({
      paymentLinkError: "unknown: Gagal membuat sesi pembayaran",
    });
  });
});

describe("POST /api/invoices — P2002 retry loop (T2b)", () => {
  it("retries once on P2002 and returns 201 (single-conflict + retry-success)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import(
      "@/lib/payments/session"
    );

    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
      { id: "fc-2", label: "Seragam" },
    ] as never);
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue({
      parentId: "p-1",
    } as never);

    // Each attempt issues 1 $queryRaw call (atomic INSERT … ON CONFLICT …
    // RETURNING). Two attempts → 2 queue entries.
    txMock.$queryRaw.mockResolvedValueOnce([{ lastNumber: 1 }]);
    txMock.$queryRaw.mockResolvedValueOnce([{ lastNumber: 2 }]);

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`tenantId`,`invoiceNumber`)",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["tenantId", "invoiceNumber"] },
      },
    );

    txMock.invoice.create
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({ id: "inv-new" });

    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.xendit.co/web/inv-new", created: true,
    });
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-new",
      invoiceNumber: "INV-2026-0002",
      totalDue: 150_000,
      status: "SENT",
      xenditPaymentUrl: "https://checkout.xendit.co/web/inv-new",
      xenditSessionId: "xnd-sess-1",
      paymentLinkError: null,
      lines: [],
    } as never);

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(201);
    expect(txMock.invoice.create).toHaveBeenCalledTimes(2);
  });

  it("returns 409 with Indonesian copy after 3 P2002s in a row", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getSession).mockResolvedValue(adminSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
      { id: "fc-2", label: "Seragam" },
    ] as never);
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue(null);

    // 3 attempts × 1 $queryRaw call each.
    txMock.$queryRaw.mockResolvedValueOnce([{ lastNumber: 1 }]);
    txMock.$queryRaw.mockResolvedValueOnce([{ lastNumber: 2 }]);
    txMock.$queryRaw.mockResolvedValueOnce([{ lastNumber: 3 }]);

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`tenantId`,`invoiceNumber`)",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["tenantId", "invoiceNumber"] },
      },
    );

    txMock.invoice.create
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002);

    const res = await POST(makeReq(validBody) as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Konflik nomor tagihan, silakan coba lagi");
    expect(txMock.invoice.create).toHaveBeenCalledTimes(3);
  });
});
