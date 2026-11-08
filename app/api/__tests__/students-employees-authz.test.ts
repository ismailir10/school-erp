import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findMany: vi.fn(), count: vi.fn() },
    employee: { findMany: vi.fn(), count: vi.fn() },
    teachingAssignment: { findFirst: vi.fn() },
    sentraRotationClass: { findFirst: vi.fn().mockResolvedValue(null) },
    studentEnrollment: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function makeSession(role: SessionUser["role"], employeeId: string | null = null): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role,
    tenantId: "t1",
    employeeId,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

describe("GET /api/students — admin-only role gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for TEACHER", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));

    const { GET } = await import("../students/route");
    const res = await GET(new Request("http://localhost/api/students") as never);
    expect(res.status).toBe(403);
  });

  it("returns 403 for GUARDIAN", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("GUARDIAN"));

    const { GET } = await import("../students/route");
    const res = await GET(new Request("http://localhost/api/students") as never);
    expect(res.status).toBe(403);
  });

  it("returns 200 for SUPER_ADMIN", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("SUPER_ADMIN"));
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.student.count).mockResolvedValue(0 as never);

    const { GET } = await import("../students/route");
    const res = await GET(new Request("http://localhost/api/students") as never);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/employees — admin-only role gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for TEACHER", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));

    const { GET } = await import("../employees/route");
    const res = await GET(new Request("http://localhost/api/employees") as never);
    expect(res.status).toBe(403);
  });

  it("returns 403 for GUARDIAN", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("GUARDIAN"));

    const { GET } = await import("../employees/route");
    const res = await GET(new Request("http://localhost/api/employees") as never);
    expect(res.status).toBe(403);
  });

  it("returns 200 for SUPER_ADMIN", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("SUPER_ADMIN"));
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.employee.count).mockResolvedValue(0 as never);

    const { GET } = await import("../employees/route");
    const res = await GET(new Request("http://localhost/api/employees") as never);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/teacher/students — teacher-for-class gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when classId missing", async () => {
    const { GET } = await import("../teacher/students/route");
    const res = await GET(new Request("http://localhost/api/teacher/students") as never);
    expect(res.status).toBe(400);
  });

  it("returns 403 for GUARDIAN", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession("GUARDIAN"));

    const { GET } = await import("../teacher/students/route");
    const res = await GET(
      new Request("http://localhost/api/teacher/students?classId=cs-1") as never
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for TEACHER not assigned to the class", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));
    vi.mocked(prisma.teachingAssignment.findFirst).mockResolvedValue(null);

    const { GET } = await import("../teacher/students/route");
    const res = await GET(
      new Request("http://localhost/api/teacher/students?classId=cs-1") as never
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 with roster for TEACHER assigned to the class", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession("TEACHER", "emp-1"));
    vi.mocked(prisma.teachingAssignment.findFirst).mockResolvedValue({ id: "ta-1" } as never);
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([
      {
        id: "enr-1",
        student: {
          id: "s-1",
          name: "Ali",
          nickname: null,
          gender: "M",
          dateOfBirth: null,
          status: "ACTIVE",
        },
      },
    ] as never);

    const { GET } = await import("../teacher/students/route");
    const res = await GET(
      new Request("http://localhost/api/teacher/students?classId=cs-1") as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Ali");
  });
});
