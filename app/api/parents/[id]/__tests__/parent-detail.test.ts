import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth";

const { parentFindFirst, invoiceFindMany } = vi.hoisted(() => ({
  parentFindFirst: vi.fn(),
  invoiceFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    parent: { findFirst: parentFindFirst },
    invoice: { findMany: invoiceFindMany },
  },
}));

// isAdminRole stays REAL (only getSession is mocked) — the whole point of
// the non-admin-role tests below is exercising the route's actual
// SUPER_ADMIN/SCHOOL_ADMIN gate, not a stand-in that always says "true".
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true, remaining: 19 }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

import { GET } from "../route";
import { getSession } from "@/lib/auth";

function makeSession(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u-1",
    tenantId: "t-1",
    role: "SUPER_ADMIN",
    email: "admin@test.com",
    name: "Admin",
    permissions: [],
    customRoleCode: null,
    employeeId: null,
    parentId: null,
    ...overrides,
  };
}

function makeParent(overrides: Record<string, unknown> = {}) {
  return {
    id: "par-1",
    tenantId: "t-1",
    name: "Ibu Fatimah",
    email: "fatimah@test.com",
    phone: "081234567890",
    whatsapp: "081234567890",
    address: "Jl. Mawar 10",
    nik: "3201234567890001",
    education: "S1",
    occupation: "Guru",
    employer: "SDN 1 Jakarta",
    employerAddress: "Jl. Merdeka 1",
    employerCity: "Jakarta",
    incomeRange: "Rp 3-5 Juta",
    childrenTotal: 2,
    status: "ACTIVE",
    guardians: [
      {
        id: "sg-1",
        relationship: "IBU",
        isPrimary: true,
        status: "ACTIVE",
        studentId: "stu-1",
        student: {
          id: "stu-1",
          name: "Aisyah",
          status: "ACTIVE",
          gender: "P",
          enrollments: [
            { id: "en-1", enrollDate: "2025-07-14", status: "ACTIVE", classSection: { name: "TKIT A", program: { type: "SEMESTER" }, academicYear: { status: "ACTIVE" } } },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function makeInvoice(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `inv-${n}`,
    invoiceNumber: `INV-2026-${String(n).padStart(4, "0")}`,
    periodLabel: `Periode ${n}`,
    dueDate: `2026-03-${String((n % 28) + 1).padStart(2, "0")}`,
    totalDue: "500000.00",
    totalPaid: "0.00",
    status: "SENT",
    studentId: "stu-1",
    createdAt: new Date(2026, 0, 1, 0, n),
    student: { name: "Aisyah" },
    ...overrides,
  };
}

async function callGet() {
  const req = new NextRequest("http://localhost/api/parents/par-1");
  return GET(req, { params: Promise.resolve({ id: "par-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  invoiceFindMany.mockResolvedValue([makeInvoice(1)]);
});

describe("GET /api/parents/[id]", () => {
  it("returns full parent with linked students and invoices", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession());
    parentFindFirst.mockResolvedValue(makeParent());
    const req = new NextRequest("http://localhost/api/parents/par-1");
    const res = await GET(req, { params: Promise.resolve({ id: "par-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Ibu Fatimah");
    expect(body.education).toBe("S1");
    expect(body.guardians).toHaveLength(1);
    expect(body.invoices).toHaveLength(1);
  });

  it("scopes the invoice query to the tenant and this parent, with no row cap", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession());
    parentFindFirst.mockResolvedValue(makeParent());
    await callGet();
    expect(parentFindFirst.mock.calls[0][0].where).toEqual({ id: "par-1", tenantId: "t-1" });
    const args = invoiceFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: "t-1", parentId: "par-1" });
    expect(args.take).toBeUndefined();
  });

  it("summarises all 25 invoices while the list holds 10, unpaid first", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession());
    parentFindFirst.mockResolvedValue(makeParent());
    // 1..12 PAID (older), 13..25 unpaid (13 rows, the last 5 OVERDUE).
    const rows = [];
    for (let i = 25; i >= 1; i--) {
      rows.push(
        i <= 12
          ? makeInvoice(i, { status: "PAID", totalPaid: "500000.00" })
          : makeInvoice(i, { status: i >= 21 ? "OVERDUE" : "SENT" }),
      );
    }
    invoiceFindMany.mockResolvedValue(rows);

    const body = await (await callGet()).json();
    expect(body.invoiceSummary.invoiceCount).toBe(25);
    expect(body.invoiceSummary.unpaidCount).toBe(13);
    expect(body.invoiceSummary.overdueCount).toBe(5);
    expect(body.invoiceSummary.outstanding).toBe(13 * 500000);
    expect(body.invoices).toHaveLength(10);
    expect(body.invoices.every((i: { status: string }) => i.status !== "PAID")).toBe(true);
    expect(body.invoices[0]).toMatchObject({
      id: "inv-25",
      totalDue: 500000,
      totalPaid: 0,
      dueDate: expect.any(String),
      studentId: "stu-1",
      studentName: "Aisyah",
    });
    expect(body.unpaidInvoices).toHaveLength(13);
    expect(body.unpaidInvoices[0]).toEqual({
      id: expect.any(String),
      invoiceNumber: expect.any(String),
      periodLabel: expect.any(String),
      studentName: "Aisyah",
      remaining: 500000,
    });
  });

  it("returns per-guardian outstanding and the primary class name, without leaking enrollments", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession());
    parentFindFirst.mockResolvedValue(
      makeParent({
        guardians: [
          makeParent().guardians[0],
          {
            id: "sg-2",
            relationship: "IBU",
            isPrimary: false,
            status: "ACTIVE",
            studentId: "stu-2",
            student: { id: "stu-2", name: "Umar", status: "ACTIVE", gender: "L", enrollments: [] },
          },
        ],
      }),
    );
    invoiceFindMany.mockResolvedValue([
      makeInvoice(1, { studentId: "stu-1", totalPaid: "100000.00" }), // 400k
      makeInvoice(2, { studentId: "stu-1", status: "OVERDUE" }), // 500k
      makeInvoice(3, { studentId: "stu-1", status: "PAID", totalPaid: "500000.00" }),
    ]);

    const body = await (await callGet()).json();
    const [a, b] = body.guardians;
    expect(a.outstanding).toBe(900000);
    expect(a.student.className).toBe("TKIT A");
    expect(a.student).not.toHaveProperty("enrollments");
    expect(Object.keys(a.student).sort()).toEqual(["className", "gender", "id", "name", "status"]);
    expect(b.outstanding).toBe(0);
    expect(b.student.className).toBeNull();
  });

  it("asks prisma only for ACTIVE enrollments outside archived years", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession());
    parentFindFirst.mockResolvedValue(makeParent());
    await callGet();
    const sel = parentFindFirst.mock.calls[0][0].select.guardians.include.student.select;
    expect(sel.enrollments.where).toEqual({
      status: "ACTIVE",
      classSection: { academicYear: { status: { not: "ARCHIVED" } } },
    });
  });

  it("never returns the document tokens or the raw enrollments", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession());
    parentFindFirst.mockResolvedValue(makeParent({ ktpUrl: "tok-ktp", kkUrl: null }));
    const body = await (await callGet()).json();
    expect(body).not.toHaveProperty("ktpUrl");
    expect(body).not.toHaveProperty("kkUrl");
    expect(body.hasKtp).toBe(true);
    expect(body.hasKk).toBe(false);
  });

  it("canRemind follows payments.record; SUPER_ADMIN always can", async () => {
    parentFindFirst.mockResolvedValue(makeParent());

    vi.mocked(getSession).mockResolvedValue(makeSession());
    expect((await (await callGet()).json()).canRemind).toBe(true);

    vi.mocked(getSession).mockResolvedValue(makeSession({ role: "SCHOOL_ADMIN", permissions: ["payments.record", "students.edit"] }));
    const withPerm = await (await callGet()).json();
    expect(withPerm.canRemind).toBe(true);
    expect(withPerm.canEdit).toBe(true);

    vi.mocked(getSession).mockResolvedValue(makeSession({ role: "SCHOOL_ADMIN", permissions: ["students.view"] }));
    const without = await (await callGet()).json();
    expect(without.canRemind).toBe(false);
    expect(without.canEdit).toBe(false);
  });

  it("returns 404 for wrong tenant", async () => {
    vi.mocked(getSession).mockResolvedValue(makeSession());
    parentFindFirst.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/parents/par-999");
    const res = await GET(req, { params: Promise.resolve({ id: "par-999" }) });
    expect(res.status).toBe(404);
    expect(invoiceFindMany).not.toHaveBeenCalled();
  });

  // This route returns NIK, income range, employer name/address, and other
  // PII (see route.ts select clause) — a non-admin role gaining access here
  // is a data-exposure bug, not a UX bug. isAdminRole is real (see the
  // vi.mock above), so these exercise the actual gate, not a stand-in.
  it.each(["TEACHER", "GUARDIAN"] as const)(
    "returns 403 for %s and never queries prisma",
    async (role) => {
      vi.mocked(getSession).mockResolvedValue(makeSession({ role }));
      const req = new NextRequest("http://localhost/api/parents/par-1");
      const res = await GET(req, { params: Promise.resolve({ id: "par-1" }) });
      expect(res.status).toBe(403);
      expect(parentFindFirst).not.toHaveBeenCalled();
      expect(invoiceFindMany).not.toHaveBeenCalled();
    },
  );

  it("returns 403 when there is no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/parents/par-1");
    const res = await GET(req, { params: Promise.resolve({ id: "par-1" }) });
    expect(res.status).toBe(403);
    expect(parentFindFirst).not.toHaveBeenCalled();
  });
});
