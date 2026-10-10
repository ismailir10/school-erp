import { describe, it, expect, vi, beforeEach } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
// T7 — PUT /api/students/[id]/guardians/[guardianId]
//
// Locks the address + childrenTotal pass-through that was silently dropped
// before T7 (the unified GuardianForm sends both, the schema permits both,
// the handler now writes both).
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

type ParentRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  nik: string | null;
  education: string | null;
  occupation: string | null;
  employer: string | null;
  employerAddress: string | null;
  employerCity: string | null;
  incomeRange: string | null;
  address: string | null;
  childrenTotal: number | null;
};

type GuardianRow = {
  id: string;
  studentId: string;
  parentId: string;
  relationship: string;
  isPrimary: boolean;
  childOrder: number | null;
  status: string;
  parent: ParentRow;
};

const state = {
  session: null as Session | null,
  student: null as { id: string; tenantId: string } | null,
  guardian: null as GuardianRow | null,
  // Used by T8 race-safe primary toggle — the route runs updateMany on
  // sibling guardians inside a serializable tx before updating the target.
  otherGuardians: [] as GuardianRow[],
  lastParentUpdate: null as Record<string, unknown> | null,
  lastJunctionUpdate: null as Record<string, unknown> | null,
  lastUpdateMany: null as Record<string, unknown> | null,
  // Set by the top-level (non-tx) studentGuardian.update mock — used by the
  // PATCH status-toggle handler, which does not run inside a transaction.
  lastPatchUpdate: null as Record<string, unknown> | null,
  /** Set to "P2034" to make the first tx attempt throw a Prisma serialization
   *  failure; the route should retry once then succeed. */
  forceP2034Once: false,
  txAttempts: 0,
};

// Cache eviction is a Next runtime call; spy on it instead of loading
// unstable_cache (parent-helpers pulls in the whole parent portal graph).
const { invalidateParentChildren } = vi.hoisted(() => ({ invalidateParentChildren: vi.fn() }));
vi.mock("@/lib/parent-helpers", () => ({ invalidateParentChildren }));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));

vi.mock("@/lib/generated/prisma/client", () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    clientVersion: string;
    constructor(message: string, opts: { code: string; clientVersion: string }) {
      super(message);
      this.code = opts.code;
      this.clientVersion = opts.clientVersion;
    }
  }
  return {
    Prisma: {
      TransactionIsolationLevel: { Serializable: "Serializable" },
      PrismaClientKnownRequestError,
    },
  };
});

const txProxy = {
  studentGuardian: {
    // changeGuardianLinkStatus re-reads isPrimary inside the transaction.
    findUnique: vi.fn(async () => ({ isPrimary: state.guardian?.isPrimary ?? false })),
    findMany: vi.fn(async () => [] as unknown[]),
    count: vi.fn(async () => 1),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.lastUpdateMany = data;
      // Apply the demotion in our in-memory other-guardian set so the
      // single-primary invariant assertion below holds.
      for (const g of state.otherGuardians) {
        if (g.isPrimary) g.isPrimary = data.isPrimary as boolean;
      }
      return { count: state.otherGuardians.length };
    }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if ("status" in data) state.lastPatchUpdate = data;
      else state.lastJunctionUpdate = data;
      const g = state.guardian;
      if (!g) throw new Error("no guardian");
      const merged: GuardianRow = { ...g, parent: { ...g.parent } };
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) (merged as Record<string, unknown>)[k] = v as unknown;
      }
      state.guardian = merged;
      return { ...merged };
    }),
  },
};

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
    },
    studentGuardian: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const g = state.guardian;
        if (!g) return null;
        if (where.id && g.id !== where.id) return null;
        if (where.studentId && g.studentId !== where.studentId) return null;
        return { ...g, parent: { ...g.parent } };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.lastPatchUpdate = data;
        const g = state.guardian;
        if (!g) throw new Error("no guardian");
        const merged: GuardianRow = { ...g, parent: { ...g.parent } };
        for (const [k, v] of Object.entries(data)) {
          (merged as Record<string, unknown>)[k] = v as unknown;
        }
        state.guardian = merged;
        return { ...merged };
      }),
    },
    parent: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.lastParentUpdate = data;
        const g = state.guardian;
        if (!g) throw new Error("no guardian");
        const merged: ParentRow = { ...g.parent };
        for (const [k, v] of Object.entries(data)) {
          if (v !== undefined) (merged as Record<string, unknown>)[k] = v as unknown;
        }
        state.guardian = { ...g, parent: merged };
        return { ...merged };
      }),
    },
    $transaction: vi.fn(async (cb: unknown) => {
      state.txAttempts++;
      // Simulate a P2034 serialization failure on the first attempt so the
      // route's retry path is exercised.
      if (state.forceP2034Once && state.txAttempts === 1) {
        const { Prisma } = await import("@/lib/generated/prisma/client");
        throw new Prisma.PrismaClientKnownRequestError("serialization", {
          code: "P2034",
          clientVersion: "test",
        });
      }
      if (typeof cb === "function") return (cb as (tx: unknown) => unknown)(txProxy);
      return null;
    }),
  },
}));

