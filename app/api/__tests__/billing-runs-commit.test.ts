import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory tx mock factory — mirrors the style in
// app/api/__tests__/invoices-generate-batch.test.ts and billing-runs.test.ts.
const txMock = {
  $queryRaw: vi.fn(),
  invoice: {
    createMany: vi.fn(),
    findMany: vi.fn(),
  },
  invoiceLine: {
    createMany: vi.fn(),
  },
  billingRunRow: {
    update: vi.fn(),
    // The commit route claims each row inside the transaction with a
    // conditional updateMany before creating any invoice. count: 1 = claim won.
    updateMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    billingRun: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    billingRunRow: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

// Mock at the boundary the route imports it from — same pattern as the batch
// route's test. The helper's internal gateway + DB write is out of scope
// here; we control its outcomes directly to exercise success/failure.
vi.mock("@/lib/payments/session", () => ({
  createPaymentSessionForInvoice: vi.fn(),
}));

import { POST as commitRun } from "../billing-runs/[id]/commit/route";

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/billing-runs/run-1/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function adminSession(overrides: Partial<Record<string, unknown>> = {}) {
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
    ...overrides,
  };
}

function draftRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    tenantId: "tnt-1",
    periodLabel: "April 2026",
    dueDate: "2026-04-30",
    academicYearId: "ay-1",
    status: "DRAFT",
    scope: {},
    createdAt: new Date(),
    committedAt: null,
    createdBy: "u-1",
    ...overrides,
  };
}

function pendingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "row-1",
    billingRunId: "run-1",
    studentId: "s-1",
    studentNameSnapshot: "Budi",
    classLabelSnapshot: "TKIT A",
    parentId: "parent-1",
    totalDue: 500_000,
    status: "PENDING",
    invoiceId: null,
    error: null,
    lines: [
      {
        id: "line-1",
        billingRunRowId: "row-1",
        feeComponentId: "fc-1",
        labelSnapshot: "SPP",
        amount: 500_000,
        adjustmentAmount: -50_000,
        adjustmentNote: "Diskon saudara",
        finalAmount: 450_000,
        source: "ADJUSTMENT",
      },
    ],
    ...overrides,
  };
}

/**
 * Wire the tx mock for a happy-path createMany → findMany pattern for the
 * given rows. Returns sequential invoice numbers/ids keyed by row id, same
 * shape as the batch route's wireHappyTx.
 */
function wireHappyTx(rows: ReturnType<typeof pendingRow>[], { startingNumber = 1 }: { startingNumber?: number } = {}) {
  txMock.$queryRaw.mockResolvedValueOnce([{ lastNumber: startingNumber - 1 + rows.length }]);
  txMock.invoice.createMany.mockResolvedValueOnce({ count: rows.length });

  const created = rows.map((r, i) => ({
    id: `inv-${r.id}`,
    invoiceNumber: `INV-2026-${String(startingNumber + i).padStart(4, "0")}`,
  }));
  txMock.invoice.findMany.mockResolvedValueOnce(created);
  txMock.invoiceLine.createMany.mockResolvedValueOnce({ count: rows.length });
  txMock.billingRunRow.update.mockResolvedValue({});
  // Every row wins its claim unless a test overrides this.
  txMock.billingRunRow.updateMany.mockResolvedValue({ count: 1 });

  return created;
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.$queryRaw.mockReset();
  txMock.invoice.createMany.mockReset();
  txMock.invoice.findMany.mockReset();
  txMock.invoiceLine.createMany.mockReset();
  txMock.billingRunRow.update.mockReset();
  txMock.billingRunRow.updateMany.mockReset();
  txMock.billingRunRow.updateMany.mockResolvedValue({ count: 1 });
});

async function primeAdminSession(role: string = "SUPER_ADMIN") {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(adminSession({ role }) as never);
}

describe("POST /api/billing-runs/[id]/commit — auth guard", () => {
  it("returns 403 with no session, and no invoice is created", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(403);
    expect(prisma.billingRun.findFirst).not.toHaveBeenCalled();
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
  });

  it("returns 403 for TEACHER role, and no invoice is created", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "TEACHER" }) as never);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(403);
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
  });

  it("returns 403 for GUARDIAN role, and no invoice is created", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "GUARDIAN" }) as never);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(403);
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs/[id]/commit — tenant scoping", () => {
  it("returns 404 for a run in another tenant, and no invoice is created", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(null);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-foreign"));
    expect(res.status).toBe(404);
    const findCall = vi.mocked(prisma.billingRun.findFirst).mock.calls[0][0]!;
    expect(findCall.where).toMatchObject({ id: "run-foreign", tenantId: "tnt-1" });
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs/[id]/commit — status guard", () => {
  it("returns 409 when the run is COMMITTED, and no invoice is created", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun({ status: "COMMITTED" }) as never);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(409);
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
  });

  it("returns 409 when the run is CANCELLED, and no invoice is created", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun({ status: "CANCELLED" }) as never);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(409);
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
  });

  it("allows commit when the run is already COMMITTING (resumed chunk)", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun({ status: "COMMITTING" }) as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([pendingRow()] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never); // no duplicates
    wireHappyTx([pendingRow()]);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.example.com/inv-row-1",
    });
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    // Already COMMITTING — must not be "flipped" again via a redundant update to COMMITTING.
    const updateCalls = vi.mocked(prisma.billingRun.update).mock.calls;
    expect(updateCalls.some((c) => c[0].data.status === "COMMITTING")).toBe(false);
  });
});

