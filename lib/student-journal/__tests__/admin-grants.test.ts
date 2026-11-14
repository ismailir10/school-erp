import { beforeEach, describe, expect, it, vi } from "vitest";
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole: (role: string) => ["SCHOOL_ADMIN", "SUPER_ADMIN"].includes(role) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { requireAdmin } from "../guards";
import { entryBatchSchema } from "@/lib/validations/student-journal";
describe("journal grants and dates", () => {
  beforeEach(() => vi.clearAllMocks());
  it("denies academic-only administrators access to student journals", async () => {
    getSession.mockResolvedValue({ id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1", permissions: ["academic.view"] });
    expect((await requireAdmin()).error?.status).toBe(403);
  });
  it("permits reading with students.view while denying corrections without students.edit", async () => {
    getSession.mockResolvedValue({ id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1", permissions: ["students.view"] });
    expect((await requireAdmin()).session?.id).toBe("u1");
    expect((await requireAdmin("students.edit")).error?.status).toBe(403);
  });
  it("rejects future checklist writes while accepting an actual past Saturday", () => {
    const body = { classSectionId: "c1", entries: [{ studentId: "s1", indicatorId: "i1", checked: true }] };
    expect(entryBatchSchema.safeParse({ ...body, date: "2999-11-16" }).success).toBe(false);
    expect(entryBatchSchema.safeParse({ ...body, date: "2026-04-25" }).success).toBe(true);
  });
});
