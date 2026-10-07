import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { __resetRateLimitForTest } from "@/lib/rate-limit";
import { ATTENDANCE_TAP_BUDGET } from "@/lib/api/rate-limit-budgets";

// Real limiter (not mocked): the bug was the budget and its key, so the test
// must exercise both. Regression for "Absensi belum tersimpan. Terlalu banyak
// permintaan" on the 11th child of a class (10/min/IP, one POST per tap).

vi.mock("@/lib/db", () => ({
  prisma: {
    teachingAssignment: { findFirst: vi.fn() },
    classSection: { findFirst: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function teacher(id: string): SessionUser {
  return {
    id,
    email: `${id}@school`,
    name: id,
    role: "TEACHER",
    tenantId: "t1",
    employeeId: `emp-${id}`,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

// Every request comes from the same school Wi-Fi address.
function tap(studentId: string) {
  return new Request("http://localhost:3000/api/student-attendance/mark", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({
      classSectionId: "cs-1",
      date: "2026-04-20",
      records: [{ studentId, status: "PRESENT" }],
    }),
  });
}

describe("POST /api/student-attendance/mark — rate limit", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    __resetRateLimitForTest();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.teachingAssignment.findFirst).mockResolvedValue({ id: "ta" } as never);
    // Enrollment is validated before the transaction opens (api-integrity T5).
    vi.mocked(prisma.studentEnrollment.findMany).mockImplementation((async ({ where }: { where: { studentId: { in: string[] } } }) =>
      where.studentId.in.map((studentId) => ({ studentId }))) as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) =>
      cb({
        $executeRaw: vi.fn().mockResolvedValue(1),
        classSession: { findMany: vi.fn().mockResolvedValue([]) },
        studentAttendance: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn(),
        },
      })) as never);
  });

  it("lets two teachers on the same IP each tap a full 30-child class within a minute", async () => {
    const { getSession } = await import("@/lib/auth");
    const { POST } = await import("../student-attendance/mark/route");
    for (const who of ["bu-ani", "pak-budi"]) {
      vi.mocked(getSession).mockResolvedValue(teacher(who));
      for (let i = 0; i < 30; i++) {
        const res = await POST(tap(`s-${i}`) as never);
        expect(res.status, `${who} tap ${i + 1}`).toBe(200);
      }
    }
  });

  it("still throttles one runaway user past the budget", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(teacher("bu-ani"));
    const { POST } = await import("../student-attendance/mark/route");
    for (let i = 0; i < ATTENDANCE_TAP_BUDGET; i++) {
      expect((await POST(tap("s-1") as never)).status).toBe(200);
    }
    const res = await POST(tap("s-1") as never);
    expect(res.status).toBe(429);
  });

  it("rejects unauthenticated requests before touching the budget", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(null as never);
    const { POST } = await import("../student-attendance/mark/route");
    expect((await POST(tap("s-1") as never)).status).toBe(401);
  });
});
