import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MAX_DOCUMENT_BYTES } from "@/lib/enrollment/documents";

const { findUnique, saveFile, deleteFile, mergeJsonKey, removeJsonFields } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  mergeJsonKey: vi.fn(),
  removeJsonFields: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { enrollmentApplication: { findUnique } } }));
vi.mock("@/lib/storage", () => ({ saveFile, deleteFile }));
vi.mock("@/lib/enrollment/json-merge", () => ({ mergeJsonKey, removeJsonFields }));

import { POST, DELETE } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const ctx = { params: Promise.resolve({ token: "tok" }) };
const future = new Date(Date.now() + 86_400_000);
const NEW_TOKEN = "supabase:v1:enrollment/a/doc-akta-0123456789abcdef.pdf";
const OLD_TOKEN = "supabase:v1:enrollment/a/doc-akta-fedcba9876543210.jpg";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function postReq(
  key: string | null,
  opts: { bytes?: Buffer; name?: string; type?: string; label?: string; headers?: Record<string, string> } = {},
) {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(opts.bytes ?? PDF)], opts.name ?? "akta.pdf", { type: opts.type ?? "application/pdf" }),
  );
  if (opts.label !== undefined) form.set("label", opts.label);
  const qs = key === null ? "" : `?key=${key}`;
  return new NextRequest(`http://localhost/api/enrollments/token/tok/documents${qs}`, {
    method: "POST",
    body: form,
    // Browsers always send Content-Length for FormData; NextRequest in tests does not, so set it.
    headers: { "content-length": "1000", ...opts.headers },
  });
}
const delReq = (key: string | null) =>
  new NextRequest(`http://localhost/api/enrollments/token/tok/documents${key === null ? "" : `?key=${key}`}`, {
    method: "DELETE",
  });

/**
 * resolve → by accessToken; documents reads → by id. `documents` may be a
 * sequence: the n-th read (the one before the write, then the one after) gets
 * the n-th value, the last repeating.
 */
