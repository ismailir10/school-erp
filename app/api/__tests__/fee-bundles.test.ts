/**
 * Coverage for `GET/PUT /api/fee-bundles` — "Harga paket sekolah + daycare",
 * cycle docs/cycles/2026-10-29-school-daycare-bundle-price.md (T3).
 *
 * `$transaction` is a small fake: writes made through `tx` are staged and only
 * "committed" when the callback resolves, so the atomic test can assert that a
 * failing audit row discards the business write too. recordAudit is real (it
 * writes through `auditLog.create`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  academicYear: { findFirst: vi.fn() },
  program: { findMany: vi.fn() },
  feeComponentDef: { findMany: vi.fn() },
  programFeeStructure: { findMany: vi.fn() },
  programBundleFee: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
const { rateLimit } = vi.hoisted(() => ({
  rateLimit: vi.fn((..._args: unknown[]) => ({ success: true })),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit, getClientIp: () => "127.0.0.1" }));

import { getSession } from "@/lib/auth";
import * as routeModule from "../fee-bundles/route";
const { GET, PUT } = routeModule;

const ALL = ["fees.view", "fees.edit"];

function session(permissions: string[] = ALL, role = "SCHOOL_ADMIN") {
  return {
    id: "u-1",
    email: "admin@test.com",
    name: "Admin",
    role,
    tenantId: "tnt-1",
    employeeId: null,
    parentId: null,
    permissions,
    customRoleCode: null,
  };
}
const as = (permissions?: string[]) => vi.mocked(getSession).mockResolvedValue(session(permissions) as never);

const getReq = (query = "?academicYearId=ay-1") =>
  new Request(`http://localhost/api/fee-bundles${query}`) as never;
const putReq = (body: unknown) =>
  new Request("http://localhost/api/fee-bundles", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;

const SCHOOL = { id: "p-school", name: "TKIT-A", type: "SEMESTER" };
const DAYCARE = { id: "p-day", name: "D'Care", type: "YEAR_ROUND" };
const SPP = { id: "fc-spp", label: "SPP Bulanan", isEnabled: true, isRecurring: true, status: "ACTIVE" };

const change = (over: Record<string, unknown> = {}) => ({
  schoolProgramId: "p-school",
  daycareProgramId: "p-day",
  feeComponentId: "fc-spp",
  amount: 1_560_000,
  ...over,
});
const body = (changes: unknown[] = [change()]) => ({ academicYearId: "ay-1", changes });

const UNIQUE_KEY = {
  schoolProgramId_daycareProgramId_academicYearId_feeComponentId: {
    schoolProgramId: "p-school",
    daycareProgramId: "p-day",
    academicYearId: "ay-1",
    feeComponentId: "fc-spp",
  },
};

/** Writes made through `tx` that the fake transaction actually committed. */
let committed: string[];

beforeEach(() => {
  vi.resetAllMocks();
  rateLimit.mockReturnValue({ success: true });
  committed = [];
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(db));
  db.$executeRaw.mockResolvedValue(1);
  db.auditLog.create.mockResolvedValue({});
  db.academicYear.findFirst.mockResolvedValue({ id: "ay-1" });
  db.program.findMany.mockResolvedValue([SCHOOL, DAYCARE]);
  db.feeComponentDef.findMany.mockResolvedValue([SPP]);
  db.programFeeStructure.findMany.mockResolvedValue([
    { programId: "p-school", feeComponentId: "fc-spp" },
    { programId: "p-day", feeComponentId: "fc-spp" },
  ]);
  db.programBundleFee.findUnique.mockResolvedValue(null);
  db.programBundleFee.create.mockResolvedValue({ id: "bf-1" });
  db.programBundleFee.update.mockResolvedValue({});
  as();
});

describe("module exports", () => {
  it("has no revalidate export (a cached GET would show a stale price)", () => {
    expect("revalidate" in routeModule).toBe(false);
  });
});

