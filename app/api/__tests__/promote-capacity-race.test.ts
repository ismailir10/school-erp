import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../students/[id]/promote/route";
import type { SessionUser } from "@/lib/auth";

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
// (students-enroll-promote-year-guard.test.ts) — default to "ok" here so the
// existing capacity-race scenarios in this file are unaffected.
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

const params = Promise.resolve({ id: "s1" });

describe("POST /api/students/[id]/promote — capacity race safety", () => {
  beforeEach(() => vi.clearAllMocks());

  async function setupMocks(activeCount: number, capacity: number) {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
    } as never);
    vi.mocked(prisma.studentEnrollment.findFirst).mockResolvedValue({
      id: "e-old",
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
      id: "cs-target",
      program: { type: "SEMESTER" },
    } as never);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        classSection: prisma.classSection,
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([
          {
            id: "cs-target",
            capacity,
            active_count: BigInt(activeCount),
          },
        ]),
        studentEnrollment: {
          findFirst: vi.fn().mockImplementation((args) => args.where.id ? null : prisma.studentEnrollment.findFirst(args)),
          findUnique: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(activeCount),
          update: vi.fn(),
          upsert: vi
            .fn()
            .mockResolvedValue({ id: "e-new", classSection: { id: "cs-target", name: "K-A" } }),
        },
      };
      return cb(tx);
    });
    return prisma;
  }

  it("rejects with 400 when target class is already at capacity (concurrent promote lost)", async () => {
    await setupMocks(10, 10);

    const res = await POST(makeReq({ targetClassSectionId: "cs-target" }) as never, {
      params,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/penuh/i);
  });

  it("performs capacity lock inside $transaction via `SELECT … FOR UPDATE`", async () => {
    const prisma = await setupMocks(5, 10);

    await POST(makeReq({ targetClassSectionId: "cs-target" }) as never, { params });

    // $transaction was called, and its callback invoked tx.$queryRaw.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Walk the mock: the first call arg to mockImplementation cb is itself
    // the transaction callback; we already exercised it above. Check the
    // SQL template by reading the call recorded on the inner tx — we need
    // to re-run with a captured `tx`.
  });

  it("returns 201 on successful promote when seat is available", async () => {
    await setupMocks(5, 10);

    const res = await POST(makeReq({ targetClassSectionId: "cs-target" }) as never, {
      params,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("e-new");
  });

  it("uses `FOR UPDATE OF cs` in the capacity query (structural assert)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.findFirst).mockResolvedValue({
      id: "s1",
      tenantId: "t1",
    } as never);
    vi.mocked(prisma.studentEnrollment.findFirst).mockResolvedValue({
      id: "e-old",
    } as never);
    vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
      id: "cs-target",
      program: { type: "SEMESTER" },
    } as never);

    // Capture the SQL template passed to tx.$queryRaw.
    const capturedSql: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        classSection: prisma.classSection,
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn((strings: TemplateStringsArray) => {
          capturedSql.push(strings.join("?"));
          return Promise.resolve([
            { id: "cs-target", capacity: 10, active_count: BigInt(3) },
          ]);
        }),
        studentEnrollment: {
          findFirst: vi.fn().mockImplementation((args) => args.where.id ? null : prisma.studentEnrollment.findFirst(args)),
          findUnique: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(3),
          update: vi.fn(),
          upsert: vi
            .fn()
            .mockResolvedValue({ id: "e-new", classSection: { id: "cs-target", name: "K-A" } }),
        },
      };
      return cb(tx);
    });

    await POST(makeReq({ targetClassSectionId: "cs-target" }) as never, { params });

    expect(capturedSql.length).toBe(1);
    expect(capturedSql[0]).toMatch(/FOR UPDATE OF cs/);
    expect(capturedSql[0]).not.toMatch(/GROUP BY/);
  });
});
