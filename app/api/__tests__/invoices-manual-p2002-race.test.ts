import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * T0 — Repro test for the production 500 observed at 2026-04-26T08:55:47Z.
 *
 * POST /api/invoices returned `500 Error [PrismaClientKnownReq...]` during
 * an admin trial. The root cause is a race on `@@unique([tenantId, invoiceNumber])`:
 * the advisory lock acquired in `nextInvoiceNumber` lives inside an interactive
 * transaction whose Prisma client may issue the lock query and the downstream
 * `invoice.create` on different pool connections, defeating the lock's
 * serialization guarantee. Concurrent invocations can read the same last
 * `invoiceNumber` and both produce e.g. `INV-2026-0042`, causing P2002.
 *
 * This test simulates the race by making `tx.invoice.create` throw a
 * P2002 PrismaClientKnownRequestError on the FIRST attempt, then succeed on
 * a hypothetical retry. The current production code has no retry-on-P2002
 * loop, so the first throw bubbles out of the route as an unhandled error
 * → 500 with raw Prisma error body.
 *
 * After T1 (atomic ON CONFLICT allocator) the race becomes physically
 * impossible. After T2b (3-attempt retry-once loop with exponential jitter)
 * any residual P2002 from manual seed corruption is also handled and the
 * route returns 201. This test proves the current behavior is broken and
 * will flip green once T1+T2b land.
 */

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

const adminSession = {
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

const validBody = {
  studentId: "s-1",
  periodLabel: "April 2026",
  dueDate: "2026-04-30",
  lines: [
    { feeComponentId: "fc-1", amount: 100_000 },
    { feeComponentId: "fc-2", amount: 50_000 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  txMock.$queryRaw.mockReset();
  txMock.invoice.create.mockReset();
});

// T0 fixture — UN-SKIPPED in T2b. After the retry-once loop landed in
// app/api/invoices/route.ts both assertions go green:
//   1. P2002 → success after retry → 201
//   2. 3× P2002 → exhaust → 409 with Indonesian copy
describe("POST /api/invoices — P2002 race regression (T0)", () => {
  it("FAILS PRE-T2b: should return 201 once retry-once lands (P2002 bubbles unhandled today)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import(
      "@/lib/payments/session"
    );

    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
      { id: "fc-2", label: "Uang Makan" },
    ] as never);
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue({
      parentId: "p-1",
    } as never);
    vi.mocked(prisma.invoice.findUnique).mockResolvedValue({
      id: "inv-new",
      invoiceNumber: "INV-2026-0001",
      totalDue: 150_000,
      status: "SENT",
      xenditPaymentUrl: "https://x/y",
      xenditSessionId: "ps-1",
      paymentLinkError: null,
      lines: [],
    } as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      sessionId: "ps-1",
      paymentUrl: "https://x/y",
    } as never);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);

    // First $transaction attempt: nextInvoiceNumber lock + lookup, then
    // invoice.create throws P2002 (the production race).
    // Second $transaction attempt (after retry-once): same pattern, succeeds.
    txMock.$queryRaw
      // attempt 1 — lock + lookup
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      // attempt 2 — lock + lookup
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`tenantId`,`invoiceNumber`)",
      { code: "P2002", clientVersion: "test", meta: { target: ["tenantId", "invoiceNumber"] } }
    );

    txMock.invoice.create
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({ id: "inv-new" });

    const res = await POST(makeReq(validBody) as never);

    // Pre-T1+T2b: this assertion FAILS — route returns 500 with raw error.
    // Post-T1+T2b: this assertion PASSES — retry-once swallows P2002 + 201.
    expect(res.status).toBe(201);
  });

  it("FAILS PRE-T2b: should return 409 with Indonesian error after 3 retries exhausted", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s-1",
    } as never);
    vi.mocked(prisma.feeComponentDef.findMany).mockResolvedValue([
      { id: "fc-1", label: "SPP" },
      { id: "fc-2", label: "Uang Makan" },
    ] as never);
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue(null);

    // 3 attempts × 2 $queryRaw calls each
    for (let i = 0; i < 6; i++) {
      txMock.$queryRaw.mockResolvedValueOnce([]);
    }

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`tenantId`,`invoiceNumber`)",
      { code: "P2002", clientVersion: "test", meta: { target: ["tenantId", "invoiceNumber"] } }
    );

    txMock.invoice.create
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002);

    const res = await POST(makeReq(validBody) as never);

    // Post-T2b: 409 with Indonesian copy. Pre-T2b: 500 raw.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Konflik nomor tagihan, silakan coba lagi");
  });
});