describe("GET /api/fee-bundles", () => {
  beforeEach(() => {
    db.program.findMany.mockResolvedValue([
      { id: "p-school", code: "TKIT-A", name: "TKIT-A", type: "SEMESTER", status: "ACTIVE" },
      { id: "p-day", code: "DCARE", name: "D'Care", type: "YEAR_ROUND", status: "ACTIVE" },
    ]);
    db.feeComponentDef.findMany.mockResolvedValue([{ id: "fc-spp", code: "spp", label: "SPP Bulanan" }]);
    db.programFeeStructure.findMany.mockResolvedValue([
      { programId: "p-school", feeComponentId: "fc-spp", amount: "499000" },
      { programId: "p-day", feeComponentId: "fc-spp", amount: "1061000" },
    ]);
    db.programBundleFee.findMany.mockResolvedValue([
      {
        id: "bf-1",
        schoolProgramId: "p-school",
        daycareProgramId: "p-day",
        feeComponentId: "fc-spp",
        amount: "1560000",
        status: "ACTIVE",
      },
      {
        id: "bf-2",
        schoolProgramId: "p-school",
        daycareProgramId: "p-day",
        feeComponentId: "fc-other",
        amount: "100000",
        status: "INACTIVE",
      },
    ]);
  });

  it("403 for a non-admin role and without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(session(ALL, "TEACHER") as never);
    expect((await GET(getReq())).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(getReq())).status).toBe(403);
    expect(db.programBundleFee.findMany).not.toHaveBeenCalled();
  });

  it("403 without fees.view", async () => {
    as(["fees.edit"]);
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", missing: "fees.view" });
    expect(db.programBundleFee.findMany).not.toHaveBeenCalled();
  });

  it("400 without academicYearId", async () => {
    expect((await GET(getReq(""))).status).toBe(400);
  });

  it("404 for another tenant's year (tenant-scoped lookup)", async () => {
    db.academicYear.findFirst.mockResolvedValue(null);
    const res = await GET(getReq("?academicYearId=ay-foreign"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Tahun ajaran tidak ditemukan" });
    expect(db.academicYear.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ay-foreign", tenantId: "tnt-1" } }),
    );
    expect(db.programBundleFee.findMany).not.toHaveBeenCalled();
  });

  it("returns programs, billable components, saved program fees and every bundle row as plain numbers", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      canEdit: true,
      programs: [
        { id: "p-school", code: "TKIT-A", name: "TKIT-A", type: "SEMESTER", status: "ACTIVE" },
        { id: "p-day", code: "DCARE", name: "D'Care", type: "YEAR_ROUND", status: "ACTIVE" },
      ],
      components: [{ id: "fc-spp", code: "spp", label: "SPP Bulanan" }],
      programFees: [
        { programId: "p-school", feeComponentId: "fc-spp", amount: 499000 },
        { programId: "p-day", feeComponentId: "fc-spp", amount: 1061000 },
      ],
      bundles: [
        {
          id: "bf-1",
          schoolProgramId: "p-school",
          daycareProgramId: "p-day",
          feeComponentId: "fc-spp",
          amount: 1560000,
          status: "ACTIVE",
        },
        {
          id: "bf-2",
          schoolProgramId: "p-school",
          daycareProgramId: "p-day",
          feeComponentId: "fc-other",
          amount: 100000,
          status: "INACTIVE",
        },
      ],
    });
  });

  it("scopes every query to the tenant and year, and only reads billable ACTIVE components", async () => {
    await GET(getReq());
    expect(db.program.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tnt-1" } }));
    expect(db.feeComponentDef.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tnt-1", status: "ACTIVE", isEnabled: true, isRecurring: true },
      }),
    );
    expect(db.programBundleFee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tnt-1", academicYearId: "ay-1" } }),
    );
    expect(db.programFeeStructure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tnt-1", academicYearId: "ay-1" }),
      }),
    );
  });

  it("canEdit is false for a viewer without fees.edit", async () => {
    as(["fees.view"]);
    const json = await (await GET(getReq())).json();
    expect(json.canEdit).toBe(false);
  });

  it("skips the fee query when the tenant has no programs or no billable components", async () => {
    db.feeComponentDef.findMany.mockResolvedValue([]);
    const json = await (await GET(getReq())).json();
    expect(json.programFees).toEqual([]);
    expect(db.programFeeStructure.findMany).not.toHaveBeenCalled();
  });
});