function mockRow(
  access: { status: string; tokenExpiresAt: Date | null } | null,
  documents: unknown = null,
  afterWrite?: unknown,
) {
  let reads = 0;
  findUnique.mockImplementation(async (arg: { where: { accessToken?: string } }) => {
    if (arg.where.accessToken) return access ? { id: "a", tenantId: "t-1", ...access } : null;
    reads += 1;
    return { documents: reads > 1 && afterWrite !== undefined ? afterWrite : documents };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  saveFile.mockResolvedValue({ token: NEW_TOKEN });
  deleteFile.mockResolvedValue(undefined);
  mergeJsonKey.mockResolvedValue(true);
  removeJsonFields.mockResolvedValue(true);
  mockRow({ status: "INVITED", tokenExpiresAt: future });
});

describe("POST /api/enrollments/token/[token]/documents", () => {
  it("stores the file, merges metadata atomically, and never returns the storage token", async () => {
    const res = await POST(postReq("akta"), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ key: "akta", fileName: "akta.pdf", mimeType: "application/pdf", size: PDF.length });
    expect(typeof json.uploadedAt).toBe("string");
    expect(JSON.stringify(json)).not.toContain("supabase");
    expect("label" in json).toBe(false);

    expect(saveFile.mock.calls[0][0]).toMatchObject({
      entity: "enrollment",
      entityId: "a",
      field: expect.stringMatching(/^doc-akta-[a-zA-Z0-9]{10}$/),
      file: { mimeType: "application/pdf", ext: "pdf" },
    });
    expect(mergeJsonKey).toHaveBeenCalledTimes(1);
    const [id, col, key, patch, opts] = mergeJsonKey.mock.calls[0];
    expect([id, col, key, opts]).toEqual(["a", "documents", "akta", { requireInvited: true }]);
    expect(patch).toMatchObject({
      fileToken: NEW_TOKEN,
      fileName: "akta.pdf",
      mimeType: "application/pdf",
      size: PDF.length,
    });
    expect(typeof patch.uploadedAt).toBe("string");
    expect(deleteFile).not.toHaveBeenCalled(); // nothing to replace
  });

  it("magic bytes decide the type, not the claimed Content-Type", async () => {
    const res = await POST(postReq("kk", { bytes: JPEG, name: "kk.pdf", type: "application/pdf" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).mimeType).toBe("image/jpeg");
    expect(saveFile.mock.calls[0][0].file).toMatchObject({ mimeType: "image/jpeg", ext: "jpg" });
  });

  it("400 for an unknown or missing key, and for prototype-ish keys", async () => {
    for (const k of ["passport", "KK", "__proto__", "toString", null]) {
      const res = await POST(postReq(k), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Jenis berkas tidak dikenal");
    }
    expect(saveFile).not.toHaveBeenCalled();
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("413 when the file exceeds 4 MB", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    const res = await POST(postReq("akta", { bytes: big }), ctx);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "PAYLOAD_TOO_LARGE", maxBytes: MAX_DOCUMENT_BYTES });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("413 on a declared content-length far above the cap, before reading the body", async () => {
    const res = await POST(postReq("akta", { headers: { "content-length": String(50 * 1024 * 1024) } }), ctx);
    expect(res.status).toBe(413);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly the cap", async () => {
    const exact = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES - PDF.length)]);
    expect(exact.length).toBe(MAX_DOCUMENT_BYTES);
    const res = await POST(postReq("akta", { bytes: exact }), ctx);
    expect(res.status).toBe(200);
  });

  it("415 for bytes that are not JPEG/PNG/PDF even when the claimed type is an image", async () => {
    const res = await POST(
      postReq("akta", { bytes: Buffer.from("MZ\x90\x00 this is an exe"), name: "x.jpg", type: "image/jpeg" }),
      ctx,
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(saveFile).not.toHaveBeenCalled();
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("400 for an empty file or a missing file field", async () => {
    expect((await POST(postReq("akta", { bytes: Buffer.alloc(0) }), ctx)).status).toBe(400);
    const form = new FormData();
    form.set("note", "no file");
    const res = await POST(
      new NextRequest("http://localhost/api/enrollments/token/tok/documents?key=akta", {
        method: "POST",
        body: form,
        headers: { "content-length": "100" },
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("sanitizes the display file name (basename, control chars, 120 chars, fallback)", async () => {
    await POST(postReq("akta", { name: "..\\..\\evil/path\\KTP\u0007 Ayah.pdf" }), ctx);
    expect(mergeJsonKey.mock.calls[0][3].fileName).toBe("KTP Ayah.pdf");

    mergeJsonKey.mockClear();
    await POST(postReq("akta", { name: `${"a".repeat(300)}.pdf` }), ctx);
    const long = mergeJsonKey.mock.calls[0][3].fileName as string;
    expect(long.length).toBe(120);
    expect(long.endsWith(".pdf")).toBe(true);

    mergeJsonKey.mockClear();
    await POST(postReq("akta", { name: ".." }), ctx);
    expect(mergeJsonKey.mock.calls[0][3].fileName).toBe("akta.pdf");
  });

  it("stores a trimmed, capped label for lainnya only", async () => {
    const res = await POST(postReq("lainnya", { label: `  Ijazah TK ${"x".repeat(200)} ` }), ctx);
    const json = await res.json();
    expect(json.label.length).toBe(80);
    expect(json.label.startsWith("Ijazah TK x")).toBe(true);
    expect(mergeJsonKey.mock.calls[0][3].label).toBe(json.label);

    mergeJsonKey.mockClear();
    const other = await POST(postReq("kk", { label: "sneaky" }), ctx);
    expect("label" in (await other.json())).toBe(false);
    expect("label" in mergeJsonKey.mock.calls[0][3]).toBe(false);
  });

  it("409 ALREADY_SUBMITTED when the INVITED-guarded write matches no row; drops the NEW object, keeps the old one", async () => {
    mockRow({ status: "INVITED", tokenExpiresAt: future }, { akta: { fileToken: OLD_TOKEN } });
    mergeJsonKey.mockResolvedValue(false);
    const res = await POST(postReq("akta"), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_SUBMITTED");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(NEW_TOKEN);
  });

  it("a failing cleanup of the new object on the 409 path does not change the response", async () => {
    mergeJsonKey.mockResolvedValue(false);
    deleteFile.mockRejectedValue(new Error("storage down"));
    expect((await POST(postReq("akta"), ctx)).status).toBe(409);
  });

  it("every upload gets its own unique storage field (a deleted token can never be re-referenced)", async () => {
    await POST(postReq("akta"), ctx);
    await POST(postReq("akta"), ctx);
    const [a, b] = saveFile.mock.calls.map((c) => c[0].field as string);
    expect(a).toMatch(/^doc-akta-[a-zA-Z0-9]{10}$/);
    expect(b).toMatch(/^doc-akta-[a-zA-Z0-9]{10}$/);
    expect(a).not.toBe(b);
  });

  it("409 up front for a submitted application; 404 unknown token; 410 expired", async () => {
    mockRow({ status: "SUBMITTED", tokenExpiresAt: future });
    expect((await POST(postReq("akta"), ctx)).status).toBe(409);
    mockRow(null);
    expect((await POST(postReq("akta"), ctx)).status).toBe(404);
    mockRow({ status: "INVITED", tokenExpiresAt: new Date(Date.now() - 1000) });
    expect((await POST(postReq("akta"), ctx)).status).toBe(410);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("replacing a file deletes the previous object after the write (best-effort)", async () => {
    mockRow(
      { status: "INVITED", tokenExpiresAt: future },
      { akta: { fileToken: OLD_TOKEN, fileName: "old.jpg" } },
      { akta: { fileToken: NEW_TOKEN, fileName: "akta.pdf" } },
    );
    const res = await POST(postReq("akta"), ctx);
    expect(res.status).toBe(200);
    expect(deleteFile).toHaveBeenCalledWith(OLD_TOKEN);
    expect(mergeJsonKey.mock.invocationCallOrder[0]).toBeLessThan(deleteFile.mock.invocationCallOrder[0]);

    // a failing cleanup never fails the request
    deleteFile.mockRejectedValueOnce(new Error("storage down"));
    expect((await POST(postReq("akta"), ctx)).status).toBe(200);
  });

  it("keeps the previous object when the row still references it after the write (overlapping request race)", async () => {
    // another request re-pointed the row at OLD_TOKEN between our read and write
    mockRow(
      { status: "INVITED", tokenExpiresAt: future },
      { akta: { fileToken: OLD_TOKEN } },
      { akta: { fileToken: OLD_TOKEN } },
    );
    expect((await POST(postReq("akta"), ctx)).status).toBe(200);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("keeps the previous object when ANOTHER key references it after the write", async () => {
    mockRow(
      { status: "INVITED", tokenExpiresAt: future },
      { akta: { fileToken: OLD_TOKEN } },
      { akta: { fileToken: NEW_TOKEN }, kk: { fileToken: OLD_TOKEN } },
    );
    expect((await POST(postReq("akta"), ctx)).status).toBe(200);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("411 LENGTH_REQUIRED for a non-numeric Content-Length, before reading the body", async () => {
    const res = await POST(postReq("akta", { headers: { "content-length": "abc" } }), ctx);
    expect(res.status).toBe(411);
    expect(await res.json()).toEqual({ error: "LENGTH_REQUIRED" });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("a missing Content-Length is tolerated (HTTP/2 may drop it) — the file.size cap still applies", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(PDF)], "akta.pdf", { type: "application/pdf" }));
    const res = await POST(
      new NextRequest("http://localhost/api/enrollments/token/tok/documents?key=akta", { method: "POST", body: form }),
      ctx,
    );
    expect(res.status).not.toBe(411);
    expect(saveFile).toHaveBeenCalled();
  });

  it("does not delete when re-uploading identical bytes (same token)", async () => {
    mockRow({ status: "INVITED", tokenExpiresAt: future }, { akta: { fileToken: NEW_TOKEN } });
    await POST(postReq("akta"), ctx);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("429 once the per-IP bucket is spent", async () => {
    for (let i = 0; i < 30; i++) expect((await POST(postReq("akta"), ctx)).status).toBe(200);
    expect((await POST(postReq("akta"), ctx)).status).toBe(429);
  });
});

describe("DELETE /api/enrollments/token/[token]/documents", () => {
  it("clears the file fields atomically and removes the stored object", async () => {
    mockRow({ status: "INVITED", tokenExpiresAt: future }, { kk: { fileToken: OLD_TOKEN, fileName: "kk.jpg" } }, {});
    const res = await DELETE(delReq("kk"), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(removeJsonFields).toHaveBeenCalledWith(
      "a",
      "documents",
      "kk",
      ["fileToken", "fileName", "mimeType", "size", "uploadedAt", "label"],
      { requireInvited: true },
    );
    expect(deleteFile).toHaveBeenCalledWith(OLD_TOKEN);
  });

  it("keeps the object when the row still references it after the remove (race with a re-upload)", async () => {
    mockRow(
      { status: "INVITED", tokenExpiresAt: future },
      { kk: { fileToken: OLD_TOKEN } },
      { kk: { fileToken: OLD_TOKEN } },
    );
    expect((await DELETE(delReq("kk"), ctx)).status).toBe(200);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("is ok (and deletes nothing) when there was no file", async () => {
    const res = await DELETE(delReq("kk"), ctx);
    expect(res.status).toBe(200);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("409 when the INVITED-guarded write matches no row; the object is kept", async () => {
    mockRow({ status: "INVITED", tokenExpiresAt: future }, { kk: { fileToken: OLD_TOKEN } });
    removeJsonFields.mockResolvedValue(false);
    const res = await DELETE(delReq("kk"), ctx);
    expect(res.status).toBe(409);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("400 unknown key, 409 submitted, 404 unknown token", async () => {
    expect((await DELETE(delReq("nope"), ctx)).status).toBe(400);
    mockRow({ status: "SUBMITTED", tokenExpiresAt: future });
    expect((await DELETE(delReq("kk"), ctx)).status).toBe(409);
    mockRow(null);
    expect((await DELETE(delReq("kk"), ctx)).status).toBe(404);
    expect(removeJsonFields).not.toHaveBeenCalled();
  });

  it("a failing storage cleanup does not fail the request", async () => {
    mockRow({ status: "INVITED", tokenExpiresAt: future }, { kk: { fileToken: OLD_TOKEN } }, {});
    deleteFile.mockRejectedValue(new Error("storage down"));
    expect((await DELETE(delReq("kk"), ctx)).status).toBe(200);
  });
});