describe("POST /api/billing-runs/[id]/commit — idempotency", () => {
  it("a row with invoiceId already set is never committed twice", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    // Row's status claims PENDING (stale/corrupted) but invoiceId is already set.
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([
      pendingRow({ status: "PENDING", invoiceId: "inv-already" }),
    ] as never);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
    expect(prisma.invoice.findMany).not.toHaveBeenCalled(); // duplicate re-check never runs — row wasn't committable
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it("a COMMITTED row is never committed twice", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([
      pendingRow({ status: "COMMITTED", invoiceId: "inv-already" }),
    ] as never);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it("EXCLUDED rows are skipped and never committed", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([
      pendingRow({ status: "EXCLUDED" }),
    ] as never);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
  });
});

describe("POST /api/billing-runs/[id]/commit — live duplicate re-check", () => {
  it("a row whose student was invoiced for this period between draft and commit is skipped as SKIPPED_ALREADY_INVOICED, writing nothing", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([pendingRow()] as never);
    // A live Invoice now exists for s-1 in "April 2026" — created after the draft.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([{ studentId: "s-1", periodLabel: "April 2026" }] as never);
    vi.mocked(prisma.billingRunRow.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // The duplicate re-check ran against LIVE data (ignoring the draft).
    const dupCall = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]!;
    expect(dupCall.where).toMatchObject({
      tenantId: "tnt-1",
      studentId: { in: ["s-1"] },
      OR: [{ periodLabel: "April 2026" }, { createdAt: { gte: expect.any(Date) } }],
    });

    // No invoice was written for the duplicate.
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
    expect(txMock.invoiceLine.createMany).not.toHaveBeenCalled();

    // The row was flipped to SKIPPED_ALREADY_INVOICED.
    const updateManyCall = vi.mocked(prisma.billingRunRow.updateMany).mock.calls[0][0]!;
    expect(updateManyCall.where).toMatchObject({ id: { in: ["row-1"] } });
    expect(updateManyCall.data).toMatchObject({ status: "SKIPPED_ALREADY_INVOICED" });

    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.results[0]).toMatchObject({
      rowId: "row-1",
      studentId: "s-1",
      status: "SKIPPED_ALREADY_INVOICED",
    });
  });

  it("the duplicate re-check runs strictly before the invoice-creation transaction", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([pendingRow()] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([{ studentId: "s-1", periodLabel: "April 2026" }] as never);
    vi.mocked(prisma.billingRunRow.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));

    // $transaction (invoice creation) was never entered because every
    // survivor was filtered out by the duplicate check first.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs/[id]/commit — period alias duplicate (FINX-6)", () => {
  it.each(["april 2026", "Apr 2026", "  APRIL   2026 "])(
    "an existing invoice labelled %j counts as the same period as \"April 2026\"",
    async (existingLabel) => {
      await primeAdminSession();
      const { prisma } = await import("@/lib/db");
      vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
      vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([pendingRow()] as never);
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        { studentId: "s-1", periodLabel: existingLabel },
      ] as never);
      vi.mocked(prisma.billingRunRow.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

      const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
      const body = await res.json();

      expect(txMock.invoice.createMany).not.toHaveBeenCalled();
      expect(body.created).toBe(0);
      expect(body.results[0]).toMatchObject({ rowId: "row-1", status: "SKIPPED_ALREADY_INVOICED" });
    },
  );

  it("an invoice for a different month or year is NOT a duplicate", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([pendingRow()] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { studentId: "s-1", periodLabel: "Maret 2026" },
      { studentId: "s-1", periodLabel: "April 2025" },
    ] as never);
    wireHappyTx([pendingRow()]);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({ paymentUrl: "https://pay/1" } as never);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    const body = await res.json();
    expect(body.created).toBe(1);
  });
});

