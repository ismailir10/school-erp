import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const { getSession, dbCalls } = vi.hoisted(() => ({
  getSession: vi.fn(),
  dbCalls: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/auth", () => ({
  getSession,
  isAdminRole: (role: string) => ["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(role),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    student: { findFirst: dbCalls, findUnique: dbCalls, update: dbCalls, create: dbCalls },
    studentGuardian: { findFirst: dbCalls, update: dbCalls },
    parent: { findFirst: dbCalls, update: dbCalls },
    $transaction: dbCalls,
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true }), getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/parent-helpers", () => ({ invalidateParentChildren: vi.fn() }));
vi.mock("@/lib/storage", () => ({ saveFile: vi.fn(), deleteFile: vi.fn(), streamFile: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST as createStudent } from "../students/route";
import { PUT as editStudent } from "../students/[id]/route";
import { POST as enroll } from "../students/[id]/enroll/route";
import { POST as promote } from "../students/[id]/promote/route";
import { POST as graduate } from "../students/[id]/graduate/route";
import { POST as withdraw } from "../students/[id]/withdraw/route";
import { POST as addGuardian } from "../students/[id]/guardians/route";
import { PUT as editLinkedGuardian, PATCH as toggleLinkedGuardian } from "../students/[id]/guardians/[guardianId]/route";
import { PUT as editGuardian, PATCH as toggleGuardian } from "../guardians/[id]/route";
import { POST as uploadPhoto, DELETE as deletePhoto } from "../students/[id]/photo/route";

import { PUT as editParent, PATCH as toggleParent } from "../parents/[id]/route";
import { POST as uploadKtp, DELETE as deleteKtp } from "../parents/[id]/ktp/route";
import { POST as uploadKk, DELETE as deleteKk } from "../parents/[id]/kk/route";

type Handler = typeof editLinkedGuardian;
// Valid sessions proceed to validation or a tenant-scoped missing-record lookup.
// The existing CRUD suites cover successful writes; these cover every permission boundary.
const writes = [
  ["create student", createStudent, "students.create", 400],
  ["edit student", editStudent, "students.edit", 404],
  ["enroll student", enroll, "students.edit", 400],
  ["promote student", promote, "students.edit", 400],
  ["graduate student", graduate, "students.edit", 404],
  ["withdraw student", withdraw, "students.edit", 400],
  ["add guardian", addGuardian, "students.edit", 404],
  ["edit linked guardian", editLinkedGuardian, "students.edit", 404],
  ["toggle linked guardian", toggleLinkedGuardian, "students.edit", 404],
  ["edit guardian", editGuardian, "students.edit", 404],
  ["toggle guardian", toggleGuardian, "students.edit", 404],
  ["upload student photo", uploadPhoto, "students.edit", 404],
  ["delete student photo", deletePhoto, "students.edit", 404],
  ["edit standalone parent", editParent, "students.edit", 404],
  ["toggle standalone parent", toggleParent, "students.edit", 404],
  ["upload KTP", uploadKtp, "students.edit", 404],
  ["delete KTP", deleteKtp, "students.edit", 404],
  ["upload KK", uploadKk, "students.edit", 404],
  ["delete KK", deleteKk, "students.edit", 404],
] as const;

function session(role: SessionUser["role"], permissions = getSystemRolePermissions(role)): SessionUser {
  return { id: "synthetic-admin", name: "Synthetic Admin", email: "admin@example.test", role,
    tenantId: "synthetic-tenant", parentId: null, employeeId: null, customRoleCode: null, permissions };
}
function invoke(handler: (typeof writes)[number][1]) {
  const req = new Request("http://localhost/api/students/synthetic-student", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  const readBody = vi.spyOn(req, "json");
  return { response: (handler as Handler)(req as never, {
    params: Promise.resolve({ id: "synthetic-student", guardianId: "synthetic-link" }),
  }), readBody };
}

beforeEach(() => vi.clearAllMocks());

describe.each(writes)("%s permission boundary", (_label, handler, permission, allowedStatus) => {
  it.each([
    ["read-only", ["students.view"]],
    ["no grants", []],
    ["other write grant", [permission === "students.create" ? "students.edit" : "students.create"]],
  ])("rejects %s SCHOOL_ADMIN before parsing input or touching records", async (_case, grants) => {
    getSession.mockResolvedValue({ ...session("SCHOOL_ADMIN", grants), customRoleCode: "limited-admin" });
    const { response, readBody } = invoke(handler);
    const res = await response;
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ missing: permission });
    expect(readBody).not.toHaveBeenCalled();
    expect(dbCalls).not.toHaveBeenCalled();
  });
  it.each(["TEACHER", "GUARDIAN"] as const)("retains the admin-only boundary for %s even with an explicit grant", async role => {
    getSession.mockResolvedValue(session(role, [permission]));
    const { response } = invoke(handler);
    expect((await response).status).toBe(403);
    expect(dbCalls).not.toHaveBeenCalled();
  });
  it.each([
    ["default school admin", session("SCHOOL_ADMIN")],
    ["custom grant", { ...session("SCHOOL_ADMIN", [permission]), customRoleCode: "writer" }],
    ["owner escape hatch", session("SUPER_ADMIN", [])],
  ])("allows %s to reach the existing validation/tenant lookup", async (_case, actor) => {
    getSession.mockResolvedValue(actor);
    expect((await invoke(handler).response).status).toBe(allowedStatus);
  });
});
