import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  countAttendanceThisWeek,
  getParentInvoiceList,
  getParentWithChildren,
  getStudentInvoices,
  mondayOfWeek,
  resolveSelectedChild,
  resolveSelectedChildWithStatus,
} from "../parent-helpers";
import type { SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Mock next/cache so unstable_cache is a no-op (no Next.js incrementalCache runtime in Vitest)
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

// Mock Prisma client
vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
    },
    parent: {
      findFirst: vi.fn(),
    },
  },
}));

describe("getStudentInvoices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch unpaid invoices for a specific student", async () => {
    const mockInvoices = [
      {
        id: "inv-1",
        invoiceNumber: "INV-2024-001",
        periodLabel: "April 2024",
        totalDue: 1000000,
        totalPaid: 0,
        status: "SENT",
        xenditPaymentUrl: "https://payment.url",
        createdAt: new Date("2024-04-01"),
      },
      {
        id: "inv-2",
        invoiceNumber: "INV-2024-002",
        periodLabel: "May 2024",
        totalDue: 1000000,
        totalPaid: 500000,
        status: "PARTIALLY_PAID",
        xenditPaymentUrl: null,
        createdAt: new Date("2024-05-01"),
      },
    ];

    vi.mocked(prisma.invoice.findMany).mockResolvedValue(mockInvoices as never);

    const result = await getStudentInvoices("student-123", "tenant-a");

    expect(prisma.invoice.findMany).toHaveBeenCalledWith({
      where: {
        studentId: "student-123",
        tenantId: "tenant-a",
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        invoiceNumber: true,
        periodLabel: true,
        totalDue: true,
        totalPaid: true,
        status: true,
        xenditPaymentUrl: true,
        createdAt: true,
      },
    });

    expect(result).toEqual(mockInvoices);
  });

  it("should not fetch PENDING_PAYMENT_LINK invoices (admin-only status)", async () => {
    // PENDING_PAYMENT_LINK is set when Xendit checkout creation fails. The
    // invoice exists but has no payable URL — parents must never see it
    // because there is nothing actionable they can do. Admin retries the
    // link first, which flips the row to SENT before parents discover it.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const result = await getStudentInvoices("student-123", "tenant-a");

    // The Prisma `where` filter is an explicit allow-list that does NOT
    // include PENDING_PAYMENT_LINK — so even if such a row exists in the
    // DB the query will not return it. We assert the where shape directly.
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        }),
      })
    );
    // Sanity: the allow-list does not include PENDING_PAYMENT_LINK.
    const call = vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as {
      where: { status: { in: string[] } };
    };
    expect(call.where.status.in).not.toContain("PENDING_PAYMENT_LINK");
    expect(result).toEqual([]);
  });

  it("isolates two sibling parents across tenants — no cross-tenant leak", async () => {
    // Parent A in tenant-a, student-A-123 has invoice inv-A-1.
    // Parent B in tenant-b, student-B-456 has invoice inv-B-1.
    // Each call must trigger its own Prisma query with its own tenantId and
    // receive only its own invoice — no stale cache delivery.
    vi.mocked(prisma.invoice.findMany)
      .mockResolvedValueOnce([
        {
          id: "inv-A-1",
          invoiceNumber: "A-001",
          periodLabel: "April 2024",
          totalDue: 100000,
          totalPaid: 0,
          status: "SENT",
          xenditPaymentUrl: null,
          createdAt: new Date("2024-04-01"),
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "inv-B-1",
          invoiceNumber: "B-001",
          periodLabel: "April 2024",
          totalDue: 200000,
          totalPaid: 0,
          status: "SENT",
          xenditPaymentUrl: null,
          createdAt: new Date("2024-04-01"),
        },
      ] as never);

    const parentA = await getStudentInvoices("student-A-123", "tenant-a");
    const parentB = await getStudentInvoices("student-B-456", "tenant-b");

    expect(parentA).toHaveLength(1);
    expect(parentA[0].id).toBe("inv-A-1");
    expect(parentB).toHaveLength(1);
    expect(parentB[0].id).toBe("inv-B-1");

    // Defense-in-depth: Prisma was called with tenantId on each side.
    expect(prisma.invoice.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ studentId: "student-A-123", tenantId: "tenant-a" }),
      })
    );
    expect(prisma.invoice.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ studentId: "student-B-456", tenantId: "tenant-b" }),
      })
    );
  });
});

