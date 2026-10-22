/**
 * HR-5 (cycle 2026-09-29 data-integrity): employee email is the login identity.
 *  - POST used to upsert the User by email and rewrite an existing user's role
 *    (SCHOOL_ADMIN -> TEACHER) and employee link, orphaning their employee.
 *  - POST/PUT accepted an email another Employee already carried.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const db = vi.hoisted(() => ({
  employee: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  user: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  campus: { findFirst: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true, remaining: 10 }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { getSession } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";
import { POST } from "../employees/route";
import { PUT } from "../employees/[id]/route";

const ADMIN: SessionUser = {
  id: "u1",
  email: "a@t.local",
  name: "Admin",
  role: "SUPER_ADMIN",
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: [],
  customRoleCode: null,
};

const NEW_EMP = {
  nama: "Budi Santoso",
  email: "Budi@Sekolah.test",
  jabatan: "Guru",
  campusId: "c1",
  hireDate: "2026-09-01",
};

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/employees", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN);
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.$executeRaw.mockResolvedValue(1);
  db.campus.findFirst.mockResolvedValue({ id: "c1" });
  db.employee.findFirst.mockResolvedValue(null);
  db.employee.count.mockResolvedValue(0);
  db.employee.findMany.mockResolvedValue([]);
  db.employee.create.mockResolvedValue({ id: "emp-new", kode: "BS1" });
  db.user.findFirst.mockResolvedValue(null);
  db.user.create.mockResolvedValue({ id: "user-new" });
  db.user.update.mockResolvedValue({});
});

describe("POST /api/employees — email guards (HR-5)", () => {
  it("creates employee + new user when the email is free", async () => {
    const res = await POST(req("POST", NEW_EMP));
    expect(res.status).toBe(201);
    expect(db.user.create).toHaveBeenCalledOnce();
    expect(db.user.upsert).not.toHaveBeenCalled();
    // uniqueness lookups are case-insensitive and tenant-scoped
    expect(db.employee.findFirst.mock.calls[0][0].where).toMatchObject({
      tenantId: "t-1",
      email: { equals: "Budi@Sekolah.test", mode: "insensitive" },
    });
  });

  it("409 with an email field error when another employee has the email", async () => {
    db.employee.findFirst.mockResolvedValueOnce({ id: "emp-other" });
    const res = await POST(req("POST", NEW_EMP));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.errors).toEqual([{ field: "email", message: "Email sudah dipakai karyawan lain" }]);
    expect(db.employee.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("409 and no user mutation when the existing user has a different role", async () => {
    db.user.findFirst.mockResolvedValue({ id: "user-admin", role: "SCHOOL_ADMIN", employeeId: null });
    const res = await POST(req("POST", { ...NEW_EMP, role: "TEACHER" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.errors[0].field).toBe("email");
    expect(json.error).toContain("SCHOOL_ADMIN");
    expect(db.employee.create).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("409 when the existing user is already linked to another employee", async () => {
    db.user.findFirst.mockResolvedValue({ id: "user-t", role: "TEACHER", employeeId: "emp-old" });
    const res = await POST(req("POST", NEW_EMP));
    expect(res.status).toBe(409);
    expect(db.employee.create).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("links an unlinked user with the same role without rewriting role or name", async () => {
    db.user.findFirst.mockResolvedValue({ id: "user-t", role: "TEACHER", employeeId: null });
    const res = await POST(req("POST", NEW_EMP));
    expect(res.status).toBe(201);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-t" },
      data: { employeeId: "emp-new" },
    });
    expect(db.user.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/employees — SCHOOL_ADMIN escalation guard (HR-1)", () => {
  // A custom-role user holding only employees.create.
  const LIMITED: SessionUser = {
    ...ADMIN,
    role: "SCHOOL_ADMIN",
    permissions: ["employees.create"],
    customRoleCode: "hr-intake",
  };

  it("403 when the actor lacks SCHOOL_ADMIN's default permissions", async () => {
    vi.mocked(getSession).mockResolvedValue(LIMITED);
    const res = await POST(req("POST", { ...NEW_EMP, role: "SCHOOL_ADMIN" }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Anda tidak bisa memberikan izin");
    expect(json.missing.length).toBeGreaterThan(0);
    expect(db.employee.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("still lets the same actor create a TEACHER login", async () => {
    vi.mocked(getSession).mockResolvedValue(LIMITED);
    const res = await POST(req("POST", { ...NEW_EMP, role: "TEACHER" }));
    expect(res.status).toBe(201);
  });

  it("lets an actor holding every SCHOOL_ADMIN default permission mint one", async () => {
    vi.mocked(getSession).mockResolvedValue({
      ...LIMITED,
      permissions: [...getSystemRolePermissions("SCHOOL_ADMIN"), "employees.create"],
    });
    const res = await POST(req("POST", { ...NEW_EMP, role: "SCHOOL_ADMIN" }));
    expect(res.status).toBe(201);
  });

  it("lets SUPER_ADMIN mint a SCHOOL_ADMIN login", async () => {
    const res = await POST(req("POST", { ...NEW_EMP, role: "SCHOOL_ADMIN" }));
    expect(res.status).toBe(201);
    expect(db.user.create.mock.calls[0][0].data.role).toBe("SCHOOL_ADMIN");
  });
});

describe("PUT /api/employees/[id] — email guard (HR-5)", () => {
  const params = { params: Promise.resolve({ id: "emp-1" }) };
  beforeEach(() => {
    db.employee.findUnique.mockResolvedValue({ id: "emp-1", tenantId: "t-1", email: "old@sekolah.test" });
    db.employee.update.mockResolvedValue({ id: "emp-1" });
  });

  it("409 with an email field error when another employee has the email", async () => {
    db.employee.findFirst.mockResolvedValue({ id: "emp-2" });
    const res = await PUT(req("PUT", { email: "GURU01@example.test" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).errors).toEqual([
      { field: "email", message: "Email sudah dipakai karyawan lain" },
    ]);
    expect(db.employee.update).not.toHaveBeenCalled();
    expect(db.employee.findFirst.mock.calls[0][0].where).toMatchObject({
      tenantId: "t-1",
      id: { not: "emp-1" },
      email: { equals: "GURU01@example.test", mode: "insensitive" },
    });
  });

  it("allows a free email", async () => {
    db.employee.findFirst.mockResolvedValue(null);
    const res = await PUT(req("PUT", { email: "new@sekolah.test" }), params);
    expect(res.status).toBe(200);
  });

  it("does not run the duplicate check when the email is unchanged (case-insensitive)", async () => {
    const res = await PUT(req("PUT", { email: "OLD@sekolah.test", nama: "X" }), params);
    expect(res.status).toBe(200);
    expect(db.employee.findFirst).not.toHaveBeenCalled();
  });
});
