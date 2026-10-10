import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, update, orgConfigUpsert, getSession, isAdminRole, programFindMany, programUpdateMany, transaction } =
  vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
    orgConfigUpsert: vi.fn(),
    getSession: vi.fn(),
    isAdminRole: vi.fn(),
    programFindMany: vi.fn(),
    programUpdateMany: vi.fn(),
    transaction: vi.fn(),
  }));

// OrgConfig is wired in only so a regression that touches it is caught: the
// setting lives on Tenant and must never create an OrgConfig row.
vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findUnique, update },
    orgConfig: { upsert: orgConfigUpsert, findUnique: orgConfigUpsert },
    program: { findMany: programFindMany, updateMany: programUpdateMany },
    $transaction: transaction,
  },
}));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));

import { GET, PUT } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const put = (body: unknown) =>
  new NextRequest("http://localhost/api/config/enrollment", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  isAdminRole.mockReturnValue(true);
  update.mockImplementation(async (arg: { data: { enrollmentRequiredDocuments: string[] } }) => ({
    enrollmentRequiredDocuments: arg.data.enrollmentRequiredDocuments,
  }));
  // Ownership lookups carry `where.id`; the fee listing does not.
  programFindMany.mockImplementation(async (arg: { where: { id?: { in: string[] } } }) =>
    arg.where.id ? arg.where.id.in.filter((id) => PROGRAMS.some((p) => p.id === id)).map((id) => ({ id })) : PROGRAMS,
  );
  programUpdateMany.mockResolvedValue({ count: 1 });
  transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

const PROGRAMS = [
  { id: "p-kb", code: "KB", name: "Kelompok Bermain", enrollmentFee: "300000" },
  { id: "p-dc", code: "DCARE", name: "Day Care", enrollmentFee: "375000" },
];

describe("GET /api/config/enrollment", () => {
  it("401 without a session", async () => {
    getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("403 for a non-admin", async () => {
    isAdminRole.mockReturnValue(false);
    expect((await GET()).status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("403 for an admin without admissions.view", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["students.view"] });
    expect((await GET()).status).toBe(403);
  });

  it("returns [] when the tenant has nothing configured", async () => {
    findUnique.mockResolvedValue({ enrollmentRequiredDocuments: [] });
    programFindMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requiredDocuments: [], programs: [], canEdit: true });
    expect(findUnique.mock.calls[0][0].where).toEqual({ id: "t-1" });
  });

  it("lists the tenant's active programs with their fee as a number", async () => {
    findUnique.mockResolvedValue({ enrollmentRequiredDocuments: [] });
    const res = await GET();
    expect((await res.json()).programs).toEqual([
      { id: "p-kb", code: "KB", name: "Kelompok Bermain", enrollmentFee: 300_000 },
      { id: "p-dc", code: "DCARE", name: "Day Care", enrollmentFee: 375_000 },
    ]);
    expect(programFindMany.mock.calls[0][0].where).toEqual({ tenantId: "t-1", status: "ACTIVE" });
  });

  it("returns the stored keys, filtered, deduped and in form order", async () => {
    findUnique.mockResolvedValue({ enrollmentRequiredDocuments: ["kk", "bogus", "akta", "kk"] });
    expect((await (await GET()).json()).requiredDocuments).toEqual(["akta", "kk"]);
  });

  it("a read-only admissions admin can read but canEdit is false", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    findUnique.mockResolvedValue({ enrollmentRequiredDocuments: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).canEdit).toBe(false);
  });

  it("canEdit is true with admissions.edit", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] });
    findUnique.mockResolvedValue({ enrollmentRequiredDocuments: [] });
    expect((await (await GET()).json()).canEdit).toBe(true);
  });
});