describe("getParentInvoiceList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Happy path — only the 4 allow-listed statuses come back.
  it("returns SENT, PARTIALLY_PAID, OVERDUE, PAID; excludes PENDING_PAYMENT_LINK, CANCELLED, DRAFT", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await getParentInvoiceList("parent-1", "student-1", "tenant-a");

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId: "student-1",
          tenantId: "tenant-a",
          student: { guardians: { some: { parentId: "parent-1" } } },
          status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE", "PAID"] },
        },
      })
    );

    const call = vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as {
      where: { status: { in: string[] } };
    };
    expect(call.where.status.in).not.toContain("PENDING_PAYMENT_LINK");
    expect(call.where.status.in).not.toContain("CANCELLED");
    expect(call.where.status.in).not.toContain("DRAFT");
  });

  // The previous deny-list (`status: { not: "DRAFT" }`) leaked PENDING_PAYMENT_LINK
  // and CANCELLED rows into the parent UI — the row had no payment link and no
  // error message, looked like a school-side bug. Allow-list closes that hole.
  it("PAID invoices appear (history group)", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: "inv-paid",
        invoiceNumber: "INV-2024-001",
        periodLabel: "April 2024",
        dueDate: new Date("2024-04-30"),
        totalDue: 1000000,
        totalPaid: 1000000,
        status: "PAID",
        xenditPaymentUrl: "https://payment.url",
        sentAt: new Date("2024-04-01"),
        paidAt: new Date("2024-04-15"),
        createdAt: new Date("2024-04-01"),
      },
    ] as never);

    const result = await getParentInvoiceList("parent-1", "student-1", "tenant-a");

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("PAID");
    expect(result[0].paidAt).toBe("2024-04-15T00:00:00.000Z");
  });

  it("scopes invoice reads by guardian link, student, and tenant", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await getParentInvoiceList("parent-A", "student-A-123", "tenant-a");
    await getParentInvoiceList("parent-B", "student-B-456", "tenant-b");

    expect(prisma.invoice.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ studentId: "student-A-123", tenantId: "tenant-a", student: { guardians: { some: { parentId: "parent-A" } } } }),
      })
    );
    expect(prisma.invoice.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ studentId: "student-B-456", tenantId: "tenant-b", student: { guardians: { some: { parentId: "parent-B" } } } }),
      })
    );
  });

  it("preserves Decimal-as-Number coercion for totalDue/totalPaid (parent UI expects numbers)", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: "inv-1",
        invoiceNumber: "INV-2024-001",
        periodLabel: "April 2024",
        dueDate: new Date("2024-04-30"),
        totalDue: 1250000,
        totalPaid: 500000,
        status: "PARTIALLY_PAID",
        xenditPaymentUrl: null,
        sentAt: new Date("2024-04-01"),
        paidAt: null,
        createdAt: new Date("2024-04-01"),
      },
    ] as never);

    const result = await getParentInvoiceList("parent-1", "student-1", "tenant-a");

    expect(result[0].totalDue).toBe(1250000);
    expect(result[0].totalPaid).toBe(500000);
    expect(result[0].paidAt).toBeNull();
  });
});