describe("PUT /api/fee-bundles — guards", () => {
  it("403 for a non-admin role and without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(session(ALL, "TEACHER") as never);
    expect((await PUT(putReq(body()))).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PUT(putReq(body()))).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("403 without fees.edit (fees.view alone cannot write)", async () => {
    as(["fees.view"]);
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", missing: "fees.edit" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("429 when rate limited, keyed per user", async () => {
    rateLimit.mockReturnValue({ success: false });
    expect((await PUT(putReq(body()))).status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("save-fee-bundles:u-1", 20, 60_000);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("400 on malformed JSON", async () => {
    const res = await PUT(putReq("not-json{{"));
    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("PUT /api/fee-bundles — validation", () => {
  async function expectInvalid(changes: unknown[], message?: string) {
    const res = await PUT(putReq(body(changes)));
    expect(res.status).toBe(400);
    const json = await res.json();
    if (message) expect(JSON.stringify(json)).toContain(message);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.programBundleFee.create).not.toHaveBeenCalled();
  }

  it.each([
    ["zero", 0],
    ["negative", -1],
  ])("400 for an amount of %s", async (_label, amount) => {
    await expectInvalid([change({ amount })], "Harga paket harus lebih dari 0");
  });

  it("400 for a fraction", async () => {
    await expectInvalid([change({ amount: 1_560_000.5 })], "rupiah bulat");
  });

  it("400 above the fee maximum", async () => {
    await expectInvalid([change({ amount: 10_000_000_001 })], "maksimal");
  });

  it("accepts exactly the fee maximum", async () => {
    const res = await PUT(putReq(body([change({ amount: 10_000_000_000 })])));
    expect(res.status).toBe(200);
  });

  it("400 for a non-numeric amount", async () => {
    await expectInvalid([change({ amount: "1500000" })]);
  });

  it("400 for the same (school, daycare, component) twice", async () => {
    await expectInvalid([change(), change({ amount: 1_000_000 })], "tidak boleh muncul dua kali");
  });

  it("400 for more than 200 changes", async () => {
    const many = Array.from({ length: 201 }, (_, i) => change({ feeComponentId: `fc-${i}` }));
    await expectInvalid(many);
  });

  it("400 for a missing academicYearId", async () => {
    const res = await PUT(putReq({ changes: [change()] }));
    expect(res.status).toBe(400);
  });

  it("an empty change list is a no-op", async () => {
    const res = await PUT(putReq(body([])));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: 0 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("PUT /api/fee-bundles — tenant isolation", () => {
  it("404 for another tenant's academic year", async () => {
    db.academicYear.findFirst.mockResolvedValue(null);
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Tahun ajaran tidak ditemukan" });
    expect(db.academicYear.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ay-1", tenantId: "tnt-1" } }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("404 when a program belongs to another tenant (school or daycare)", async () => {
    db.program.findMany.mockResolvedValue([SCHOOL]); // daycare not found in this tenant
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Program tidak ditemukan" });
    expect(db.program.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["p-school", "p-day"] }, tenantId: "tnt-1" } }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("404 when the fee component belongs to another tenant", async () => {
    db.feeComponentDef.findMany.mockResolvedValue([]);
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Komponen biaya tidak ditemukan" });
    expect(db.feeComponentDef.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["fc-spp"] }, tenantId: "tnt-1" } }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a foreign program is refused even when the change only clears", async () => {
    db.program.findMany.mockResolvedValue([SCHOOL]);
    const res = await PUT(putReq(body([change({ amount: null })])));
    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("PUT /api/fee-bundles — server rules when setting a price", () => {
  const wrongPair = "Pilih satu program sekolah dan satu program daycare";

  it("400 when the school program is not SEMESTER", async () => {
    db.program.findMany.mockResolvedValue([{ ...SCHOOL, type: "YEAR_ROUND" }, DAYCARE]);
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(wrongPair);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("400 when the daycare program is not YEAR_ROUND", async () => {
    db.program.findMany.mockResolvedValue([SCHOOL, { ...DAYCARE, type: "SESSION" }]);
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(wrongPair);
  });

  it("400 when the school and daycare program are the same program", async () => {
    db.program.findMany.mockResolvedValue([SCHOOL]);
    const res = await PUT(putReq(body([change({ daycareProgramId: "p-school" })])));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(wrongPair);
  });

  it("400 when the daycare and school roles are swapped", async () => {
    const res = await PUT(putReq(body([change({ schoolProgramId: "p-day", daycareProgramId: "p-school" })])));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(wrongPair);
  });

  it.each([
    ["disabled", { isEnabled: false }],
    ["one-time", { isRecurring: false }],
    ["inactive", { status: "INACTIVE" }],
  ])("400 when the component is %s", async (_label, over) => {
    db.feeComponentDef.findMany.mockResolvedValue([{ ...SPP, ...over }]);
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("SPP Bulanan");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("400 naming the program when the school program has no fee row for the component", async () => {
    db.programFeeStructure.findMany.mockResolvedValue([{ programId: "p-day", feeComponentId: "fc-spp" }]);
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("TKIT-A belum punya tarif SPP Bulanan");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("400 naming the program when the daycare program has no fee row for the component", async () => {
    db.programFeeStructure.findMany.mockResolvedValue([{ programId: "p-school", feeComponentId: "fc-spp" }]);
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("D'Care belum punya tarif SPP Bulanan");
  });

  it("reads the fee rows for this tenant, year, programs and components only", async () => {
    await PUT(putReq(body()));
    expect(db.programFeeStructure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tnt-1",
          academicYearId: "ay-1",
          programId: { in: ["p-school", "p-day"] },
          feeComponentId: { in: ["fc-spp"] },
        },
      }),
    );
  });

  it("clearing skips the type, component and fee-row rules (a stale price can always be taken away)", async () => {
    db.program.findMany.mockResolvedValue([{ ...SCHOOL, type: "YEAR_ROUND" }, DAYCARE]);
    db.feeComponentDef.findMany.mockResolvedValue([{ ...SPP, isEnabled: false }]);
    db.programFeeStructure.findMany.mockResolvedValue([]);
    db.programBundleFee.findUnique.mockResolvedValue({ id: "bf-1", amount: "1560000", status: "ACTIVE" });
    const res = await PUT(putReq(body([change({ amount: null })])));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: 1 });
    expect(db.programFeeStructure.findMany).not.toHaveBeenCalled();
  });
});

describe("PUT /api/fee-bundles — writes and audit", () => {
  it("creates a missing price, tenant-stamped, and audits create with the after-state", async () => {
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: 1 });
    expect(db.programBundleFee.findUnique).toHaveBeenCalledWith({ where: UNIQUE_KEY });
    expect(db.programBundleFee.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tnt-1",
        academicYearId: "ay-1",
        schoolProgramId: "p-school",
        daycareProgramId: "p-day",
        feeComponentId: "fc-spp",
        amount: 1_560_000,
        status: "ACTIVE",
      },
    });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = db.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({
      tenantId: "tnt-1",
      actorId: "u-1",
      entity: "ProgramBundleFee",
      entityId: "bf-1",
      action: "create",
      after: {
        schoolProgramId: "p-school",
        daycareProgramId: "p-day",
        feeComponentId: "fc-spp",
        academicYearId: "ay-1",
        amount: 1_560_000,
        status: "ACTIVE",
      },
    });
    expect(audit.before).toBeUndefined();
  });

  it("takes a per-year advisory lock before writing", async () => {
    await PUT(putReq(body()));
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("updates a changed amount and audits update with before and after", async () => {
    db.programBundleFee.findUnique.mockResolvedValue({ id: "bf-1", amount: "1500000", status: "ACTIVE" });
    const res = await PUT(putReq(body()));
    expect(await res.json()).toEqual({ ok: true, changed: 1 });
    expect(db.programBundleFee.update).toHaveBeenCalledWith({
      where: { id: "bf-1" },
      data: { amount: 1_560_000, status: "ACTIVE" },
    });
    expect(db.programBundleFee.create).not.toHaveBeenCalled();
    const audit = db.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({
      entity: "ProgramBundleFee",
      entityId: "bf-1",
      action: "update",
      before: { amount: 1_500_000, status: "ACTIVE" },
      after: { amount: 1_560_000, status: "ACTIVE" },
    });
  });

  it("reactivates an INACTIVE row (even at the same amount) with the same id", async () => {
    db.programBundleFee.findUnique.mockResolvedValue({ id: "bf-1", amount: "1560000", status: "INACTIVE" });
    const res = await PUT(putReq(body()));
    expect(await res.json()).toEqual({ ok: true, changed: 1 });
    expect(db.programBundleFee.create).not.toHaveBeenCalled();
    expect(db.programBundleFee.update).toHaveBeenCalledWith({
      where: { id: "bf-1" },
      data: { amount: 1_560_000, status: "ACTIVE" },
    });
    const audit = db.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({
      action: "update",
      before: { status: "INACTIVE" },
      after: { status: "ACTIVE", amount: 1_560_000 },
    });
  });

  it("an unchanged ACTIVE value writes nothing and audits nothing", async () => {
    db.programBundleFee.findUnique.mockResolvedValue({ id: "bf-1", amount: "1560000.00", status: "ACTIVE" });
    const res = await PUT(putReq(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, changed: 0 });
    expect(db.programBundleFee.create).not.toHaveBeenCalled();
    expect(db.programBundleFee.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("clearing deactivates the row (soft delete) and audits deactivate", async () => {
    db.programBundleFee.findUnique.mockResolvedValue({ id: "bf-1", amount: "1560000", status: "ACTIVE" });
    const res = await PUT(putReq(body([change({ amount: null })])));
    expect(await res.json()).toEqual({ ok: true, changed: 1 });
    expect(db.programBundleFee.update).toHaveBeenCalledWith({
      where: { id: "bf-1" },
      data: { status: "INACTIVE" },
    });
    const audit = db.auditLog.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({
      entity: "ProgramBundleFee",
      entityId: "bf-1",
      action: "deactivate",
      before: { amount: 1_560_000, status: "ACTIVE" },
      after: { amount: 1_560_000, status: "INACTIVE" },
    });
  });

  it("clearing a price that does not exist, or is already INACTIVE, is a no-op", async () => {
    db.programBundleFee.findUnique.mockResolvedValueOnce(null);
    expect(await (await PUT(putReq(body([change({ amount: null })])))).json()).toEqual({ ok: true, changed: 0 });

    db.programBundleFee.findUnique.mockResolvedValueOnce({ id: "bf-1", amount: "1560000", status: "INACTIVE" });
    expect(await (await PUT(putReq(body([change({ amount: null })])))).json()).toEqual({ ok: true, changed: 0 });

    expect(db.programBundleFee.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("counts only the cells that really changed in a mixed save", async () => {
    // fc-spp unchanged, fc-meal new, fc-trip cleared.
    db.feeComponentDef.findMany.mockResolvedValue([
      SPP,
      { ...SPP, id: "fc-meal", label: "Makan" },
      { ...SPP, id: "fc-trip", label: "Kegiatan" },
    ]);
    db.programFeeStructure.findMany.mockResolvedValue(
      ["fc-spp", "fc-meal"].flatMap((feeComponentId) => [
        { programId: "p-school", feeComponentId },
        { programId: "p-day", feeComponentId },
      ]),
    );
    db.programBundleFee.findUnique.mockImplementation(async ({ where }: never) => {
      const key = (where as Record<string, { feeComponentId: string }>)[
        "schoolProgramId_daycareProgramId_academicYearId_feeComponentId"
      ]!.feeComponentId;
      if (key === "fc-spp") return { id: "bf-spp", amount: "1560000", status: "ACTIVE" };
      if (key === "fc-trip") return { id: "bf-trip", amount: "50000", status: "ACTIVE" };
      return null;
    });
    const res = await PUT(
      putReq(
        body([
          change(),
          change({ feeComponentId: "fc-meal", amount: 200_000 }),
          change({ feeComponentId: "fc-trip", amount: null }),
        ]),
      ),
    );
    expect(await res.json()).toEqual({ ok: true, changed: 2 });
    expect(db.auditLog.create).toHaveBeenCalledTimes(2);
    expect(db.auditLog.create.mock.calls.map((c) => c[0].data.action)).toEqual(["create", "deactivate"]);
  });
});

describe("PUT /api/fee-bundles — atomicity", () => {
  it("a failing audit row aborts the save: 500 and the business write is not committed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The fake transaction commits staged writes only when the callback resolves.
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const staged: string[] = [];
      const tx = {
        ...db,
        programBundleFee: {
          ...db.programBundleFee,
          create: vi.fn(async (...args: unknown[]) => {
            staged.push("programBundleFee.create");
            return db.programBundleFee.create(...args);
          }),
        },
      };
      const result = await cb(tx);
      committed.push(...staged);
      return result;
    });
    db.auditLog.create.mockRejectedValue(new Error("audit down"));

    const res = await PUT(putReq(body()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Terjadi kesalahan server" });
    // The create ran inside the transaction, but never committed.
    expect(db.programBundleFee.create).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([]);
  });

  it("a successful save commits its writes", async () => {
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const staged: string[] = [];
      const tx = {
        ...db,
        programBundleFee: {
          ...db.programBundleFee,
          create: vi.fn(async (...args: unknown[]) => {
            staged.push("programBundleFee.create");
            return db.programBundleFee.create(...args);
          }),
        },
      };
      const result = await cb(tx);
      committed.push(...staged);
      return result;
    });
    expect((await PUT(putReq(body()))).status).toBe(200);
    expect(committed).toEqual(["programBundleFee.create"]);
  });

  it("the audit row is written through the same transaction handle", async () => {
    const txAudit = vi.fn(async () => ({}));
    db.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ ...db, auditLog: { create: txAudit } }),
    );
    expect((await PUT(putReq(body()))).status).toBe(200);
    expect(txAudit).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
