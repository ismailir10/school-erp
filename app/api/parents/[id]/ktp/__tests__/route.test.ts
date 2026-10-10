import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * KTP + KK share the same handlers via lib/storage/parent-document.ts.
 * This file covers the security-critical paths (auth, MIME, size) once for
 * KTP; the KK route delegates to the same factory, so a second copy would
 * only add maintenance burden. A single round-trip test against the KK
 * route below confirms the factory dispatches on the right Prisma column.
 */

type Session = {
  id: string;
  role: "SUPER_ADMIN" | "SCHOOL_ADMIN" | "TEACHER" | "GUARDIAN";
  tenantId: string | null;
  email: string;
  name: string | null;
  employeeId: string | null;
  parentId: string | null;
  permissions: string[];
  customRoleCode: string | null;
};

type ParentRow = {
  id: string;
  tenantId: string;
  ktpUrl: string | null;
  kkUrl: string | null;
};

const state = {
  session: null as Session | null,
  parent: null as ParentRow | null,
  lastUpdate: null as Record<string, unknown> | null,
};

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));

// See app/api/students/[id]/photo/__tests__/route.test.ts for rationale.
// Adapter coverage lives in lib/storage/__tests__/storage.test.ts; here we
// mock the adapter so route tests can run without Supabase env vars.
const fakeBucket = new Map<string, { bytes: Buffer; mimeType: string }>();
vi.mock("@/lib/storage", () => ({
  saveFile: vi.fn(async ({ entity, entityId, field, file }: {
    entity: string;
    entityId: string;
    field: string;
    file: { bytes: Buffer; mimeType: string; ext: string };
  }) => {
    const hash = "deadbeefdeadbeef";
    const objPath = `${entity}/${entityId}/${field}-${hash}.${file.ext}`;
    fakeBucket.set(objPath, { bytes: file.bytes, mimeType: file.mimeType });
    return { token: `supabase:v1:${objPath}` };
  }),
  streamFile: vi.fn(async (token: string) => {
    if (!token.startsWith("supabase:v1:")) throw new Error("ENOENT");
    const objPath = token.slice("supabase:v1:".length);
    const obj = fakeBucket.get(objPath);
    if (!obj) throw new Error("ENOENT");
    const filename = objPath.split("/").pop() ?? "file";
    const ext = filename.split(".").pop() ?? "bin";
    const mimeType =
      ext === "jpg" ? "image/jpeg" :
      ext === "png" ? "image/png" :
      ext === "pdf" ? "application/pdf" :
      "application/octet-stream";
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(obj.bytes));
          controller.close();
        },
      }),
      mimeType,
      filename,
    };
  }),
  deleteFile: vi.fn(async (token: string) => {
    if (!token.startsWith("supabase:v1:")) return;
    fakeBucket.delete(token.slice("supabase:v1:".length));
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    parent: {
      findFirst: vi.fn(async ({ where, select }: { where: Record<string, unknown>; select: Record<string, boolean> }) => {
        const p = state.parent;
        if (!p) return null;
        if (where.id && p.id !== where.id) return null;
        if (where.tenantId && p.tenantId !== where.tenantId) return null;
        const out: Record<string, unknown> = { id: p.id };
        if (select.ktpUrl) out.ktpUrl = p.ktpUrl;
        if (select.kkUrl) out.kkUrl = p.kkUrl;
        return out;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.lastUpdate = data;
        if (!state.parent) throw new Error("no parent");
        state.parent = { ...state.parent, ...data } as ParentRow;
        return state.parent;
      }),
    },
  },
}));

import { POST as POST_KTP, GET as GET_KTP, DELETE as DELETE_KTP } from "../route";
import { POST as POST_KK } from "../../kk/route";

function adminSession(): Session {
  return {
    id: "u_admin",
    role: "SCHOOL_ADMIN",
    tenantId: "t_default",
    email: "admin@example.com",
    name: "Admin",
    employeeId: null,
    parentId: null,
    permissions: ["students.edit"],
    customRoleCode: null,
  };
}
function guardianSession(): Session {
  return { ...adminSession(), id: "u_g", role: "GUARDIAN", parentId: "par_1" };
}
function teacherSession(): Session {
  return { ...adminSession(), id: "u_t", role: "TEACHER" };
}

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const PDF_BYTES = Buffer.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25,
]);
const EXE_BYTES = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00,
]);

function makeFile(bytes: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function makeReq(formData: FormData | null, contentLength = 0): Request {
  return {
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-length" ? String(contentLength) : null),
    },
    formData: async () => {
      if (!formData) throw new Error("no form");
      return formData;
    },
  } as unknown as Request;
}

