import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, getSession, isAdminRole, streamFile } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  streamFile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { enrollmentApplication: { findUnique } } }));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/storage", () => ({ streamFile }));

import { GET } from "../route";

const ctx = (id = "ea-1", key = "akta") => ({ params: Promise.resolve({ id, key }) });
const req = () => new NextRequest("http://localhost/api/enrollments/ea-1/documents/akta");
const TOKEN = "supabase:v1:enrollment/ea-1/doc-akta-0123456789abcdef.pdf";
const BYTES = Buffer.from("%PDF-1.4 test");

function bodyStream() {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(BYTES));
      c.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  isAdminRole.mockReturnValue(true);
  findUnique.mockResolvedValue({
    tenantId: "t-1",
    documents: { akta: { fileToken: TOKEN, fileName: "Akta Aisyah.pdf" } },
  });
  streamFile.mockImplementation(async () => ({
    stream: bodyStream(),
    mimeType: "application/pdf",
    filename: "doc-akta-0123456789abcdef.pdf",
  }));
});

describe("GET /api/enrollments/[id]/documents/[key]", () => {
  it("streams the file inline with no-store, nosniff and a safe ASCII filename", async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(streamFile).toHaveBeenCalledWith(TOKEN);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="Akta Aisyah.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true);
  });

  it("neutralises quotes, non-ASCII and header-breaking characters in the filename", async () => {
    findUnique.mockResolvedValue({
      tenantId: "t-1",
      documents: { akta: { fileToken: TOKEN, fileName: 'a"b\\c;d é漢.pdf' } },
    });
    const cd = (await GET(req(), ctx())).headers.get("Content-Disposition")!;
    expect(cd).toMatch(/^inline; filename="[\x20-\x7e]+"$/);
    expect(cd.slice('inline; filename="'.length, -1)).not.toMatch(/["\\;]/);
  });

  it("falls back to the stored object's name when fileName is missing", async () => {
    findUnique.mockResolvedValue({ tenantId: "t-1", documents: { akta: { fileToken: TOKEN } } });
    const res = await GET(req(), ctx());
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="doc-akta-0123456789abcdef.pdf"');
  });

  it("403 for non-admins and for admins without admissions.view; nothing is read", async () => {
    isAdminRole.mockReturnValue(false);
    expect((await GET(req(), ctx())).status).toBe(403);
    isAdminRole.mockReturnValue(true);
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["invoices.view"] });
    expect((await GET(req(), ctx())).status).toBe(403);
    getSession.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("allows an admissions read-only custom admin", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await GET(req(), ctx())).status).toBe(200);
  });

  it("404 cross-tenant, unknown application, unknown key, and no uploaded file", async () => {
    findUnique.mockResolvedValue({ tenantId: "other", documents: { akta: { fileToken: TOKEN } } });
    expect((await GET(req(), ctx())).status).toBe(404);
    findUnique.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    findUnique.mockResolvedValue({ tenantId: "t-1", documents: { akta: { fileToken: TOKEN } } });
    expect((await GET(req(), ctx("ea-1", "passport"))).status).toBe(404);
    expect((await GET(req(), ctx("ea-1", "__proto__"))).status).toBe(404);
    findUnique.mockResolvedValue({ tenantId: "t-1", documents: { akta: { receivedPhysical: true } } });
    expect((await GET(req(), ctx())).status).toBe(404);
    findUnique.mockResolvedValue({ tenantId: "t-1", documents: null });
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(streamFile).not.toHaveBeenCalled();
  });

  it("404 when the stored object is gone", async () => {
    streamFile.mockRejectedValue(new Error("ENOENT"));
    expect((await GET(req(), ctx())).status).toBe(404);
  });
});
