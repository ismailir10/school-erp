import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, saveFile, mergeJsonKey } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  saveFile: vi.fn(),
  mergeJsonKey: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { enrollmentApplication: { findUnique } } }));
vi.mock("@/lib/storage", () => ({ saveFile }));
vi.mock("@/lib/enrollment/json-merge", () => ({ mergeJsonKey }));

import { GET, POST } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const ctx = { params: Promise.resolve({ token: "tok" }) };
const future = new Date(Date.now() + 86_400_000);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const STORAGE_TOKEN = "supabase:v1:enrollment/a/ayah-signature-0123456789abcdef.png";

// Browsers always send Content-Length for FormData; NextRequest in tests does not, so set it.
function postReq(which: string | null, bytes: Buffer = PNG, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "sig.png", { type: "image/png" }));
  const qs = which ? `?which=${which}` : "";
  return new NextRequest(`http://localhost/api/enrollments/token/tok/signature${qs}`, {
    method: "POST",
    body: form,
    headers: { "content-length": "500", ...headers },
  });
}
const getReq = () => new NextRequest("http://localhost/api/enrollments/token/tok/signature");

/** resolveEnrollmentAccess looks up by accessToken; the GET status read looks up by id. */
function mockRow(
  access: { status: string; tokenExpiresAt: Date | null } | null,
  consentData: unknown = null,
) {
  findUnique.mockImplementation(async (arg: { where: { accessToken?: string; id?: string } }) => {
    if (arg.where.accessToken) {
      return access ? { id: "a", tenantId: "t-1", ...access } : null;
    }
    return { consentData };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  saveFile.mockResolvedValue({ token: STORAGE_TOKEN });
  mergeJsonKey.mockResolvedValue(true);
  mockRow({ status: "INVITED", tokenExpiresAt: future });
});

describe("POST /api/enrollments/token/[token]/signature", () => {
  it("persists the token onto the row atomically and returns only { saved: true }", async () => {
    const res = await POST(postReq("ayah"), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ saved: true });
    expect(JSON.stringify(json)).not.toContain("supabase");
    expect(saveFile.mock.calls[0][0]).toMatchObject({
      entity: "enrollment",
      entityId: "a",
      field: "ayah-signature",
    });
    expect(mergeJsonKey).toHaveBeenCalledWith(
      "a",
      "consentData",
      "ayah",
      { signatureToken: STORAGE_TOKEN },
      { requireInvited: true },
    );
  });

  it("writes ibu under its own key", async () => {
    await POST(postReq("ibu"), ctx);
    expect(mergeJsonKey.mock.calls[0].slice(1, 3)).toEqual(["consentData", "ibu"]);
  });

  it("409 ALREADY_SUBMITTED when the INVITED-guarded write matches no row", async () => {
    mergeJsonKey.mockResolvedValue(false);
    const res = await POST(postReq("ayah"), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_SUBMITTED");
  });

  it("409 up front when the application is already submitted (nothing stored)", async () => {
    mockRow({ status: "SUBMITTED", tokenExpiresAt: future });
    const res = await POST(postReq("ayah"), ctx);
    expect(res.status).toBe(409);
    expect(saveFile).not.toHaveBeenCalled();
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("400 for a bad `which`, 404 unknown token, 410 expired", async () => {
    expect((await POST(postReq("kakek"), ctx)).status).toBe(400);
    mockRow(null);
    expect((await POST(postReq("ayah"), ctx)).status).toBe(404);
    mockRow({ status: "INVITED", tokenExpiresAt: new Date(Date.now() - 1000) });
    expect((await POST(postReq("ayah"), ctx)).status).toBe(410);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("411 LENGTH_REQUIRED for a non-numeric Content-Length, before reading the body", async () => {
    const res = await POST(postReq("ayah", PNG, { "content-length": "abc" }), ctx);
    expect(res.status).toBe(411);
    expect(await res.json()).toEqual({ error: "LENGTH_REQUIRED" });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("a missing Content-Length is tolerated (HTTP/2 may drop it) — the file.size cap still applies", async () => {
    const noHeader = new NextRequest("http://localhost/api/enrollments/token/tok/signature?which=ayah", {
      method: "POST",
      body: (() => {
        const f = new FormData();
        f.set("file", new File([new Uint8Array(PNG)], "sig.png", { type: "image/png" }));
        return f;
      })(),
    });
    const res = await POST(noHeader, ctx);
    expect(res.status).not.toBe(411);
    expect(saveFile).toHaveBeenCalled();
  });

  it("413 on a declared Content-Length above the cap", async () => {
    const res = await POST(postReq("ayah", PNG, { "content-length": String(5 * 1024 * 1024) }), ctx);
    expect(res.status).toBe(413);
  });

  it("415 for non-image bytes", async () => {
    const res = await POST(postReq("ayah", Buffer.from("%PDF-1.4 not a signature")), ctx);
    expect(res.status).toBe(415);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });
});

describe("GET /api/enrollments/token/[token]/signature", () => {
  it("reports which signatures are saved, booleans only", async () => {
    mockRow(
      { status: "INVITED", tokenExpiresAt: future },
      { ayah: { name: "A", signatureToken: STORAGE_TOKEN }, ibu: { name: "B", signatureToken: "" } },
    );
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ayah: true, ibu: false, ayahName: "A", ibuName: "B" });
    expect(JSON.stringify(json)).not.toContain("supabase");
    // selects consentData only
    const readCall = findUnique.mock.calls.find((c) => c[0].where.id)!;
    expect(readCall[0].select).toEqual({ consentData: true });
  });

  it("is false/false with empty names for a fresh row and for malformed JSON", async () => {
    const empty = { ayah: false, ibu: false, ayahName: "", ibuName: "" };
    mockRow({ status: "INVITED", tokenExpiresAt: future }, null);
    expect(await (await GET(getReq(), ctx)).json()).toEqual(empty);
    mockRow({ status: "INVITED", tokenExpiresAt: future }, { ayah: "x", ibu: { signatureToken: 5, name: 7 } });
    expect(await (await GET(getReq(), ctx)).json()).toEqual(empty);
  });

  it("returns a saved name even when that parent has not signed yet", async () => {
    mockRow({ status: "INVITED", tokenExpiresAt: future }, { ayah: { name: "Bapak Ahmad" } });
    expect(await (await GET(getReq(), ctx)).json()).toEqual({
      ayah: false,
      ibu: false,
      ayahName: "Bapak Ahmad",
      ibuName: "",
    });
  });

  it("404 / 410 / 409 like its siblings", async () => {
    mockRow(null);
    expect((await GET(getReq(), ctx)).status).toBe(404);
    mockRow({ status: "INVITED", tokenExpiresAt: new Date(Date.now() - 1000) });
    expect((await GET(getReq(), ctx)).status).toBe(410);
    mockRow({ status: "SUBMITTED", tokenExpiresAt: future });
    expect((await GET(getReq(), ctx)).status).toBe(409);
  });

  it("rate-limits on its own bucket (does not drain the upload bucket)", async () => {
    for (let i = 0; i < 20; i++) expect((await GET(getReq(), ctx)).status).toBe(200);
    expect((await GET(getReq(), ctx)).status).toBe(429);
    expect((await POST(postReq("ayah"), ctx)).status).toBe(200);
  });
});
