import { describe, it, expect, vi, beforeEach } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
// Mocks — keep these in sync with @/lib/auth + @/lib/db + @/lib/storage
// usage in the route.
// ──────────────────────────────────────────────────────────────────────────

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

const state = {
  session: null as Session | null,
  student: null as { id: string; tenantId: string; photoUrl: string | null } | null,
  guardianLink: null as { id: string } | null,
  user: null as { parentId: string | null } | null,
  lastUpdate: null as Record<string, unknown> | null,
};

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/auth", async () => {
  return {
    getSession: vi.fn(async () => state.session),
    isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
  };
});

// Backend mock — route tests assert route logic (auth, validation, response
// shape), not storage internals. The adapter has its own coverage in
// lib/storage/__tests__/storage.test.ts. Mocking @/lib/storage here also
// bypasses the env-var fail-fast in lib/storage/supabase.ts, which would
// otherwise throw in CI where SUPABASE_SERVICE_ROLE_KEY isn't set.
const fakeBucket = new Map<string, { bytes: Buffer; mimeType: string }>();
vi.mock("@/lib/storage", () => ({
  saveFile: vi.fn(async ({ entity, entityId, field, file }: {
    entity: string;
    entityId: string;
    field: string;
    file: { bytes: Buffer; mimeType: string; ext: string };
  }) => {
    const hash = "deadbeefdeadbeef";
    const path = `${entity}/${entityId}/${field}-${hash}.${file.ext}`;
    fakeBucket.set(path, { bytes: file.bytes, mimeType: file.mimeType });
    return { token: `supabase:v1:${path}` };
  }),
  streamFile: vi.fn(async (token: string) => {
    if (!token.startsWith("supabase:v1:")) throw new Error("ENOENT");
    const path = token.slice("supabase:v1:".length);
    const obj = fakeBucket.get(path);
    if (!obj) throw new Error("ENOENT");
    const filename = path.split("/").pop() ?? "file.jpg";
    const ext = filename.split(".").pop() ?? "bin";
    const mimeType = ext === "jpg" ? "image/jpeg" : ext === "png" ? "image/png" : "application/octet-stream";
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

vi.mock("@/lib/db", () => {
  return {
    prisma: {
      student: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const s = state.student;
          if (!s) return null;
          if (where.id && s.id !== where.id) return null;
          if (where.tenantId && s.tenantId !== where.tenantId) return null;
          return { ...s };
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.lastUpdate = data;
          if (state.student) {
            state.student = {
              ...state.student,
              photoUrl: (data.photoUrl as string | null) ?? state.student.photoUrl,
            };
          }
          return state.student;
        }),
      },
      user: {
        findUnique: vi.fn(async () => state.user),
      },
      studentGuardian: {
        findFirst: vi.fn(async () => state.guardianLink),
      },
    },
  };
});

// Import AFTER mocks so the route binds to the mocked modules.
import { POST, GET, DELETE } from "../route";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function adminSession(): Session {
  return {
    id: "u_admin",
    role: "SCHOOL_ADMIN",
    tenantId: "t_default",
    email: "admin@example.com",
    name: "Admin",
    employeeId: null,
    parentId: null,
    permissions: ["students.create", "students.edit"],
    customRoleCode: null,
  };
}
function guardianSession(): Session {
  return { ...adminSession(), id: "u_guardian", role: "GUARDIAN", parentId: "par_1" };
}
function teacherSession(): Session {
  return { ...adminSession(), id: "u_teacher", role: "TEACHER" };
}

const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

function makeFile(bytes: Buffer, name: string, type: string): File {
  // Node 18+ provides global File (undici).
  return new File([new Uint8Array(bytes)], name, { type });
}

/**
 * Build a Request-like object the route handlers can use. The route reads
 * `req.headers.get('content-length')` and `req.formData()` — we stub both
 * directly to avoid jsdom's multipart serializer (which hangs).
 */
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

async function runPost(req: Request, id = "stu_1") {
  return POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ id }),
  });
}
async function runGet(id = "stu_1", headers: Record<string, string> = {}) {
  return GET({ headers: new Headers(headers) } as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ id }),
  });
}
async function runDelete(id = "stu_1") {
  return DELETE({} as unknown as Parameters<typeof DELETE>[0], {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  fakeBucket.clear();
  state.session = null;
  state.student = { id: "stu_1", tenantId: "t_default", photoUrl: null };
  state.guardianLink = null;
  state.user = null;
  state.lastUpdate = null;
});

// ──────────────────────────────────────────────────────────────────────────
// POST
// ──────────────────────────────────────────────────────────────────────────

describe("POST /api/students/[id]/photo", () => {
  it("returns 401 when unauthenticated", async () => {
    state.session = null;
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin (teacher)", async () => {
    state.session = teacherSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(403);
  });

  it("returns 413 when Content-Length exceeds 2 MB", async () => {
    state.session = adminSession();
    const res = await runPost(makeReq(new FormData(), 3 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it("returns 415 when bytes do not match a supported magic signature", async () => {
    state.session = adminSession();
    const fd = new FormData();
    // .exe DOS stub claiming JPEG
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04]);
    fd.set("file", makeFile(exe, "evil.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, exe.length));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("happy path — admin uploads JPEG, returns token, persists photoUrl", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photoUrl).toMatch(/^supabase:v1:students\/stu_1\/photo-[a-f0-9]{16}\.jpg$/);
    expect(state.lastUpdate?.photoUrl).toBe(body.photoUrl);
  });

  it("returns 404 for a student in another tenant", async () => {
    state.session = adminSession();
    state.student = { id: "stu_other", tenantId: "t_other", photoUrl: null };
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    const res = await runPost(makeReq(fd, JPEG_BYTES.length));
    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GET
// ──────────────────────────────────────────────────────────────────────────

describe("GET /api/students/[id]/photo", () => {
  it("returns 401 when unauthenticated", async () => {
    state.session = null;
    const res = await runGet();
    expect(res.status).toBe(401);
  });

  it("returns 404 when student has no photoUrl", async () => {
    state.session = adminSession();
    const res = await runGet();
    expect(res.status).toBe(404);
  });

  it("returns 200 + image bytes for admin after upload", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));

    const res = await runGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("etag")).toMatch(/^"[\w-]{27}"$/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(JPEG_BYTES)).toBe(true);
  });

  it("answers 304 with no body (no storage download) when the browser already has this photo", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));
    const etag = (await runGet()).headers.get("etag")!;
    const storage = await import("@/lib/storage");
    vi.mocked(storage.streamFile).mockClear();

    const res = await runGet("stu_1", { "if-none-match": etag });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
    expect(storage.streamFile).not.toHaveBeenCalled();
  });

  it("serves the new bytes when the stored photo changed (stale ETag)", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));
    const res = await runGet("stu_1", { "if-none-match": '"an-older-photo-etag-000000000"' });
    expect(res.status).toBe(200);
  });

  it("still enforces authorisation on a conditional request (no 304 leak)", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));
    const etag = (await runGet()).headers.get("etag")!;

    state.session = teacherSession();
    expect((await runGet("stu_1", { "if-none-match": etag })).status).toBe(403);
  });

  it("returns 403 for a guardian NOT linked to the student", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));

    state.session = guardianSession();
    state.user = { parentId: "par_1" };
    state.guardianLink = null; // no link
    const res = await runGet();
    expect(res.status).toBe(403);
  });

  it("returns 200 for a guardian WITH an active StudentGuardian link", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));

    state.session = guardianSession();
    state.user = { parentId: "par_1" };
    state.guardianLink = { id: "sg_1" };
    const res = await runGet();
    expect(res.status).toBe(200);
  });

  it("returns 403 for a teacher (neither admin nor guardian)", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));

    state.session = teacherSession();
    const res = await runGet();
    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// DELETE
