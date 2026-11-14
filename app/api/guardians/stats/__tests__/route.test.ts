import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GET } from "../route";

vi.mock("@/lib/db", () => ({ prisma: { parent: { groupBy: vi.fn() } } }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth")>(),
  getSession: vi.fn(),
}));

const session: SessionUser = {
  id: "admin", name: "Admin", email: "admin@example.test", role: "SCHOOL_ADMIN",
  tenantId: "tenant-a", employeeId: null, parentId: null,
  permissions: ["students.view"], customRoleCode: null,
};

describe("GET /api/guardians/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(prisma.parent.groupBy).mockResolvedValue([]);
  });

  it.each(["SCHOOL_ADMIN", "SUPER_ADMIN"] as const)("returns tenant-scoped counts for %s with one aggregate", async (role) => {
    vi.mocked(getSession).mockResolvedValue({ ...session, role });
    vi.mocked(prisma.parent.groupBy).mockResolvedValue([
      { status: "ACTIVE", _count: { status: 7 } },
      { status: "INACTIVE", _count: { status: 3 } },
      // Total matches an unfiltered list, including any legacy status.
      { status: "LEGACY", _count: { status: 2 } },
    ] as never);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total: 12, active: 7, inactive: 3 });
    expect(prisma.parent.groupBy).toHaveBeenCalledExactlyOnceWith({
      by: ["status"], where: { tenantId: "tenant-a" }, _count: { status: true },
    });
  });

  it.each([{ permissions: [] }, { permissions: ["admissions.view"] }])("denies a custom admin without students.view ($permissions) before reading family counts", async ({ permissions }) => {
    vi.mocked(getSession).mockResolvedValue({ ...session, permissions, customRoleCode: "restricted-audit-role" });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(prisma.parent.groupBy).not.toHaveBeenCalled();
  });

  it("returns real zeros for a tenant with no guardians", async () => {
    expect(await (await GET()).json()).toEqual({ total: 0, active: 0, inactive: 0 });
  });

  it.each([
    null,
    { ...session, tenantId: null },
    { ...session, role: "TEACHER" as const },
    { ...session, role: "GUARDIAN" as const },
  ])("keeps the list route's forbidden response and never reads data for %j", async (viewer) => {
    vi.mocked(getSession).mockResolvedValue(viewer);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(prisma.parent.groupBy).not.toHaveBeenCalled();
  });

  it("does not disguise database failure as empty-tenant totals", async () => {
    vi.mocked(prisma.parent.groupBy).mockRejectedValue(new Error("database unavailable"));
    await expect(GET()).rejects.toThrow("database unavailable");
  });
});
