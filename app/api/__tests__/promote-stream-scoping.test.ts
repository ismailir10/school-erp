import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../students/[id]/promote/route";
import type { SessionUser } from "@/lib/auth";

/**
 * `app/api/students/[id]/promote/route.ts` used to resolve the source
 * enrollment with an unscoped `findFirst({ studentId, status: "ACTIVE" })`.
 * Staging showed 16 of 21 current-year students carry a stale ACTIVE row in
 * an ARCHIVED prior year alongside their real current-year row — the
 * unscoped lookup could pick either one. This file proves the fix: the
 * lookup now excludes ARCHIVED years and scopes to the target class's
 * program type, so (a) a stale ARCHIVED-year row is never selected over the
 * current-year row, and (b) promoting a SEMESTER (sekolah) class never
 * touches a student's YEAR_ROUND (daycare) enrollment.
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findFirst: vi.fn() },
    classSection: { findFirst: vi.fn() },
    studentEnrollment: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

// Year-guard is exercised in its own dedicated test file
// (students-enroll-promote-year-guard.test.ts) — default to "ok" here so
// these scoping-focused scenarios are unaffected.
vi.mock("@/lib/classes/year-guard", () => ({
  ensureYearWritableById: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: "t1", yearStatus: "ACTIVE" }),
}));

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/students/s1/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSession(): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role: "SUPER_ADMIN",
    tenantId: "t1",
    employeeId: null,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

const params = Promise.resolve({ id: "s1" });

describe("POST /api/students/[id]/promote — source enrollment scoping", () => {
  beforeEach(() => vi.clearAllMocks());

  async function setupTx() {
    const { prisma } = await import("@/lib/db");
    const tx = {
      classSection: prisma.classSection,
      $executeRaw: vi.fn(),
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ id: "cs-target", capacity: 10, active_count: BigInt(1) }]),
      studentEnrollment: {
        findFirst: vi.fn().mockImplementation((args) => args.where.id ? null : prisma.studentEnrollment.findFirst(args)),
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn(),
        upsert: vi
          .fn()
          .mockResolvedValue({ id: "e-new", classSection: { id: "cs-target", name: "TK-B" } }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(tx));
    return tx;
  }

  it("promotes the current-year ACTIVE row, scoping the lookup away from ARCHIVED years", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1" } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
      id: "cs-target",
      academicYearId: "y-cur",
      program: { type: "SEMESTER" },
    } as never);
    // Stands in for the DB applying the route's `where` clause: with a
    // correctly scoped query, only the current-year row can ever be
    // returned — the stale ARCHIVED-year row is filtered out server-side,
    // never chosen by an ambiguous unscoped `findFirst`.
    vi.mocked(prisma.studentEnrollment.findFirst).mockResolvedValue({
      id: "e-current-year",
    } as never);

    const tx = await setupTx();

    const res = await POST(makeReq({ targetClassSectionId: "cs-target" }) as never, { params });

    expect(res.status).toBe(201);

    // Structural: the lookup excludes ARCHIVED years and scopes to the
    // target's program type — this is what makes the ARCHIVED-year row
    // unreachable, rather than merely "usually not returned first".
    expect(prisma.studentEnrollment.findFirst).toHaveBeenCalledWith({
      where: {
        studentId: "s1",
        status: "ACTIVE",
        classSection: {
          academicYear: { NOT: { status: "ARCHIVED" } },
          program: { type: "SEMESTER" },
        },
      },
      // Excluding ARCHIVED alone leaves two live candidates when a PLANNING
      // next-year enrolment exists alongside the current one, so the source
      // is ordered by year start and the earliest (current) year wins.
      orderBy: { classSection: { academicYear: { startDate: "asc" } } },
    });

    // The row graduated is exactly the one the scoped lookup resolved to —
    // never a different, stale row.
    expect(tx.studentEnrollment.update).toHaveBeenCalledWith({
      where: { id: "e-current-year" },
      data: { status: "GRADUATED", notes: undefined },
    });
  });

  it("promoting a SEMESTER class never selects the student's YEAR_ROUND (daycare) enrollment", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "s1", tenantId: "t1" } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
      id: "cs-target",
      academicYearId: "y-cur",
      program: { type: "SEMESTER" },
    } as never);
    vi.mocked(prisma.studentEnrollment.findFirst).mockResolvedValue({
      id: "e-semester",
    } as never);

    const tx = await setupTx();

    const res = await POST(makeReq({ targetClassSectionId: "cs-target" }) as never, { params });

    expect(res.status).toBe(201);

    // The where clause scopes strictly to SEMESTER — a YEAR_ROUND row for
    // the same student is structurally excluded from ever matching.
    const call = vi.mocked(prisma.studentEnrollment.findFirst).mock.calls[0]?.[0];
    expect(call?.where?.classSection).toMatchObject({ program: { type: "SEMESTER" } });

    // Exactly one row is touched: the SEMESTER row the lookup resolved.
    // The daycare (YEAR_ROUND) enrollment is never referenced, let alone
    // updated.
    expect(tx.studentEnrollment.update).toHaveBeenCalledTimes(1);
    expect(tx.studentEnrollment.update).toHaveBeenCalledWith({
      where: { id: "e-semester" },
      data: { status: "GRADUATED", notes: undefined },
    });
  });
});