describe("mondayOfWeek", () => {
  it("returns the same day when given a Monday", () => {
    // 2026-04-13 is a Monday
    expect(mondayOfWeek(new Date("2026-04-13T15:00:00"))).toBe("2026-04-13");
  });

  it("returns prior Monday when given a Sunday", () => {
    // 2026-04-19 is a Sunday → previous Monday is 2026-04-13
    expect(mondayOfWeek(new Date("2026-04-19T10:00:00"))).toBe("2026-04-13");
  });

  it("returns prior Monday when given a Saturday", () => {
    // 2026-04-18 is a Saturday → Monday of that ISO week is 2026-04-13
    expect(mondayOfWeek(new Date("2026-04-18T23:59:00"))).toBe("2026-04-13");
  });

  it("returns prior Monday when given a mid-week day", () => {
    // 2026-04-16 is a Thursday → Monday 2026-04-13
    expect(mondayOfWeek(new Date("2026-04-16T08:00:00"))).toBe("2026-04-13");
  });
});

describe("getParentWithChildren — lookup invariants (U10 hardening)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function session(overrides: Partial<SessionUser>): SessionUser {
    return {
      id: "u_test",
      email: "guardian@example.com",
      role: "GUARDIAN",
      name: "Test Guardian",
      tenantId: "tenant-a",
      employeeId: null,
      parentId: "parent-a",
      permissions: [],
      customRoleCode: null,
      ...overrides,
    } as SessionUser;
  }

  it("returns empty result when tenantId is null — no Prisma call", async () => {
    const result = await getParentWithChildren(session({ tenantId: null }));
    expect(result).toEqual({ parent: null, children: [] });
    expect(prisma.parent.findFirst).not.toHaveBeenCalled();
  });

  it("returns empty result when both parentId and email are null — no Prisma call", async () => {
    const result = await getParentWithChildren(
      session({ parentId: null, email: null as unknown as string }),
    );
    expect(result).toEqual({ parent: null, children: [] });
    expect(prisma.parent.findFirst).not.toHaveBeenCalled();
  });

  it("returns empty result when parentId is null and email is empty string — no Prisma call", async () => {
    const result = await getParentWithChildren(
      session({ parentId: null, email: "" }),
    );
    expect(result).toEqual({ parent: null, children: [] });
    expect(prisma.parent.findFirst).not.toHaveBeenCalled();
  });

  it("uses {id, tenantId} where shape when parentId is set", async () => {
    vi.mocked(prisma.parent.findFirst).mockResolvedValue(null);
    await getParentWithChildren(
      session({ parentId: "parent-a", email: "guardian@example.com", tenantId: "tenant-a" }),
    );
    expect(prisma.parent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "parent-a", tenantId: "tenant-a" },
      }),
    );
  });

  it("uses {email, tenantId} where shape when parentId is null but email is non-empty", async () => {
    vi.mocked(prisma.parent.findFirst).mockResolvedValue(null);
    await getParentWithChildren(
      session({ parentId: null, email: "guardian@example.com", tenantId: "tenant-a" }),
    );
    expect(prisma.parent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "guardian@example.com", tenantId: "tenant-a" },
      }),
    );
  });

  it("never issues a Prisma query whose where shape includes email:null — closes the staging null-email leak", async () => {
    vi.mocked(prisma.parent.findFirst).mockResolvedValue(null);

    // Even with parentId set, an attacker-controlled session shape with
    // email=null must not produce a `{ email: null, ... }` filter.
    await getParentWithChildren(
      session({ parentId: "parent-a", email: null as unknown as string, tenantId: "tenant-a" }),
    );
    const call = vi.mocked(prisma.parent.findFirst).mock.calls[0]?.[0] as
      | { where: Record<string, unknown> }
      | undefined;
    if (call) {
      expect(call.where).not.toHaveProperty("email", null);
    }
  });

  it("collapses cache slots: two sessions for the same parentId with different email values cache-key-share via email=null", async () => {
    // unstable_cache is mocked as identity here, so the assertion is on
    // the args passed into the cache wrapper — the cache key is keyed on
    // the (parentId, email, tenantId) tuple, so we want both calls below
    // to share an identical tuple. Passing the actual email through
    // would prime two cache slots for what resolves to the same parent
    // row (where = `{ id, tenantId }` ignores email entirely).
    vi.mocked(prisma.parent.findFirst).mockResolvedValue(null);

    await getParentWithChildren(
      session({ parentId: "parent-uuid-1", email: "first@example.com", tenantId: "tenant-a" }),
    );
    await getParentWithChildren(
      session({ parentId: "parent-uuid-1", email: "second@example.com", tenantId: "tenant-a" }),
    );

    // Both calls hit the same Prisma where — driven by parentId + tenantId only.
    expect(prisma.parent.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "parent-uuid-1", tenantId: "tenant-a" },
      }),
    );
    expect(prisma.parent.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "parent-uuid-1", tenantId: "tenant-a" },
      }),
    );
  });

  it("isolates two sibling parents — parentId=null vs parentId=<uuid> with same email+tenantId route to different where clauses", async () => {
    // Cache-key isolation regression guard. unstable_cache is mocked as
    // identity here (so it does not memoise), but the underlying Prisma
    // where shape MUST differ between the two calls — otherwise a real
    // unstable_cache deployment would key-collide on the static cache
    // key array and serve one parent's data to the other.
    vi.mocked(prisma.parent.findFirst).mockResolvedValue(null);

    await getParentWithChildren(
      session({ parentId: null, email: "shared@example.com", tenantId: "tenant-a" }),
    );
    await getParentWithChildren(
      session({ parentId: "parent-uuid-1", email: "shared@example.com", tenantId: "tenant-a" }),
    );

    expect(prisma.parent.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { email: "shared@example.com", tenantId: "tenant-a" },
      }),
    );
    expect(prisma.parent.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "parent-uuid-1", tenantId: "tenant-a" },
      }),
    );
  });

  it("returns empty children when the parent row is found but has no guardian links", async () => {
    vi.mocked(prisma.parent.findFirst).mockResolvedValue({
      id: "parent-a",
      tenantId: "tenant-a",
      guardians: [],
    } as never);
    const result = await getParentWithChildren(session({}));
    expect(result).toEqual({ parent: null, children: [] });
  });

  it("maps guardians to children when the parent has linked students", async () => {
    vi.mocked(prisma.parent.findFirst).mockResolvedValue({
      id: "parent-a",
      tenantId: "tenant-a",
      guardians: [
        {
          studentId: "stu-1",
          relationship: "IBU",
          student: {
            id: "stu-1",
            name: "Aisyah",
            nickname: "Aisha",
            enrollments: [
              {
                id: "enr-1",
                status: "ACTIVE",
                classSection: {
                  id: "cs-1",
                  name: "TK B1",
                  program: { name: "TK" },
                },
              },
            ],
          },
        },
      ],
    } as never);

    const result = await getParentWithChildren(session({}));
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({
      studentId: "stu-1",
      studentName: "Aisyah",
      studentNickname: "Aisha",
      className: "TK B1",
      programName: "TK",
      relationship: "IBU",
    });
  });

  it("joins both classes for a dual-enrolled child (sekolah + daycare), SEMESTER first", async () => {
    vi.mocked(prisma.parent.findFirst).mockResolvedValue({
      id: "parent-a",
      tenantId: "tenant-a",
      guardians: [
        {
          studentId: "stu-1",
          relationship: "IBU",
          student: {
            id: "stu-1",
            name: "Aisyah",
            nickname: "Aisha",
            enrollments: [
              {
                id: "enr-daycare",
                status: "ACTIVE",
                enrollDate: "2025-06-01",
                classSection: {
                  id: "cs-daycare",
                  name: "Daycare 1",
                  program: { name: "Daycare", type: "YEAR_ROUND" },
                },
              },
              {
                id: "enr-sekolah",
                status: "ACTIVE",
                enrollDate: "2025-07-01",
                classSection: {
                  id: "cs-sekolah",
                  name: "TK B1",
                  program: { name: "TK", type: "SEMESTER" },
                },
              },
            ],
          },
        },
      ],
    } as never);

    const result = await getParentWithChildren(session({}));
    expect(result.children).toHaveLength(1);
    // SEMESTER enrollment ordered first even though it's listed second in
    // the Prisma result and has a later enrollDate.
    expect(result.children[0].className).toBe("TK B1 & Daycare 1");
    expect(result.children[0].programName).toBe("TK & Daycare");
  });
});

