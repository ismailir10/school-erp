/**
 * Coverage for `GET /api/guardian/invoices/[id]` — guardian-scoped invoice
 * detail. Most-load-bearing test in this set: the route protects against
 * cross-parent PII enumeration. A guardian who guesses an invoice id from a
 * sibling, classmate, or another tenant must NOT receive any invoice payload.
 *
 * Scope chain (must all match):
 *   1. session.role === "GUARDIAN"
 *   2. session.parentId (or fallback session.email) maps to a parent row in
 *      session.tenantId.
 *   3. invoice.studentId is in that parent's child-id set.
 *   4. invoice.tenantId === session.tenantId.
 *
 * Any miss → 404 (route deliberately returns "Not found" rather than 403 to
 * avoid leaking which-id-exists info to a probing client).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const parentFindFirst = vi.fn();
const invoiceFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    parent: { findFirst: parentFindFirst },
    invoice: { findUnique: invoiceFindUnique },
  },
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

function guardianSession(overrides: Partial<{
  parentId: string | null;
  tenantId: string | null;
  role: "GUARDIAN" | "TEACHER" | "SUPER_ADMIN";
  email: string;
}> = {}) {
  return {
    id: "u-1",
    email: overrides.email ?? "g@g.com",
    name: "G",
    role: overrides.role ?? "GUARDIAN",
    tenantId: overrides.tenantId === undefined ? "t-1" : overrides.tenantId,
    employeeId: null,
    parentId: overrides.parentId === undefined ? "par-1" : overrides.parentId,
    permissions: [] as string[],
    customRoleCode: null,
  };
}

function makeReq() {
  return new Request("http://localhost/api/guardian/invoices/inv-1");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/guardian/invoices/[id]", () => {
  it("returns the invoice when it belongs to one of the guardian's children", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession());
    parentFindFirst.mockResolvedValueOnce({
      guardians: [{ studentId: "stu-1" }, { studentId: "stu-2" }],
    });
    invoiceFindUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-1", // bound to the parent's child
      invoiceNumber: "INV-0001",
      periodLabel: "April 2026",
      dueDate: new Date("2026-04-30"),
      totalDue: 250_000,
      totalPaid: 0,
      status: "SENT",
      xenditPaymentUrl: "https://xendit.example/abc",
      sentAt: new Date("2026-04-01T00:00:00Z"),
      paidAt: null,
      lines: [],
      payments: [],
      student: { name: "Anak", nickname: "Nak", enrollments: [] },
    });

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("inv-1");
    expect(json.totalDue).toBe(250_000);
    // Response must NOT leak tenantId.
    expect(json.tenantId).toBeUndefined();
    // Parent lookup must be tenant-scoped via the parentId branch.
    expect(parentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "par-1", tenantId: "t-1" },
      }),
    );
  });

  it("only counts ACTIVE guardian links when resolving the guardian's children", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession());
    parentFindFirst.mockResolvedValueOnce({ guardians: [] });
    const { GET } = await import("../guardian/invoices/[id]/route");
    await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });
    expect(parentFindFirst.mock.calls[0][0].select.guardians.where).toEqual({ status: "ACTIVE" });
  });

  it("PAR-7: exposes the optional school contact phone from SCHOOL_CONTACT_PHONE", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession());
    const prev = process.env.SCHOOL_CONTACT_PHONE;
    process.env.SCHOOL_CONTACT_PHONE = "0812-8877-4402";
    try {
      parentFindFirst.mockResolvedValueOnce({ guardians: [{ studentId: "stu-1" }] });
      invoiceFindUnique.mockResolvedValueOnce({
        id: "inv-1", tenantId: "t-1", studentId: "stu-1", invoiceNumber: "INV-0001",
        periodLabel: "April 2026", dueDate: "2026-04-30", totalDue: 1, totalPaid: 0, status: "OVERDUE",
        xenditPaymentUrl: null, sentAt: null, paidAt: null, lines: [], payments: [],
        student: { name: "Anak", nickname: null, enrollments: [] },
      });
      const { GET } = await import("../guardian/invoices/[id]/route");
      const res = await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });
      expect((await res.json()).schoolContactPhone).toBe("0812-8877-4402");
    } finally {
      if (prev === undefined) delete process.env.SCHOOL_CONTACT_PHONE;
      else process.env.SCHOOL_CONTACT_PHONE = prev;
    }
  });

  it("asks Prisma for non-reversed payments only (a reversed payment is not money received)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession());
    parentFindFirst.mockResolvedValueOnce({ guardians: [{ studentId: "stu-1" }] });
    invoiceFindUnique.mockResolvedValueOnce(null);

    const { GET } = await import("../guardian/invoices/[id]/route");
    await GET(makeReq() as never, { params: Promise.resolve({ id: "inv-1" }) });

    const args = invoiceFindUnique.mock.calls[0][0];
    expect(args.select.payments.where).toEqual({ status: { not: "REVERSED" } });
  });

  it("names the SEMESTER (sekolah) class, never the daycare one, for a dual-enrolled student", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession());
    parentFindFirst.mockResolvedValueOnce({
      guardians: [{ studentId: "stu-1" }],
    });
    invoiceFindUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-1",
      invoiceNumber: "INV-0001",
      periodLabel: "April 2026",
      dueDate: new Date("2026-04-30"),
      totalDue: 250_000,
      totalPaid: 0,
      status: "SENT",
      xenditPaymentUrl: null,
      sentAt: null,
      paidAt: null,
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

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.student.classSection).toEqual({ name: "TKIT A", program: { name: "TKIT" } });
  });

  it("names the CURRENT-year class, not a stale ARCHIVED-year row (T9 regression) — the enrollments query excludes archived years", async () => {
    // Regression for the T9 bug: a student can carry a stale un-closed
    // ACTIVE row in an ARCHIVED prior year (bulk-import artifact) alongside
    // the real current-year ACTIVE row. Both SEMESTER, so unfiltered they'd
    // land in `pickPrimaryEnrollment`'s pool together and the earliest-
    // enrollDate tiebreak would pick the archived one. The fix scopes the
    // Prisma query itself, so we assert the `where` shape excludes archived
    // years — proving the stale row can never reach `pickPrimaryEnrollment`.
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession());
    parentFindFirst.mockResolvedValueOnce({
      guardians: [{ studentId: "stu-1" }],
    });
    invoiceFindUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-1",
      invoiceNumber: "INV-0001",
      periodLabel: "April 2026",
      dueDate: new Date("2026-04-30"),
      totalDue: 250_000,
      totalPaid: 0,
      status: "SENT",
      xenditPaymentUrl: null,
      sentAt: null,
      paidAt: null,
      lines: [],
      payments: [],
      student: {
        name: "Anak",
        nickname: "Nak",
        // Mock resolves as if Prisma already applied the archived-year
        // filter — only the current-year row comes back, even though a
        // stale ARCHIVED-year SEMESTER row exists in the real DB.
        enrollments: [
          {
            id: "enr-current",
            enrollDate: "2025-07-10",
            classSection: { name: "TKIT A (2025/2026)", program: { name: "TKIT", type: "SEMESTER" } },
          },
        ],
      },
    });

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.student.classSection).toEqual({
      name: "TKIT A (2025/2026)",
      program: { name: "TKIT" },
    });

    // The query itself must exclude ARCHIVED-year enrollments.
    expect(invoiceFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          student: expect.objectContaining({
            select: expect.objectContaining({
              enrollments: expect.objectContaining({
                where: expect.objectContaining({
                  status: "ACTIVE",
                  classSection: { academicYear: { NOT: { status: "ARCHIVED" } } },
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("404 when invoice belongs to a student outside the parent's child set (cross-parent PII guard)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession());
    parentFindFirst.mockResolvedValueOnce({
      guardians: [{ studentId: "stu-1" }],
    });
    invoiceFindUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-other", // not in the parent's set
      lines: [],
      payments: [],
      student: { name: "X", nickname: null, enrollments: [] },
    });

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(404);
  });

  it("404 when invoice tenantId does not match the session tenant", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession()); // t-1
    parentFindFirst.mockResolvedValueOnce({
      guardians: [{ studentId: "stu-1" }],
    });
    invoiceFindUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "t-other",
      studentId: "stu-1",
      lines: [],
      payments: [],
      student: { name: "X", nickname: null, enrollments: [] },
    });

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(404);
  });

  it("404 when no parent row matches the session's parentId/email", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession());
    parentFindFirst.mockResolvedValueOnce(null);

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(404);
    expect(invoiceFindUnique).not.toHaveBeenCalled();
  });

  it("401 when no session", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(null);

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(401);
    expect(parentFindFirst).not.toHaveBeenCalled();
  });

  it("403 for non-guardian role (TEACHER)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession({ role: "TEACHER" }));

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(403);
    expect(parentFindFirst).not.toHaveBeenCalled();
  });

  it("403 for non-guardian role (SUPER_ADMIN — admins use /api/invoices/[id])", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(guardianSession({ role: "SUPER_ADMIN" }));

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(403);
    expect(parentFindFirst).not.toHaveBeenCalled();
  });

  it("404 when session has neither parentId nor email — never queries (null-email leak regression, #397)", async () => {
    const { getSession } = await import("@/lib/auth");
    // email: null can occur on degenerate sessions; cast past the string type.
    vi.mocked(getSession).mockResolvedValue({
      ...guardianSession({ parentId: null }),
      email: null,
    } as never);

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(404);
    // The guard must fire BEFORE any parent lookup — a findFirst with
    // { email: null } would match the first null-email parent in the tenant.
    expect(parentFindFirst).not.toHaveBeenCalled();
    expect(invoiceFindUnique).not.toHaveBeenCalled();
  });

  it("404 when session has empty-string email and no parentId (null-email leak regression, #397)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(
      guardianSession({ parentId: null, email: "" }),
    );

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(404);
    expect(parentFindFirst).not.toHaveBeenCalled();
  });

  it("falls back to email lookup when session has no parentId", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(
      guardianSession({ parentId: null, email: "fallback@g.com" }),
    );
    parentFindFirst.mockResolvedValueOnce({
      guardians: [{ studentId: "stu-1" }],
    });
    invoiceFindUnique.mockResolvedValueOnce({
      id: "inv-1",
      tenantId: "t-1",
      studentId: "stu-1",
      invoiceNumber: "INV-0001",
      periodLabel: "April 2026",
      dueDate: new Date("2026-04-30"),
      totalDue: 100_000,
      totalPaid: 0,
      status: "SENT",
      xenditPaymentUrl: null,
      sentAt: null,
      paidAt: null,
      lines: [],
      payments: [],
      student: { name: "Anak", nickname: null, enrollments: [] },
    });

    const { GET } = await import("../guardian/invoices/[id]/route");
    const res = await GET(makeReq() as never, {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(200);
    expect(parentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "fallback@g.com", tenantId: "t-1" },
      }),
    );
  });
});
