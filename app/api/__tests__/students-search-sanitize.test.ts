import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

const admin: SessionUser = {
  id: "u1",
  email: "a@t",
  name: "A",
  role: "SUPER_ADMIN",
  tenantId: "t1",
  employeeId: null,
  parentId: null,
  permissions: [],
  customRoleCode: null,
};

async function getList(query: string) {
  const { getSession } = await import("@/lib/auth");
  const { prisma } = await import("@/lib/db");
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.student.count).mockResolvedValue(0 as never);
  const { GET } = await import("../students/route");
  const res = await GET(new Request(`http://localhost/api/students${query}`) as never);
  return { res, prisma };
}

describe("GET /api/students — search sanitising (STR-11)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a NUL-only search is dropped instead of reaching Postgres", async () => {
    const { res, prisma } = await getList("?search=%00");
    expect(res.status).toBe(200);
    const where = vi.mocked(prisma.student.findMany).mock.calls[0][0]?.where as Record<string, unknown>;
    expect(where.OR).toBeUndefined();
  });

  it("strips NUL from a mixed term", async () => {
    const { res, prisma } = await getList("?search=ai%00sy");
    expect(res.status).toBe(200);
    const where = vi.mocked(prisma.student.findMany).mock.calls[0][0]?.where as {
      OR: { name: { contains: string } }[];
    };
    expect(where.OR[0].name.contains).toBe("aisy");
  });

  it("escapes LIKE wildcards so '%' matches literally, not every student", async () => {
    const { res, prisma } = await getList("?search=%25_");
    expect(res.status).toBe(200);
    const where = vi.mocked(prisma.student.findMany).mock.calls[0][0]?.where as {
      OR: { name: { contains: string } }[];
    };
    expect(where.OR[0].name.contains).toBe("\\%\\_");
  });
});