async function runPost(req: Request, id = "par_1") {
  return POST_KTP(req as unknown as Parameters<typeof POST_KTP>[0], {
    params: Promise.resolve({ id }),
  });
}
async function runGet(id = "par_1") {
  return GET_KTP({} as unknown as Parameters<typeof GET_KTP>[0], {
    params: Promise.resolve({ id }),
  });
}
async function runDelete(id = "par_1") {
  return DELETE_KTP({} as unknown as Parameters<typeof DELETE_KTP>[0], {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  fakeBucket.clear();
  state.session = null;
  state.parent = { id: "par_1", tenantId: "t_default", ktpUrl: null, kkUrl: null };
  state.lastUpdate = null;
});

// ──────────────────────────────────────────────────────────────────────────
// POST — auth gates
// ──────────────────────────────────────────────────────────────────────────

describe("POST /api/parents/[id]/ktp", () => {
  it("returns 401 when unauthenticated", async () => {
    state.session = null;
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "ktp.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(401);
  });

  it("returns 403 for TEACHER (admin-only PII)", async () => {
    state.session = teacherSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "ktp.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(403);
  });

  it("returns 403 for GUARDIAN (admin-only PII)", async () => {
    state.session = guardianSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "ktp.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(403);
  });

  it("returns 404 when parent belongs to a different tenant", async () => {
    state.session = adminSession();
    state.parent = { id: "par_1", tenantId: "t_other", ktpUrl: null, kkUrl: null };
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "ktp.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(404);
  });

  it("returns 413 when Content-Length exceeds 5 MB", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "ktp.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, 6 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it("returns 415 when bytes are an .exe claiming application/pdf", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(EXE_BYTES, "ktp.pdf", "application/pdf"));
    const res = await runPost(makeReq(fd, EXE_BYTES.length));
    expect(res.status).toBe(415);
  });

  it("accepts a valid JPEG and persists token to Parent.ktpUrl", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "ktp.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ktpUrl).toMatch(/^supabase:v1:parents\/par_1\/ktp-/);
    expect(state.lastUpdate?.ktpUrl).toBe(body.ktpUrl);
    expect(state.parent?.ktpUrl).toBe(body.ktpUrl);
  });

  it("accepts a valid PDF and persists token", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(PDF_BYTES, "ktp.pdf", "application/pdf"));
    const res = await runPost(makeReq(fd, PDF_BYTES.length));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ktpUrl).toMatch(/\.pdf$/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GET — auth gates + streaming
// ──────────────────────────────────────────────────────────────────────────

describe("GET /api/parents/[id]/ktp", () => {
  it("returns 401 when unauthenticated", async () => {
    state.session = null;
    expect((await runGet()).status).toBe(401);
  });

  it("returns 403 for TEACHER", async () => {
    state.session = teacherSession();
    expect((await runGet()).status).toBe(403);
  });

  it("returns 403 for GUARDIAN", async () => {
    state.session = guardianSession();
    expect((await runGet()).status).toBe(403);
  });

  it("returns 404 when no KTP uploaded", async () => {
    state.session = adminSession();
    expect((await runGet()).status).toBe(404);
  });

  it("streams the file with private no-store + inline disposition for admin", async () => {
    state.session = adminSession();
    // Upload first to seed disk + DB token, then GET.
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "ktp.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));
    const res = await runGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename\*=UTF-8''/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// DELETE — auth + idempotency
// ──────────────────────────────────────────────────────────────────────────

describe("DELETE /api/parents/[id]/ktp", () => {
  it("returns 401 when unauthenticated", async () => {
    state.session = null;
    expect((await runDelete()).status).toBe(401);
  });

  it("returns 403 for TEACHER (admin-only PII)", async () => {
    state.session = teacherSession();
    expect((await runDelete()).status).toBe(403);
  });

  it("returns 403 for GUARDIAN (admin-only PII)", async () => {
    state.session = guardianSession();
    expect((await runDelete()).status).toBe(403);
  });

  it("returns 204 when nothing to delete (idempotent)", async () => {
    state.session = adminSession();
    const res = await runDelete();
    expect(res.status).toBe(204);
  });

  it("clears the DB column when a KTP exists", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "ktp.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(state.parent?.ktpUrl).not.toBeNull();
    const res = await runDelete();
    expect(res.status).toBe(204);
    expect(state.parent?.ktpUrl).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// KK route — confirms the factory writes to the right column
// ──────────────────────────────────────────────────────────────────────────

describe("POST /api/parents/[id]/kk — factory dispatch", () => {
  it("writes to Parent.kkUrl (NOT ktpUrl) when posting to the kk route", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "kk.jpg", "image/jpeg"));
    const res = await POST_KK(
      makeReq(fd, JPEG_BYTES.length) as unknown as Parameters<typeof POST_KK>[0],
      { params: Promise.resolve({ id: "par_1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kkUrl).toMatch(/^supabase:v1:parents\/par_1\/kk-/);
    expect(state.lastUpdate?.kkUrl).toBe(body.kkUrl);
    expect(state.lastUpdate?.ktpUrl).toBeUndefined();
  });
});