describe("POST /api/billing-runs/[id]/commit — Rp 0 rows (FINX-4)", () => {
  it("never turns a Rp 0 row into an invoice; parks it as EXCLUDED with a reason and counts it as skipped", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([
      pendingRow({ id: "row-zero", studentId: "s-zero", studentNameSnapshot: "Nol", totalDue: 0 }),
    ] as never);
    vi.mocked(prisma.billingRunRow.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-zero"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
    // Nothing billable, so the live duplicate query is not even issued.
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();

    const call = vi.mocked(prisma.billingRunRow.updateMany).mock.calls[0][0]!;
    expect(call.where).toMatchObject({ id: { in: ["row-zero"] }, status: "PENDING", invoiceId: null });
    expect(call.data).toEqual({ status: "EXCLUDED", error: "Rp 0 — tidak ditagih" });

    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.results[0]).toMatchObject({ rowId: "row-zero", status: "SKIPPED_ZERO_TOTAL" });
  });

  it("still invoices the billable rows of the same chunk and the run completes", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    const zero = pendingRow({ id: "row-zero", studentId: "s-zero", totalDue: 0 });
    const paid = pendingRow({ id: "row-1", studentId: "s-1" });
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([zero, paid] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.billingRunRow.updateMany).mockResolvedValue({ count: 1 } as never);
    wireHappyTx([paid]);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({ paymentUrl: "https://pay/1" } as never);

    const res = await commitRun(makeReq({ rowIds: ["row-zero", "row-1"] }) as never, makeParams("run-1"));
    const body = await res.json();

    expect(body.created).toBe(1);
    expect(body.skipped).toBe(1);
    const invoiceData = txMock.invoice.createMany.mock.calls[0][0].data;
    expect(invoiceData).toHaveLength(1);
    expect(invoiceData[0].studentId).toBe("s-1");
    expect(prisma.billingRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMMITTED" }) }),
    );
  });
});

describe("POST /api/billing-runs/[id]/commit — concurrent claim", () => {
  it("creates no invoice when the row was claimed by a concurrent commit", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([pendingRow()] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as never); // no duplicates
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    // The row looked PENDING when we read it outside the transaction, but a
    // concurrent commit claimed it first — so the conditional updateMany
    // inside the transaction matches nothing. This is the retry path:
    // run-bulk-generate resends an identical chunk after a 5xx or timeout.
    txMock.billingRunRow.updateMany.mockResolvedValue({ count: 0 });

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(0);
    // The only thing that must never happen: a second invoice for this row.
    expect(txMock.invoice.createMany).not.toHaveBeenCalled();
    expect(txMock.invoiceLine.createMany).not.toHaveBeenCalled();
  });

  it("claims each row conditioned on it still being PENDING with no invoiceId", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    const row = pendingRow();
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as never);
    wireHappyTx([row]);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.example.com/inv-row-1",
    });
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));

    // The guard lives in the WHERE clause, not in a prior read.
    const claim = txMock.billingRunRow.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: "row-1", status: "PENDING", invoiceId: null });
    expect(claim.data.status).toBe("COMMITTED");
    expect(claim.data.invoiceId).toEqual(expect.any(String));
  });
});

describe("POST /api/billing-runs/[id]/commit — verbatim amounts", () => {
  it("writes amounts exactly as drafted, and totalDue is the row's stored value, not a recomputation", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);

    // totalDue deliberately does NOT equal the sum of the lines. This models a
    // stale draft, and it is the only fixture shape that can tell the two
    // implementations apart: a route that re-summed the lines would write
    // 450_000 here, a route that trusts the draft writes 999_000. With
    // totalDue == sum(lines) the assertion passes either way and proves
    // nothing.
    const row = pendingRow({
      totalDue: 999_000,
      lines: [
        {
          id: "line-1",
          billingRunRowId: "row-1",
          feeComponentId: "fc-1",
          labelSnapshot: "SPP",
          amount: 500_000,
          adjustmentAmount: -50_000,
          adjustmentNote: "Diskon saudara",
          finalAmount: 450_000,
          source: "ADJUSTMENT",
        },
      ],
    });
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as never); // no duplicates

    wireHappyTx([row]);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.example.com/inv-row-1",
    });
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);

    // The row's stored 999_000, not the lines' 450_000. A recomputing
    // implementation fails this assertion.
    const invoiceCreateArgs = txMock.invoice.createMany.mock.calls[0][0];
    expect(invoiceCreateArgs.data[0].totalDue).toBe(999_000);

    const lineArgs = txMock.invoiceLine.createMany.mock.calls[0][0];
    expect(lineArgs.data).toHaveLength(1);
    const line = lineArgs.data[0];
    expect(line.feeComponentId).toBe("fc-1");
    expect(line.labelSnapshot).toBe("SPP");
    expect(line.amount).toBe(500_000);
    expect(line.adjustmentAmount).toBe(-50_000);
    expect(line.adjustmentNote).toBe("Diskon saudara");
    expect(line.finalAmount).toBe(450_000);
  });
});

