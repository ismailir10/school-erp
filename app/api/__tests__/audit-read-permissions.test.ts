import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, read } = vi.hoisted(() => ({ getSession: vi.fn(), read: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole: (role: string) => ["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(role) }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findMany: read }, role: { findMany: read }, campus: { findMany: read }, holiday: { findMany: read }, orgConfig: { findUnique: read } } }));
vi.mock("@/lib/sessions/holiday-fanout", () => ({ reconcileSectionsForHoliday: vi.fn() }));
import { GET as users } from "../users/route";
import { GET as roles } from "../roles/route";
import { GET as campuses } from "../config/campuses/route";
import { GET as holidays, POST as holidayCreate } from "../config/holidays/route";
import { GET as org } from "../config/org/route";
import { NextRequest } from "next/server";
const request = () => new NextRequest("http://localhost/api/test");
beforeEach(() => { vi.clearAllMocks(); getSession.mockResolvedValue({ id: "u", tenantId: "t", role: "SCHOOL_ADMIN", permissions: ["academic.view"] }); });
describe("audit read boundaries", () => {
 it.each([["users", users], ["roles", roles], ["holidays", holidays], ["org", org]] as const)("denies %s to an academic-only admin", async (_name, handler) => {
  expect((await handler(request())).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
 });
 it("preserves campus dropdown dependency for academic viewers", async () => { expect((await campuses(request())).status).toBe(200); });
 it("rejects malformed holiday JSON before persistence", async () => {
  getSession.mockResolvedValue({ id: "u", tenantId: "t", role: "SUPER_ADMIN" });
  const response = await holidayCreate(new NextRequest("http://localhost/api/config/holidays", { method: "POST", body: "{", headers: { "content-type": "application/json" } }));
  expect(response.status).toBe(400);
  expect(read).not.toHaveBeenCalled();
 });
});
