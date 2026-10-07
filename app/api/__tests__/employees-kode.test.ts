/**
 * STR-4 (2026-10-07 stress run): POST /api/employees code generation.
 *  - the next number is the numeric max across ALL codes in the tenant, not
 *    the number of the lexicographically highest code;
 *  - a kode P2002 retries with a recomputed code (up to 3 attempts) instead of
 *    surfacing a raw 500; exhausted retries are a 409.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const db = vi.hoisted(() => ({
  employee: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  user: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
import { POST } from "../employees/route";

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

const base = { email: "x@sekolah.test", jabatan: "Guru", campusId: "c1", hireDate: "2026-09-01" };

function req(body: unknown) {
  return new Request("http://localhost/api/employees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function kodePrismaError() {
  return Object.assign(new Error("Unique constraint failed on the fields: (`tenantId`,`kode`)"), {
    code: "P2002",
    meta: { target: ["tenantId", "kode"] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN);
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.$executeRaw.mockResolvedValue(1);
  db.campus.findFirst.mockResolvedValue({ id: "c1" });
  db.employee.findFirst.mockResolvedValue(null);
  db.employee.findMany.mockResolvedValue([]);
  db.employee.create.mockImplementation(async ({ data }: { data: { kode: string } }) => ({ id: "emp-new", kode: data.kode }));
  db.user.findFirst.mockResolvedValue(null);
  db.user.create.mockResolvedValue({ id: "user-new" });
});

describe("POST /api/employees — kode generation (STR-4)", () => {
  it("RE29 then RD30 then 'Rani Dewi' gets RD31 (numeric global max, not lexicographic)", async () => {
    db.employee.findMany.mockResolvedValue([{ kode: "RE29" }, { kode: "RD30" }, { kode: "BS5" }]);
    const res = await POST(req({ ...base, nama: "Rani Dewi" }));
    expect(res.status).toBe(201);
    expect(db.employee.create.mock.calls[0][0].data.kode).toBe("RD31");
    // Reads every code in the tenant (no orderBy-by-string shortcut).
    expect(db.employee.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: "t-1" }, select: { kode: true } });
  });

  it("99 -> 100 and an emoji first character yields clean letter initials", async () => {
    db.employee.findMany.mockResolvedValue([{ kode: "ZZ99" }, { kode: "AA7" }]);
    const res = await POST(req({ ...base, nama: "😀 Emoji Guru" }));
    expect(res.status).toBe(201);
    const kode = db.employee.create.mock.calls[0][0].data.kode as string;
    expect(kode).toBe("EG100");
    expect(kode).not.toMatch(/[\uD800-\uDFFF]/);
  });

  it("retries on a kode P2002 with a recomputed code and succeeds", async () => {
    db.employee.findMany
      .mockResolvedValueOnce([{ kode: "AA7" }])
      .mockResolvedValueOnce([{ kode: "AA7" }, { kode: "BB8" }]); // the racer's row is now visible
    db.employee.create
      .mockRejectedValueOnce(kodePrismaError())
      .mockImplementationOnce(async ({ data }: { data: { kode: string } }) => ({ id: "emp-new", kode: data.kode }));

    const res = await POST(req({ ...base, nama: "Cici Dewi" }));
    expect(res.status).toBe(201);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.employee.create.mock.calls[0][0].data.kode).toBe("CD8");
    expect(db.employee.create.mock.calls[1][0].data.kode).toBe("CD9");
  });

  it("409 with an Indonesian message after 3 failed attempts — never a raw 500", async () => {
    db.employee.create.mockRejectedValue(kodePrismaError());
    const res = await POST(req({ ...base, nama: "Cici Dewi" }));
    expect(res.status).toBe(409);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    const json = await res.json();
    expect(json.error).toMatch(/Kode karyawan/);
  });

  it("maps a non-kode unique violation to a 409 email field error", async () => {
    db.employee.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), { code: "P2002", meta: { target: ["email"] } }),
    );
    const res = await POST(req({ ...base, nama: "Cici Dewi" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.errors?.[0]?.field).toBe("email");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("rethrows unknown errors (not a known conflict)", async () => {
    db.employee.create.mockRejectedValueOnce(new Error("db down"));
    await expect(POST(req({ ...base, nama: "Cici Dewi" }))).rejects.toThrow("db down");
  });

  it("400 for an unparseable body", async () => {
    const bad = new Request("http://localhost/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{nope",
    }) as never;
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });
});
