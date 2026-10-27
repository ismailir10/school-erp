import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../promotions/route";
import type { SessionUser } from "@/lib/auth";

vi.mock("@/lib/db", () => ({
  prisma: {
    classSection: { findFirst: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
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
  return new Request("http://localhost:3000/api/promotions", {
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

async function primeMocks(toPromoteCount: number) {
  const { getSession } = await import("@/lib/auth");
  const { prisma } = await import("@/lib/db");
  vi.mocked(getSession).mockResolvedValue(makeSession());
  vi.mocked(prisma.classSection.findFirst).mockResolvedValue({
    id: "cs-target", academicYearId: "y1", program: { id: "p1", type: "SEMESTER" },
  } as never);
  vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue(
    Array.from({ length: toPromoteCount }, (_, i) => ({
      id: `e${i}`,
      studentId: `s${i}`,
      classSectionId: "cs-source",
    })) as never,
  );
  return prisma;
}

describe("POST /api/promotions (bulk promote) — capacity race safety", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when target capacity cannot hold all promotes (inside-tx check)", async () => {
    const prisma = await primeMocks(5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        classSection: prisma.classSection,
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([
          { id: "cs-target", capacity: 10, active_count: BigInt(8) },
        ]),
        studentEnrollment: { updateMany: vi.fn(), upsert: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockImplementation(async (args) => {
            const rows = await prisma.studentEnrollment.findMany();
            return args.where.id ? rows.filter((row) => args.where.id.in.includes(row.id)) : rows;
          }) },
      };
      return cb(tx);
    });

    const res = await POST(
      makeReq({
        sourceClassSectionId: "cs-source",
        targetClassSectionId: "cs-target",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Kapasitas kelas tujuan tidak cukup/);
  });

  it("row-locks the target section in the bulk-promote capacity query", async () => {
    const prisma = await primeMocks(3);
    const capturedSql: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        classSection: prisma.classSection,
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn((strings: TemplateStringsArray) => {
          capturedSql.push(strings.join("?"));
          return Promise.resolve([
            { id: "cs-target", capacity: 10, active_count: BigInt(0) },
          ]);
        }),
        studentEnrollment: {
          findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockImplementation(async (args) => {
            const rows = await prisma.studentEnrollment.findMany();
            return args.where.id ? rows.filter((row) => args.where.id.in.includes(row.id)) : rows;
          }),
          updateMany: vi.fn(),
          upsert: vi.fn().mockResolvedValue({ id: "e-new" }),
        },
      };
      return cb(tx);
    });

    const res = await POST(
      makeReq({
        sourceClassSectionId: "cs-source",
        targetClassSectionId: "cs-target",
      }) as never,
    );
    expect(res.status).toBe(200);
    // Plain `FOR UPDATE`, not `FOR UPDATE OF cs` — Postgres rejects FOR UPDATE
    // combined with GROUP BY (0A000), so the active count is a correlated
    // subquery and the lock applies to the single ClassSection row selected.
    expect(capturedSql[0]).toMatch(/FOR UPDATE/);
    expect(capturedSql[0]).not.toMatch(/GROUP BY/);
    expect(capturedSql[0]).toMatch(/StudentEnrollment/);
  });

  it("succeeds with promoted+skipped count on happy path", async () => {
    const prisma = await primeMocks(3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        classSection: prisma.classSection,
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([
          { id: "cs-target", capacity: 10, active_count: BigInt(2) },
        ]),
        studentEnrollment: {
          findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockImplementation(async (args) => {
            const rows = await prisma.studentEnrollment.findMany();
            return args.where.id ? rows.filter((row) => args.where.id.in.includes(row.id)) : rows;
          }),
          updateMany: vi.fn(),
          upsert: vi.fn().mockResolvedValue({ id: "e-new" }),
        },
      };
      return cb(tx);
    });

    const res = await POST(
      makeReq({
        sourceClassSectionId: "cs-source",
        targetClassSectionId: "cs-target",
        excludeStudentIds: ["s2"],
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.promoted).toBe(2);
    expect(body.skipped).toBe(1);
  });
});