describe("POST /api/billing-runs/[id]/commit — payment-link fan-out", () => {
  it("a payment-link failure leaves PENDING_PAYMENT_LINK + paymentLinkError and does NOT fail the row", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);

    const row = pendingRow();
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as never);

    wireHappyTx([row]);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(createPaymentSessionForInvoice).mockRejectedValue(new Error("Gateway 503"));
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.created).toBe(1);
    expect(body.results[0]).toMatchObject({
      status: "PENDING_PAYMENT_LINK",
      error: "unknown: Gateway 503",
    });

    // The row's invoice was still created and the row still claimed
    // (COMMITTED + invoiceId) — a fan-out failure never rolls back the
    // committed invoice. The claim is the conditional updateMany inside the
    // transaction, which is also what marks the row.
    expect(txMock.billingRunRow.updateMany).toHaveBeenCalledWith({
      where: { id: "row-1", status: "PENDING", invoiceId: null },
      data: { invoiceId: expect.any(String), status: "COMMITTED" },
    });

    // The invoice update wrote only paymentLinkError, no status flip to SENT.
    const updateCall = vi.mocked(prisma.invoice.update).mock.calls[0][0];
    expect(updateCall.data).toEqual({ paymentLinkError: "unknown: Gateway 503" });
  });

  it("a payment-link success flips the invoice to SENT with the payment URL surfaced", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);

    const row = pendingRow();
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as never);

    wireHappyTx([row]);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({
      paymentUrl: "https://checkout.example.com/inv-row-1",
    });
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.results[0]).toMatchObject({
      status: "SENT",
      paymentUrl: "https://checkout.example.com/inv-row-1",
    });
    const updateCall = vi.mocked(prisma.invoice.update).mock.calls[0][0];
    expect(updateCall.data).toMatchObject({ status: "SENT", paymentLinkError: null });
  });
});

describe("POST /api/billing-runs/[id]/commit — run status transitions", () => {
  it("flips DRAFT to COMMITTING when the first chunk starts committing rows", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun({ status: "DRAFT" }) as never);

    const row = pendingRow();
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as never);
    wireHappyTx([row]);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({ paymentUrl: "https://x" });
    // A second row still PENDING remains after this chunk — run must not
    // flip all the way to COMMITTED yet.
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(1);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);

    const updateCalls = vi.mocked(prisma.billingRun.update).mock.calls;
    expect(updateCalls.some((c) => c[0].data.status === "COMMITTING")).toBe(true);
    expect(updateCalls.some((c) => c[0].data.status === "COMMITTED")).toBe(false);
  });

  it("flips the run to COMMITTED only when no PENDING rows remain", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun({ status: "COMMITTING" }) as never);

    const row = pendingRow();
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as never);
    wireHappyTx([row]);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({ paymentUrl: "https://x" });
    // No PENDING rows remain after this chunk.
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);

    const updateCalls = vi.mocked(prisma.billingRun.update).mock.calls;
    const committedCall = updateCalls.find((c) => c[0].data.status === "COMMITTED");
    expect(committedCall).toBeTruthy();
    expect(committedCall![0].data.committedAt).toBeInstanceOf(Date);
  });

  it("does NOT flip the run to COMMITTED when PENDING rows remain", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { createPaymentSessionForInvoice } = await import("@/lib/payments/session");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun({ status: "COMMITTING" }) as never);

    const row = pendingRow();
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([row] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([] as never);
    wireHappyTx([row]);
    vi.mocked(prisma.invoice.update).mockResolvedValue({} as never);
    vi.mocked(createPaymentSessionForInvoice).mockResolvedValue({ paymentUrl: "https://x" });
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(3);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);

    const updateCalls = vi.mocked(prisma.billingRun.update).mock.calls;
    expect(updateCalls.some((c) => c[0].data.status === "COMMITTED")).toBe(false);
  });
});

describe("POST /api/billing-runs/[id]/commit — cache invalidation", () => {
  it("busts parent-invoice-list and student-invoices only when something was created", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    const { revalidateTag } = await import("next/cache");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun() as never);
    // Every row is already EXCLUDED — nothing committable, nothing created.
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([
      pendingRow({ status: "EXCLUDED" }),
    ] as never);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(0);

    const res = await commitRun(makeReq({ rowIds: ["row-1"] }) as never, makeParams("run-1"));
    expect(res.status).toBe(200);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
