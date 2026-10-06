import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, update, orgConfigUpsert, getSession, isAdminRole } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  orgConfigUpsert: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
}));

// OrgConfig is wired in only so a regression that touches it is caught: the
// setting lives on Tenant and must never create an OrgConfig row.
vi.mock("@/lib/db", () => ({
  prisma: { tenant: { findUnique, update }, orgConfig: { upsert: orgConfigUpsert, findUnique: orgConfigUpsert } },
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
});

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
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requiredDocuments: [], canEdit: true });
    expect(findUnique.mock.calls[0][0].where).toEqual({ id: "t-1" });
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
    expect(await res.json()).toEqual({ requiredDocuments: ["kk"] });
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
    expect(await res.json()).toEqual({ requiredDocuments: ["akta", "kk", "surat_sehat"] });
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
    expect(await res.json()).toEqual({ requiredDocuments: [] });
  });
});