describe("countAttendanceThisWeek", () => {
  // Reference "now" = Friday 2026-04-17. Week window: Mon 2026-04-13 → Fri 2026-04-17.
  const now = new Date("2026-04-17T12:00:00");

  it("ignores records before Monday (weekend boundary)", () => {
    const records = [
      { date: "2026-04-12", status: "PRESENT" }, // prior Sunday — outside
      { date: "2026-04-11", status: "PRESENT" }, // prior Saturday — outside
      { date: "2026-04-13", status: "PRESENT" }, // Monday — inside
    ];
    const counts = countAttendanceThisWeek(records, now);
    expect(counts).toEqual({ PRESENT: 1, SICK: 0, PERMISSION: 0, ABSENT: 0 });
  });

  it("ignores records after today (future Saturday/Sunday)", () => {
    const records = [
      { date: "2026-04-17", status: "PRESENT" }, // today — inside
      { date: "2026-04-18", status: "PRESENT" }, // Saturday (future) — outside
      { date: "2026-04-19", status: "PRESENT" }, // Sunday (future) — outside
    ];
    const counts = countAttendanceThisWeek(records, now);
    expect(counts).toEqual({ PRESENT: 1, SICK: 0, PERMISSION: 0, ABSENT: 0 });
  });

  it("counts a mixed-status week correctly", () => {
    const records = [
      { date: "2026-04-13", status: "PRESENT" },
      { date: "2026-04-14", status: "PRESENT" },
      { date: "2026-04-15", status: "SICK" },
      { date: "2026-04-16", status: "PERMISSION" },
      { date: "2026-04-17", status: "PRESENT" },
    ];
    const counts = countAttendanceThisWeek(records, now);
    expect(counts).toEqual({ PRESENT: 3, SICK: 1, PERMISSION: 1, ABSENT: 0 });
  });

  it("counts an all-absent week correctly", () => {
    const records = [
      { date: "2026-04-13", status: "ABSENT" },
      { date: "2026-04-14", status: "ABSENT" },
      { date: "2026-04-15", status: "ABSENT" },
      { date: "2026-04-16", status: "ABSENT" },
      { date: "2026-04-17", status: "ABSENT" },
    ];
    const counts = countAttendanceThisWeek(records, now);
    expect(counts).toEqual({ PRESENT: 0, SICK: 0, PERMISSION: 0, ABSENT: 5 });
  });
});