// ──────────────────────────────────────────────────────────────────────────

describe("DELETE /api/students/[id]/photo", () => {
  it("returns 401 when unauthenticated", async () => {
    state.session = null;
    const res = await runDelete();
    expect(res.status).toBe(401);
  });

  it("happy path — admin deletes, returns 204, nulls photoUrl", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));

    const res = await runDelete();
    expect(res.status).toBe(204);
    expect(state.lastUpdate?.photoUrl).toBe(null);
  });

  it("a failed row update never deletes the object the row still names (no stale 304)", async () => {
    state.session = adminSession();
    const fd = new FormData();
    fd.set("file", makeFile(JPEG_BYTES, "p.jpg", "image/jpeg"));
    await runPost(makeReq(fd, JPEG_BYTES.length));
    const { prisma } = await import("@/lib/db");
    const storage = await import("@/lib/storage");
    vi.mocked(storage.deleteFile).mockClear();
    vi.mocked(prisma.student.update).mockRejectedValueOnce(new Error("db down"));

    await expect(runDelete()).rejects.toThrow("db down");
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(state.student?.photoUrl).toMatch(/^supabase:v1:/);
    // The row still names a live object, so the photo still serves.
    expect((await runGet()).status).toBe(200);
  });

  it("is a no-op when no photoUrl exists (returns 204)", async () => {
    state.session = adminSession();
    const res = await runDelete();
    expect(res.status).toBe(204);
  });
});