describe("PUT /api/config/enrollment", () => {
  it("403 for an admin with only admissions.view", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await PUT(put({ requiredDocuments: ["kk"] }))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("403 for a non-admin", async () => {
    isAdminRole.mockReturnValue(false);
    expect((await PUT(put({ requiredDocuments: [] }))).status).toBe(403);
  });

  it("400 in the standard validateBody shape for an unknown document key, on field requiredDocuments", async () => {
    const res = await PUT(put({ requiredDocuments: ["kk", "paspor"] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Validasi gagal",
      errors: [{ field: "requiredDocuments", message: "Jenis berkas tidak dikenal" }],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("400 for a non-string entry, reported on the array field", async () => {
    const res = await PUT(put({ requiredDocuments: ["kk", 3] }));
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "requiredDocuments", message: "Jenis berkas tidak dikenal" }]);
  });

  it("400 for a long list padded with an unknown key", async () => {
    const res = await PUT(put({ requiredDocuments: [...Array(11).fill("kk"), "akta", "x"] }));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("duplicates are collapsed before the length cap, so many repeats are fine", async () => {
    const res = await PUT(put({ requiredDocuments: Array(20).fill("kk") }));
    expect(res.status).toBe(200);
    expect((await res.json()).requiredDocuments).toEqual(["kk"]);
  });

  it("400 for a non-array body field and for invalid JSON", async () => {
    const notArray = await PUT(put({ requiredDocuments: "kk" }));
    expect(notArray.status).toBe(400);
    expect((await notArray.json()).error).toBe("Validasi gagal");
    expect((await PUT(put({}))).status).toBe(400);
    expect((await PUT(put("{not json"))).status).toBe(400);
  });

  it("dedupes, orders by form order and updates the session's tenant only", async () => {
    const res = await PUT(put({ requiredDocuments: ["surat_sehat", "kk", "akta", "kk"], tenantId: "evil" }));
    expect(res.status).toBe(200);
    expect((await res.json()).requiredDocuments).toEqual(["akta", "kk", "surat_sehat"]);
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "t-1" });
    expect(arg.data).toEqual({ enrollmentRequiredDocuments: ["akta", "kk", "surat_sehat"] });
  });

  it("never creates or touches an OrgConfig row", async () => {
    await PUT(put({ requiredDocuments: ["kk"] }));
    expect(orgConfigUpsert).not.toHaveBeenCalled();
  });

  it("accepts an empty list (every upload optional again)", async () => {
    const res = await PUT(put({ requiredDocuments: [] }));
    expect(res.status).toBe(200);
    expect((await res.json()).requiredDocuments).toEqual([]);
  });

  it("a documents-only body leaves every program fee untouched", async () => {
    const res = await PUT(put({ requiredDocuments: ["kk"] }));
    expect(res.status).toBe(200);
    expect(programUpdateMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("PUT /api/config/enrollment — programFees", () => {
  const withFees = (programFees: unknown) => put({ requiredDocuments: ["kk"], programFees });

  it("saves each program's fee with the documents in one transaction, scoped to the session tenant", async () => {
    const res = await PUT(
      withFees([
        { programId: "p-kb", fee: 300_000 },
        { programId: "p-dc", fee: 375_000 },
      ]),
    );
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(programUpdateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "p-kb", tenantId: "t-1" }, data: { enrollmentFee: 300_000 } },
      { where: { id: "p-dc", tenantId: "t-1" }, data: { enrollmentFee: 375_000 } },
    ]);
    const body = await res.json();
    expect(body.requiredDocuments).toEqual(["kk"]);
    expect(body.programs).toHaveLength(2);
  });

  it("checks ownership against ACTIVE programs of the session tenant", async () => {
    await PUT(withFees([{ programId: "p-kb", fee: 1 }]));
    expect(programFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["p-kb"] }, tenantId: "t-1", status: "ACTIVE" });
  });

  it("422 and nothing written when a program id is not this tenant's", async () => {
    const res = await PUT(withFees([{ programId: "p-kb", fee: 1 }, { programId: "other-tenant", fee: 1 }]));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Daftar program berubah. Muat ulang halaman lalu coba lagi." });
    expect(update).not.toHaveBeenCalled();
    expect(programUpdateMany).not.toHaveBeenCalled();
  });

  it("an empty programFees list is accepted and writes no fee", async () => {
    const res = await PUT(withFees([]));
    expect(res.status).toBe(200);
    expect(programUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["negative", [{ programId: "p-kb", fee: -1 }], "Biaya pendaftaran tidak boleh negatif"],
    ["fractional", [{ programId: "p-kb", fee: 100.5 }], "Biaya pendaftaran harus berupa angka bulat"],
    ["too large", [{ programId: "p-kb", fee: 100_000_001 }], "Biaya pendaftaran terlalu besar"],
    ["a string", [{ programId: "p-kb", fee: "300000" }], "Biaya pendaftaran harus berupa angka"],
    ["a duplicate program", [{ programId: "p-kb", fee: 1 }, { programId: "p-kb", fee: 2 }], "Program tidak boleh dobel"],
  ])("400 for %s fee input, and nothing is written", async (_name, programFees, message) => {
    const res = await PUT(withFees(programFees));
    expect(res.status).toBe(400);
    expect(JSON.stringify((await res.json()).errors)).toContain(message);
    expect(update).not.toHaveBeenCalled();
    expect(programUpdateMany).not.toHaveBeenCalled();
  });

  it("403 without admissions.edit, before any fee is read or written", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await PUT(withFees([{ programId: "p-kb", fee: 1 }]))).status).toBe(403);
    expect(programFindMany).not.toHaveBeenCalled();
    expect(programUpdateMany).not.toHaveBeenCalled();
  });
});
