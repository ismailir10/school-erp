/**
 * Coverage for `GET /api/invoices/[id]` — admin invoice detail.
 * Verifies tenant scoping (cross-tenant returns 404) and the role gate.
 *
 * Note: this route returns `NextResponse.json(null, { status: 403 })` for
 * unauth/wrong-role rather than the `{ error: "Forbidden" }` shape used
 * elsewhere — the assertions below match the actual route behaviour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const userFindMany = vi.fn();
const webhookFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: { findUnique },
    user: { findMany: userFindMany },
    webhookEvent: { findMany: webhookFindMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

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

function makeReq() {
  return new Request("http://localhost/api/invoices/inv-1");
}

beforeEach(() => {
  vi.clearAllMocks();
  webhookFindMany.mockResolvedValue([]);
});

describe("GET /api/invoices/[id]", () => {
  it("returns the invoice when it belongs to the session's tenant", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "tnt-1",
      status: "DRAFT",
      totalDue: 100_000,
      lines: [],
      payments: [],
      student: { guardians: [] },
    });

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ id: "inv-1", tenantId: "tnt-1" });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inv-1" },
        include: expect.any(Object),
      }),
    );
  });

  it("FIN-7: resolves payment.createdBy to a tenant-scoped actor name; gateway rows stay null", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "tnt-1",
      status: "PAID",
      lines: [],
      payments: [
        { id: "p1", createdBy: "u-9", status: "RECORDED" },
        { id: "p2", createdBy: null, status: "RECORDED" },
        { id: "p3", createdBy: "u-gone", status: "REVERSED" },
      ],
      student: { guardians: [] },
    });
    userFindMany.mockResolvedValueOnce([{ id: "u-9", name: "Bu Nur", email: "nur@x.id" }]);

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });
    const json = await res.json();

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["u-9", "u-gone"] }, tenantId: "tnt-1" } }),
    );
    expect(json.payments.map((p: { createdByName: string | null }) => p.createdByName)).toEqual([
      "Bu Nur",
      null,
      null,
    ]);
    // reversed rows are still returned (admin history shows them struck through)
    expect(json.payments[2].status).toBe("REVERSED");
  });

  it("returns the reminder stamp and resolves its actor name, tenant-scoped", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "tnt-1",
      status: "SENT",
      lines: [],
      payments: [{ id: "p1", createdBy: "u-9", status: "RECORDED" }],
      lastRemindedAt: "2026-10-16T03:00:00.000Z",
      lastRemindedBy: "u-7",
      remindCount: 2,
      student: { guardians: [] },
    });
    userFindMany.mockResolvedValueOnce([
      { id: "u-9", name: "Bu Nur", email: "nur@x.id" },
      { id: "u-7", name: null, email: "kasir@x.id" },
    ]);

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });
    const json = await res.json();

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["u-9", "u-7"] }, tenantId: "tnt-1" } }),
    );
    expect(json).toMatchObject({
      lastRemindedAt: "2026-10-16T03:00:00.000Z",
      remindCount: 2,
      lastRemindedByName: "kasir@x.id",
    });
  });

  it("never-reminded invoice reports a null actor name without a user lookup", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "tnt-1",
      status: "SENT",
      lines: [],
      payments: [],
      lastRemindedAt: null,
      lastRemindedBy: null,
      remindCount: 0,
      student: { guardians: [] },
    });

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });
    const json = await res.json();

    expect(userFindMany).not.toHaveBeenCalled();
    expect(json).toMatchObject({ lastRemindedAt: null, remindCount: 0, lastRemindedByName: null });
  });

  it("only resolves an ACTIVE primary guardian as the billing contact", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "tnt-1",
      status: "DRAFT",
      totalDue: 100_000,
      lines: [],
      payments: [],
      student: { guardians: [] },
    });

    const { GET } = await import("../invoices/[id]/route");
    await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });

    const call = findUnique.mock.calls[0][0];
    expect(call.include.student.include.guardians.where).toEqual({
      isPrimary: true,
      status: "ACTIVE",
    });
  });

  it("returns paymentProblems built from the invoice's flagged events, newest first", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce({
      id: "inv-1", tenantId: "tnt-1", status: "PAID", lines: [], payments: [], student: { guardians: [] },
    });
    const createdAt = new Date("2026-10-21T03:00:00.000Z");
    webhookFindMany.mockResolvedValueOnce([
      {
        errorMessage: "DUPLICATE_PAYMENT_AFTER_PAID",
        payload: { data: { amount: 500000 } },
        provider: "xendit",
        createdAt,
      },
    ]);

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });
    const json = await res.json();

    expect(webhookFindMany).toHaveBeenCalledWith({
      where: {
        invoiceId: "inv-1",
        status: "ERROR",
        errorMessage: { in: ["DUPLICATE_PAYMENT_AFTER_PAID", "PAID_ON_CANCELLED_INVOICE", "OVERPAYMENT_FLAGGED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { errorMessage: true, payload: true, provider: true, createdAt: true },
    });
    expect(json.paymentProblems).toHaveLength(1);
    expect(json.paymentProblems[0]).toMatchObject({
      code: "DUPLICATE_PAYMENT_AFTER_PAID",
      createdAt: createdAt.toISOString(),
    });
    expect(json.paymentProblems[0].message).toContain("Rp 500.000");
    expect(json.paymentProblems[0].message).toContain("Xendit");
  });

  it("returns an empty paymentProblems list when nothing is flagged", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce({
      id: "inv-1", tenantId: "tnt-1", status: "SENT", lines: [], payments: [], student: { guardians: [] },
    });

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });
    expect((await res.json()).paymentProblems).toEqual([]);
  });

  it("another tenant's invoice 404s and never queries webhook events", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce({
      id: "inv-1", tenantId: "tnt-other", status: "PAID", lines: [], payments: [], student: { guardians: [] },
    });

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });

    expect(res.status).toBe(404);
    expect(webhookFindMany).not.toHaveBeenCalled();
  });

  it("404 when the row exists but for another tenant", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession()); // tnt-1
    findUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "tnt-other",
      status: "DRAFT",
      lines: [],
      payments: [],
      student: { guardians: [] },
    });

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(404);
  });

  it("404 when the row does not exist", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession());
    findUnique.mockResolvedValueOnce(null);

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(404);
  });

  it("403 when no session", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(null);

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("403 for TEACHER (non-admin role)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue({
      ...adminSession(),
      role: "TEACHER" as const,
    });

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("403 for GUARDIAN (non-admin role)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue({
      ...adminSession(),
      role: "GUARDIAN" as const,
    });

    const { GET } = await import("../invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
