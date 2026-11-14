/**
 * Data-integrity cycle 2026-09-29: predictable bad input must answer 4xx with
 * an Indonesian field error (the `validateBody` envelope), never a bare 500.
 *  CORE-5 duplicate academic-year name · FIN-3 duplicate fee component code ·
 *  FIN-4 fee component code format · FIN-5 oversized tarif.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const db = vi.hoisted(() => ({
  academicYear: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  feeComponentDef: { create: vi.fn(), count: vi.fn() },
  salaryComponentDef: { create: vi.fn() },
  program: { findFirst: vi.fn() },
  programFeeStructure: { upsert: vi.fn() },
  $transaction: vi.fn(),
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
import { POST as yearPost } from "../academic-years/route";
import { PUT as yearPut } from "../academic-years/[id]/route";
import { POST as feeComponentPost } from "../fee-components/route";
import { PUT as feeStructurePut } from "../fee-structure/route";

const ADMIN: SessionUser = {
  id: "u1",
  email: "a@t.local",
  name: "Admin",
  role: "SCHOOL_ADMIN",
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: ["academic.edit", "fees.edit"],
  customRoleCode: null,
};

const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN);
  db.$transaction.mockImplementation(async (fn) => fn(db));
});

describe("POST /api/academic-years (CORE-5)", () => {
  const body = { name: "2025/2026", startDate: "2025-07-01", endDate: "2026-06-30" };

  it("409 with a name field error on a duplicate name", async () => {
    db.academicYear.create.mockRejectedValue(p2002());
    const res = await yearPost(req("POST", body));
    expect(res.status).toBe(409);
    expect((await res.json()).errors).toEqual([
      { field: "name", message: "Nama tahun ajaran sudah dipakai" },
    ]);
  });

  it("409 also when created ACTIVE (transaction path)", async () => {
    db.academicYear.updateMany.mockResolvedValue({ count: 0 });
    db.academicYear.create.mockRejectedValue(p2002());
    const res = await yearPost(req("POST", { ...body, status: "ACTIVE" }));
    expect(res.status).toBe(409);
  });

  it("still rethrows unknown database errors (no silent swallow)", async () => {
    db.academicYear.create.mockRejectedValue(new Error("boom"));
    await expect(yearPost(req("POST", body))).rejects.toThrow("boom");
  });

  it("201 on success; 400 uses the field-error envelope", async () => {
    db.academicYear.create.mockResolvedValue({ id: "y1", ...body });
    expect((await yearPost(req("POST", body))).status).toBe(201);
    const bad = await yearPost(req("POST", { ...body, name: "" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).errors[0].field).toBe("name");
  });
});

describe("PUT /api/academic-years/[id] (CORE-5)", () => {
  it("409 with a name field error when renaming onto an existing name", async () => {
    db.academicYear.findFirst.mockResolvedValue({ id: "y1", tenantId: "t-1" });
    db.academicYear.update.mockRejectedValue(p2002());
    const res = await yearPut(req("PUT", { name: "2025/2026" }), { params: Promise.resolve({ id: "y1" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).errors[0].field).toBe("name");
  });
});

describe("POST /api/fee-components (FIN-3 / FIN-4)", () => {
  it("409 with a code field error on a duplicate code", async () => {
    db.feeComponentDef.create.mockRejectedValue(p2002());
    const res = await feeComponentPost(req("POST", { code: "spp", label: "SPP" }));
    expect(res.status).toBe(409);
    expect((await res.json()).errors).toEqual([
      { field: "code", message: "Kode komponen sudah dipakai" },
    ]);
  });

  it("400 with a code field error for spaces/punctuation, and nothing is written", async () => {
    const res = await feeComponentPost(req("POST", { code: "E2E FIN BAD!!", label: "X" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors[0].field).toBe("code");
    expect(json.errors[0].message).toMatch(/tanpa spasi/);
    expect(db.feeComponentDef.create).not.toHaveBeenCalled();
  });

  it("201 and stores the lowercased code", async () => {
    db.feeComponentDef.create.mockImplementation(async ({ data }) => ({ id: "fc1", ...data }));
    const res = await feeComponentPost(req("POST", { code: "Daftar_Ulang", label: "Daftar Ulang" }));
    expect(res.status).toBe(201);
    expect(db.feeComponentDef.create.mock.calls[0][0].data.code).toBe("daftar_ulang");
  });
});

describe("PUT /api/fee-structure (FIN-5)", () => {
  it("400 with an Indonesian message instead of a DB overflow 500", async () => {
    const res = await feeStructurePut(
      req("PUT", {
        programId: "p1",
        academicYearId: "y1",
        fees: [{ feeComponentId: "fc1", amount: 99999999999999999 }],
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Nominal maksimal Rp 10.000.000.000");
    expect(json.errors[0].field).toBe("fees.0.amount");
    expect(db.programFeeStructure.upsert).not.toHaveBeenCalled();
  });
});

// HR-10 — salary component code. Separate mock scope: this file mocks the DB
// once at the top, so the salary route only needs the permission guard here.
describe("POST /api/salary-components (HR-10)", () => {
  it("400 with a code field error for spaces/punctuation, nothing written", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth-guards", () => ({
      requirePermission: vi.fn().mockResolvedValue({ session: { tenantId: "t-1", id: "u1", role: "SCHOOL_ADMIN" } }),
    }));
    vi.doMock("@/lib/payroll/salary-component-ordering", () => ({
      checkSalaryComponentOrdering: vi.fn().mockResolvedValue(null),
    }));
    const { POST } = await import("../salary-components/route");
    const res = await POST(
      req("POST", { code: "E2E HR Bonus!", label: "Bonus", category: "INCOME", calcType: "FIXED" }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors[0].field).toBe("code");
    expect(json.errors[0].message).toMatch(/tanpa spasi/);
    vi.doUnmock("@/lib/auth-guards");
    vi.doUnmock("@/lib/payroll/salary-component-ordering");
  });
});