import { PUT, PATCH } from "../route";

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

function freshGuardian(overrides: Partial<ParentRow> = {}): GuardianRow {
  return {
    id: "sg1",
    studentId: "s1",
    parentId: "p1",
    relationship: "AYAH",
    isPrimary: true,
    childOrder: null,
    status: "ACTIVE",
    parent: {
      id: "p1",
      name: "Pak Budi",
      phone: "08111",
      email: "budi@x",
      whatsapp: "08111",
      nik: null,
      education: null,
      occupation: null,
      employer: null,
      employerAddress: null,
      employerCity: null,
      incomeRange: null,
      address: "Jl. Lama 1",
      childrenTotal: 2,
      ...overrides,
    },
  };
}

function putReq(body: unknown): Request {
  return new Request("http://x/api/students/s1/guardians/sg1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown): Request {
  return new Request("http://x/api/students/s1/guardians/sg1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "s1", guardianId: "sg1" });

beforeEach(() => {
  state.session = adminSession();
  state.student = { id: "s1", tenantId: "t1" };
  state.guardian = freshGuardian();
  state.otherGuardians = [];
  state.lastParentUpdate = null;
  state.lastJunctionUpdate = null;
  state.lastUpdateMany = null;
  state.lastPatchUpdate = null;
  state.forceP2034Once = false;
  state.txAttempts = 0;
  invalidateParentChildren.mockClear();
});

describe("guardian link writes — parent-children cache eviction (STR-15)", () => {
  it("PUT evicts after a successful update", async () => {
    expect((await PUT(putReq({ name: "Pak Budi Baru" }) as never, { params })).status).toBe(200);
    expect(invalidateParentChildren).toHaveBeenCalledTimes(1);
  });

  it("PATCH evicts after a status change", async () => {
    expect((await PATCH(patchReq({ status: "INACTIVE" }) as never, { params })).status).toBe(200);
    expect(invalidateParentChildren).toHaveBeenCalledTimes(1);
  });

  it("does not evict when the guardian is unknown or the body is invalid", async () => {
    state.guardian = null;
    expect((await PUT(putReq({ name: "X" }) as never, { params })).status).toBe(404);
    expect((await PATCH(patchReq({ status: "INACTIVE" }) as never, { params })).status).toBe(404);
    state.guardian = freshGuardian();
    expect((await PATCH(patchReq({ status: "BOGUS" }) as never, { params })).status).toBe(400);
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });
});

describe("PUT /api/students/[id]/guardians/[guardianId] — address + childrenTotal (T7)", () => {
  it("writes address + childrenTotal when supplied", async () => {
    const res = await PUT(putReq({ address: "Jl. Baru 99", childrenTotal: 4 }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastParentUpdate?.address).toBe("Jl. Baru 99");
    expect(state.lastParentUpdate?.childrenTotal).toBe(4);
  });

  it("preserves existing address + childrenTotal when omitted from payload", async () => {
    const res = await PUT(putReq({ name: "Pak Budi Baru" }) as never, { params });
    expect(res.status).toBe(200);
    // Both fields fall through as `undefined`, which Prisma treats as "do not
    // touch the column". The pre-T7 silent-drop bug surfaced because the
    // field was simply absent from the `data` object — assert presence via
    // `undefined`, not via a missing key, so a future refactor that flips
    // back to omission also fails.
    expect(state.lastParentUpdate).not.toBeNull();
    expect("address" in (state.lastParentUpdate ?? {})).toBe(true);
    expect("childrenTotal" in (state.lastParentUpdate ?? {})).toBe(true);
    expect(state.lastParentUpdate?.address).toBeUndefined();
    expect(state.lastParentUpdate?.childrenTotal).toBeUndefined();
    // And the in-memory parent row stays at its prior values.
    expect(state.guardian?.parent.address).toBe("Jl. Lama 1");
    expect(state.guardian?.parent.childrenTotal).toBe(2);
  });

  it("clears address to null when sent as an empty string (trim-or-null contract)", async () => {
    const res = await PUT(putReq({ address: "   " }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastParentUpdate?.address).toBeNull();
  });

  it("clears childrenTotal to null when sent as null", async () => {
    const res = await PUT(putReq({ childrenTotal: null }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastParentUpdate?.childrenTotal).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T8 — childOrder + race-safe single-primary invariant
// ──────────────────────────────────────────────────────────────────────────

describe("PUT /api/students/[id]/guardians/[guardianId] — childOrder + isPrimary (T8)", () => {
  it("writes childOrder on the junction record (not the Parent)", async () => {
    state.guardian = freshGuardian();
    const res = await PUT(putReq({ childOrder: 3 }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastJunctionUpdate?.childOrder).toBe(3);
    // Sanity: the parent update never touched childOrder.
    expect(state.lastParentUpdate).not.toHaveProperty("childOrder");
  });

  it("coerces a string childOrder via the zod schema (form Input sends strings)", async () => {
    const res = await PUT(putReq({ childOrder: "2" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastJunctionUpdate?.childOrder).toBe(2);
  });

  it("clears childOrder when sent as null", async () => {
    state.guardian = freshGuardian();
    state.guardian.childOrder = 5;
    const res = await PUT(putReq({ childOrder: null }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastJunctionUpdate?.childOrder).toBeNull();
  });

  it("rejects childOrder < 1 (must be a positive position)", async () => {
    const res = await PUT(putReq({ childOrder: 0 }) as never, { params });
    expect(res.status).toBe(400);
  });

  it("promoting to primary issues updateMany(isPrimary=false) on sibling guardians", async () => {
    // Seed: target guardian is NOT primary; a sibling is.
    state.guardian = freshGuardian();
    state.guardian.isPrimary = false;
    state.otherGuardians = [
      { ...freshGuardian(), id: "sg2", parentId: "p2", isPrimary: true },
    ];
    const res = await PUT(putReq({ isPrimary: true }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdateMany).toEqual({ isPrimary: false });
    expect(state.lastJunctionUpdate?.isPrimary).toBe(true);
    // In-memory sibling demoted.
    expect(state.otherGuardians[0].isPrimary).toBe(false);
  });

  it("demoting (isPrimary=false) does NOT issue updateMany — no clear-step needed", async () => {
    state.guardian = freshGuardian(); // currently primary
    const res = await PUT(putReq({ isPrimary: false }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdateMany).toBeNull();
    expect(state.lastJunctionUpdate?.isPrimary).toBe(false);
  });

  it("uses a serializable transaction (verifiable via mock invocation)", async () => {
    const res = await PUT(putReq({ isPrimary: true }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.txAttempts).toBe(1);
  });

  it("retries once on P2034 serialization failure then succeeds", async () => {
    state.forceP2034Once = true;
    state.guardian = freshGuardian();
    state.guardian.isPrimary = false;
    const res = await PUT(putReq({ isPrimary: true }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.txAttempts).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T4 — a bare `{ isPrimary: true }` PUT (the new card action's payload) must
// not blank the parent's bio or disturb relationship/childOrder.
// ──────────────────────────────────────────────────────────────────────────

describe("PUT /api/students/[id]/guardians/[guardianId] — bare isPrimary payload is bio-safe (T4)", () => {
  it("writes the CURRENT phone/email/whatsapp/name back, not null, for a bare { isPrimary: true } body", async () => {
    state.guardian = freshGuardian();
    state.guardian.isPrimary = false;
    state.otherGuardians = [
      { ...freshGuardian(), id: "sg2", parentId: "p2", isPrimary: true },
    ];

    const res = await PUT(putReq({ isPrimary: true }) as never, { params });

    expect(res.status).toBe(200);
    // Every bio field falls through to its CURRENT value (name/relationship
    // by `||` fallback, the rest by `!== undefined ? … : current`) — none of
    // them may come out null or blank just because the body omitted them.
    expect(state.lastParentUpdate?.name).toBe("Pak Budi");
    expect(state.lastParentUpdate?.phone).toBe("08111");
    expect(state.lastParentUpdate?.email).toBe("budi@x");
    expect(state.lastParentUpdate?.whatsapp).toBe("08111");
    // The rest are `undefined` (Prisma "do not touch"), never null.
    for (const key of [
      "nik", "education", "occupation", "employer",
      "employerAddress", "employerCity", "incomeRange", "address", "childrenTotal",
    ] as const) {
      expect(state.lastParentUpdate?.[key]).toBeUndefined();
    }
    // The in-memory parent row proves nothing was actually blanked.
    expect(state.guardian?.parent.phone).toBe("08111");
    expect(state.guardian?.parent.email).toBe("budi@x");
    expect(state.guardian?.parent.whatsapp).toBe("08111");
  });

  it("keeps the current relationship and does not touch childOrder for a bare { isPrimary: true } body", async () => {
    state.guardian = freshGuardian();
    state.guardian.isPrimary = false;
    state.guardian.relationship = "IBU";
    state.guardian.childOrder = 2;
    state.otherGuardians = [
      { ...freshGuardian(), id: "sg2", parentId: "p2", isPrimary: true },
    ];

    const res = await PUT(putReq({ isPrimary: true }) as never, { params });

    expect(res.status).toBe(200);
    expect(state.lastJunctionUpdate?.relationship).toBe("IBU");
    expect(state.lastJunctionUpdate?.isPrimary).toBe(true);
    expect(state.lastJunctionUpdate?.childOrder).toBeUndefined();
    expect(state.guardian?.childOrder).toBe(2);
  });

  it("still demotes the sibling primary for a bare { isPrimary: true } body", async () => {
    state.guardian = freshGuardian();
    state.guardian.isPrimary = false;
    state.otherGuardians = [
      { ...freshGuardian(), id: "sg2", parentId: "p2", isPrimary: true },
    ];

    const res = await PUT(putReq({ isPrimary: true }) as never, { params });

    expect(res.status).toBe(200);
    expect(state.lastUpdateMany).toEqual({ isPrimary: false });
    expect(state.otherGuardians[0].isPrimary).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T2 — PATCH status toggle clears isPrimary on deactivation
// ──────────────────────────────────────────────────────────────────────────

describe("PATCH /api/students/[id]/guardians/[guardianId] — status toggle clears isPrimary (T2)", () => {
  it('PATCH {status:"INACTIVE"} writes status: "INACTIVE", isPrimary: false', async () => {
    state.guardian = freshGuardian();
    state.guardian.isPrimary = true;
    const res = await PATCH(patchReq({ status: "INACTIVE" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastPatchUpdate).toEqual({ status: "INACTIVE", isPrimary: false });
  });

  it('PATCH {status:"ACTIVE"} writes status: "ACTIVE" with no isPrimary key', async () => {
    state.guardian = freshGuardian();
    state.guardian.status = "INACTIVE";
    state.guardian.isPrimary = false;
    const res = await PATCH(patchReq({ status: "ACTIVE" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastPatchUpdate).toEqual({ status: "ACTIVE" });
    expect("isPrimary" in (state.lastPatchUpdate ?? {})).toBe(false);
  });
});