describe("resolveSelectedChildWithStatus (PAR-11)", () => {
  const kids = [
    { studentId: "a", studentName: "A" },
    { studentId: "b", studentName: "B" },
  ] as unknown as Parameters<typeof resolveSelectedChildWithStatus>[0];

  it("returns the requested linked child with no rejection", () => {
    const r = resolveSelectedChildWithStatus(kids, "b");
    expect(r.child?.studentId).toBe("b");
    expect(r.rejectedChildId).toBeNull();
  });

  it("falls back to the first child and reports a foreign id as rejected", () => {
    const r = resolveSelectedChildWithStatus(kids, "foreign-id");
    expect(r.child?.studentId).toBe("a");
    expect(r.rejectedChildId).toBe("foreign-id");
  });

  it("does not report a missing param as rejected", () => {
    expect(resolveSelectedChildWithStatus(kids, undefined)).toMatchObject({ rejectedChildId: null });
  });

  it("returns null child for an empty family and keeps resolveSelectedChild unchanged", () => {
    expect(resolveSelectedChildWithStatus([], "x")).toEqual({ child: null, rejectedChildId: null });
    expect(resolveSelectedChild(kids, "nope")?.studentId).toBe("a");
    expect(resolveSelectedChild(kids, "b")?.studentId).toBe("b");
  });
});
