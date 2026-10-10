import { describe, it, expect, vi, beforeEach } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
// Mocks
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

type StudentRow = {
  id: string;
  tenantId: string;
  name: string;
  metadata: string | null;
  status: string;
  withdrawalReason: string | null;
  withdrawalDate: string | null;
  graduationDate: string | null;
};

const state = {
  session: null as Session | null,
  student: null as StudentRow | null,
  lastUpdate: null as Record<string, unknown> | null,
};

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    student: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const s = state.student;
        if (!s) return null;
        if (where.id && s.id !== where.id) return null;
        if (where.tenantId && s.tenantId !== where.tenantId) return null;
        return { ...s };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = state.student;
        if (!s || s.id !== where.id) return null;
        return { ...s };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.lastUpdate = data;
        const s = state.student;
        if (!s) throw new Error("no student");
        const merged: StudentRow = { ...s };
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined) (merged as Record<string, unknown>)[k] = v as unknown;
        }
        state.student = merged;
        return { ...merged };
      }),
    },
    $transaction: vi.fn(async (cb: unknown) => {
      if (typeof cb === "function") return (cb as (tx: unknown) => unknown)({
        studentEnrollment: { updateMany: vi.fn(async () => ({ count: 0 })) },
        invoice: { updateMany: vi.fn(async () => ({ count: 0 })) },
      });
    }),
  },
}));

import { PUT } from "../route";

function adminSession(): Session {
  return {
    id: "u1",
    role: "SCHOOL_ADMIN",
    tenantId: "t1",
    email: "a@x",
    name: "A",
    employeeId: null,
    parentId: null,
    permissions: ["students.create", "students.edit"],
    customRoleCode: null,
  };
}

function freshStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: "s1",
    tenantId: "t1",
    name: "Budi",
    metadata: null,
    status: "ACTIVE",
    withdrawalReason: null,
    withdrawalDate: null,
    graduationDate: null,
    ...overrides,
  };
}

function putReq(body: unknown): Request {
  return new Request("http://x/api/students/s1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "s1" });

beforeEach(() => {
  state.session = adminSession();
  state.student = freshStudent();
  state.lastUpdate = null;
});

// ──────────────────────────────────────────────────────────────────────────
// T4 — metadata round-trip + null clear
// ──────────────────────────────────────────────────────────────────────────

describe("PUT /api/students/[id] — metadata (T4)", () => {
  it("persists a flat key/value object as a JSON string", async () => {
    const res = await PUT(putReq({ metadata: { alergi: "udang", hobi: "renang" } }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.metadata).toBe(JSON.stringify({ alergi: "udang", hobi: "renang" }));
  });

  it("clears metadata to NULL when client sends metadata: null (not the string '{}')", async () => {
    state.student = freshStudent({ metadata: JSON.stringify({ alergi: "udang" }) });
    const res = await PUT(putReq({ metadata: null }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.metadata).toBeNull();
  });

  it("preserves existing metadata when the field is not present on the payload", async () => {
    state.student = freshStudent({ metadata: JSON.stringify({ alergi: "udang" }) });
    const res = await PUT(putReq({ name: "Budi Baru" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.metadata).toBe(JSON.stringify({ alergi: "udang" }));
  });

  it("rejects non-object metadata via zod validation", async () => {
    const res = await PUT(putReq({ metadata: "string-not-object" }) as never, { params });
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T5 — withdrawalReason inline edit (date stays read-only)
// ──────────────────────────────────────────────────────────────────────────

describe("PUT /api/students/[id] — withdrawalReason (T5)", () => {
  it("updates withdrawalReason without touching withdrawalDate", async () => {
    state.student = freshStudent({
      status: "WITHDRAWN",
      withdrawalReason: "pindah sekolah",
      withdrawalDate: "2026-05-01",
    });
    const res = await PUT(putReq({ withdrawalReason: "pindah ke luar kota" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.withdrawalReason).toBe("pindah ke luar kota");
    // Date field is never set by this route (lifecycle API owns it).
    expect(state.lastUpdate?.withdrawalDate).toBeUndefined();
  });

  it("rejects an empty withdrawalReason", async () => {
    state.student = freshStudent({ status: "WITHDRAWN" });
    const res = await PUT(putReq({ withdrawalReason: "" }) as never, { params });
    expect(res.status).toBe(400);
  });

  it("rejects a whitespace-only withdrawalReason (schema trims before length check)", async () => {
    state.student = freshStudent({ status: "WITHDRAWN" });
    const res = await PUT(putReq({ withdrawalReason: "   " }) as never, { params });
    expect(res.status).toBe(400);
  });

  it("leaves withdrawalReason untouched when not provided", async () => {
    state.student = freshStudent({
      status: "WITHDRAWN",
      withdrawalReason: "pindah sekolah",
      withdrawalDate: "2026-05-01",
    });
    const res = await PUT(putReq({ name: "Budi Baru" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate?.withdrawalReason).toBeUndefined();
    // Lock the invariant: omitting the field must preserve the prior DB value,
    // not coerce undefined → null on a future refactor.
    expect(state.student?.withdrawalReason).toBe("pindah sekolah");
  });
});


