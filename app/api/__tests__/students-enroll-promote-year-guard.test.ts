import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

/**
 * Academic-year guard on student enroll + promote (class-picker-year-scoping
 * cycle, Task 1). `lib/classes/year-guard.ts` already gates class CRUD
 * against ARCHIVED academic years; the enroll/promote routes never adopted
 * it, so a misclick in the (pre-scoping) 53-row class picker could silently
 * enrol a student into a class whose academic year is archived. This file
 * exercises the real `ensureYearWritableById` implementation (not mocked)
 * against a mocked `prisma.academicYear.findFirst`, so the wiring in both
 * routes and the guard's own status-branching are both covered.
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findFirst: vi.fn() },
    classSection: { findFirst: vi.fn() },
    academicYear: { findFirst: vi.fn() },
    studentEnrollment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
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

function makeSession(role: SessionUser["role"] = "SUPER_ADMIN"): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role,
    tenantId: "t1",
    employeeId: null,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

function makeReq(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "s1" });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/students/[id]/enroll — academic-year guard", () => {
  it("rejects enrolment into an ARCHIVED-year class with 403 YEAR_ARCHIVED, and never runs the capacity transaction", async () => {
    const { POST } = await import("../students/[id]/enroll/route");
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
      status: "ACTIVE",
      dateOfBirth: null,
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
      id: "cs1",
      tenantId: "t1",
      academicYearId: "y-old",
      program: { ageMin: null, ageMax: null },
    } as never);
    vi.mocked(prisma.academicYear.findFirst).mockResolvedValue({
      status: "ARCHIVED",
    } as never);

    const res = await POST(
      makeReq("http://localhost:3000/api/students/s1/enroll", {
        classSectionId: "cs1",
      }) as never,
      { params },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("YEAR_ARCHIVED");
    expect(body.error).toBe(
      "Tahun ajaran sudah diarsipkan. Pilih kelas pada tahun ajaran yang aktif.",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reaches the normal enrol path when the target class's year is ACTIVE", async () => {
    const { POST } = await import("../students/[id]/enroll/route");
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
      status: "ACTIVE",
      dateOfBirth: null,
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
      id: "cs1",
      tenantId: "t1",
      academicYearId: "y-cur",
      program: { id: "p1", type: "SEMESTER", name: "KB", ageMin: null, ageMax: null },
      academicYear: { startDate: "2026-07-01" },
    } as never);
    vi.mocked(prisma.academicYear.findFirst).mockResolvedValue({
      status: "ACTIVE",
    } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({
        studentEnrollment: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi
            .fn()
            .mockResolvedValue({ id: "e1", studentId: "s1", classSectionId: "cs1" }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "cs1", capacity: 10 }]),
        // Student-stream advisory lock taken first inside the transaction.
        $executeRaw: vi.fn().mockResolvedValue(1),
      }),
    );

    const res = await POST(
      makeReq("http://localhost:3000/api/students/s1/enroll", {
        classSectionId: "cs1",
      }) as never,
      { params },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("e1");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/promotions (bulk promote) — academic-year guard", () => {
  // Same hole as the single-student routes, at roster scale. The bulk-promote
  // dialog has a client-side year selector, but that is a convenience, not an
  // enforcement boundary — a direct API call bypasses it entirely.
  function bulkReq() {
    return makeReq("http://localhost:3000/api/promotions", {
      sourceClassSectionId: "cs-source",
      targetClassSectionId: "cs-target",
    }) as never;
  }

  it("rejects bulk promotion into an ARCHIVED-year target with 403 YEAR_ARCHIVED, and never runs the capacity transaction", async () => {
    const { POST } = await import("../promotions/route");
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.classSection.findFirst)
      .mockResolvedValueOnce({ id: "cs-source", tenantId: "t1" } as never)
      .mockResolvedValueOnce({
        id: "cs-target",
        academicYearId: "y-old",
      } as never);
    vi.mocked(prisma.academicYear.findFirst).mockResolvedValue({
      status: "ARCHIVED",
    } as never);

    const res = await POST(bulkReq());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("YEAR_ARCHIVED");
    expect(body.error).toBe(
      "Tahun ajaran sudah diarsipkan. Pilih kelas pada tahun ajaran yang aktif.",
    );
    // Guard runs before the roster is even read, so nothing is graduated.
    expect(prisma.studentEnrollment.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reaches the roster fetch when the bulk target's year is ACTIVE", async () => {
    const { POST } = await import("../promotions/route");
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.classSection.findFirst)
      .mockResolvedValueOnce({ id: "cs-source", tenantId: "t1" } as never)
      .mockResolvedValueOnce({
        id: "cs-target",
        academicYearId: "y-cur",
      } as never);
    vi.mocked(prisma.academicYear.findFirst).mockResolvedValue({
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([] as never);

    const res = await POST(bulkReq());

    expect(res.status).toBe(200);
    expect(prisma.studentEnrollment.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/students/[id]/promote — academic-year guard", () => {
  async function setupCommon() {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.studentEnrollment.findFirst).mockResolvedValue({
      id: "e-old",
    } as never);
    return prisma;
  }

  it("rejects promotion into an ARCHIVED-year target with 403 YEAR_ARCHIVED, and never runs the capacity transaction", async () => {
    const { POST } = await import("../students/[id]/promote/route");
    const prisma = await setupCommon();
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
      id: "cs-target",
      academicYearId: "y-old",
      program: { type: "SEMESTER" },
    } as never);
    vi.mocked(prisma.academicYear.findFirst).mockResolvedValue({
      status: "ARCHIVED",
    } as never);

    const res = await POST(
      makeReq("http://localhost:3000/api/students/s1/promote", {
        targetClassSectionId: "cs-target",
      }) as never,
      { params },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("YEAR_ARCHIVED");
    expect(body.error).toBe(
      "Tahun ajaran sudah diarsipkan. Pilih kelas pada tahun ajaran yang aktif.",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reaches the normal promote path when the target class's year is ACTIVE", async () => {
    const { POST } = await import("../students/[id]/promote/route");
    const prisma = await setupCommon();
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
      id: "cs-target",
      academicYearId: "y-cur",
      program: { type: "SEMESTER" },
    } as never);
    vi.mocked(prisma.academicYear.findFirst).mockResolvedValue({
      status: "ACTIVE",
    } as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({
        $queryRaw: vi.fn().mockResolvedValue([
          { id: "cs-target", capacity: 10, active_count: BigInt(3) },
        ]),
        studentEnrollment: {
          update: vi.fn(),
          upsert: vi
            .fn()
            .mockResolvedValue({ id: "e-new", classSection: { id: "cs-target", name: "K-A" } }),
        },
      }),
    );

    const res = await POST(
      makeReq("http://localhost:3000/api/students/s1/promote", {
        targetClassSectionId: "cs-target",
      }) as never,
      { params },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("e-new");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
