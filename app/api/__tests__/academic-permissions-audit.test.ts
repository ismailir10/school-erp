import { beforeEach, expect, it, vi } from "vitest";
const { getSession, programFindMany, yearFindMany } = vi.hoisted(() => ({ getSession: vi.fn(), programFindMany: vi.fn(), yearFindMany: vi.fn() }));
vi.mock("@/lib/auth", async (original) => ({ ...await original<typeof import("@/lib/auth")>(), getSession }));
vi.mock("@/lib/db", () => ({ prisma: { program: { findMany: programFindMany }, academicYear: { findMany: yearFindMany } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true }), getClientIp: () => "audit" }));
vi.mock("@/lib/sessions/reconcile", () => ({ reconcileSessions: vi.fn() }));
vi.mock("@/lib/sessions/teacher-backfill", () => ({ backfillSessionTeacher: vi.fn() }));
import { POST as programPost, GET as programGet } from "../programs/route";
import { PUT as programPut } from "../programs/[id]/route";
import { POST as yearPost, GET as yearGet } from "../academic-years/route";
import { PUT as yearPut, DELETE as yearDelete } from "../academic-years/[id]/route";
import { POST as promote } from "../promotions/route";
import { POST as rollForward } from "../admin/academic-years/[id]/roll-forward/route";
import { PATCH as swap } from "../admin/class-sessions/[id]/route";
import { POST as assign } from "../admin/classes/[id]/teaching-assignments/route";

const session = { id: "viewer", tenantId: "t1", role: "SCHOOL_ADMIN", email: "a@b.test", name: "Viewer", permissions: ["academic.view"], customRoleCode: "audit-view", employeeId: null, parentId: null };
const ctx = { params: Promise.resolve({ id: "own" }) };
beforeEach(() => { vi.clearAllMocks(); getSession.mockResolvedValue(session); programFindMany.mockResolvedValue([]); yearFindMany.mockResolvedValue([]); });
it.each([
  ["program create", programPost], ["program edit", programPut], ["year create", yearPost], ["year edit", yearPut], ["year archive", yearDelete], ["promotion", promote], ["roll-forward", rollForward], ["substitution", swap], ["homeroom assignment", assign],
])("denies %s to academic.view-only admin before accessing records", async (_name, handler) => {
  const req = new Request("http://local/api/audit", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  const res = await (handler as (r: never, c: typeof ctx) => Promise<Response>)(req as never, ctx);
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ missing: "academic.edit" });
});
it.each(["academic.view", "students.view", "invoices.view", "fees.view", "admissions.view", "curriculum.read"])("retains program/year picker reads for %s", async (permission) => {
  getSession.mockResolvedValue({ ...session, permissions: [permission] });
  expect((await programGet()).status).toBe(200);
  expect((await yearGet()).status).toBe(200);
});
it("denies program/year reads for an unrelated custom grant", async () => {
  getSession.mockResolvedValue({ ...session, permissions: ["users.view"] });
  expect((await programGet()).status).toBe(403);
  expect((await yearGet()).status).toBe(403);
  expect(programFindMany).not.toHaveBeenCalled();
  expect(yearFindMany).not.toHaveBeenCalled();
});
