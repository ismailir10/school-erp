import { describe, it, expect, vi, beforeEach } from "vitest";

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
  lastCreate: null as Record<string, unknown> | null,
  lastFindMany: null as Record<string, unknown> | null,
  /** Rows prisma.student.findFirst resolves, consumed in call order (NIS lookup, then twin lookup). */
  findFirstQueue: [] as Array<Record<string, unknown> | null>,
  findFirstCalls: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    student: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.lastCreate = data;
        return { id: "new-student-id", ...data };
      }),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        state.lastFindMany = args;
        return [];
      }),
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        state.findFirstCalls.push(args);
        return state.findFirstQueue.shift() ?? null;
      }),
    },
    parent: { upsert: vi.fn(), create: vi.fn() },
    studentGuardian: { createMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ success: true })),
  getClientIp: vi.fn(() => "1.1.1.1"),
}));

import { GET, POST } from "../route";

function adminSession(): Session {
  return {
    id: "u1",
    role: "SCHOOL_ADMIN",
    tenantId: "t1",
    email: "a@x",
    name: "A",
    employeeId: null,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

function postReq(body: unknown): Request {
  return new Request("http://x/api/students", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = adminSession();
  state.lastCreate = null;
  state.lastFindMany = null;
  state.findFirstQueue = [];
  state.findFirstCalls = [];
});

describe("GET /api/students — Wali column source", () => {
  it("falls back to the first ACTIVE guardian, preferring the primary", async () => {
    // Was `where: { isPrimary: true }`, which rendered "—" in the Wali column
    // for any student with guardians but no primary flag — the common shape
    // for bulk-imported rows. Asserting the query shape is the regression
    // guard; the mock cannot express Prisma's ordering itself.
    await GET(new Request("http://x/api/students") as never);

    const include = state.lastFindMany?.include as Record<string, never>;
    const guardians = include.guardians as unknown as {
      where: Record<string, unknown>;
      orderBy: Record<string, unknown>;
      take: number;
      include: { parent: { select: Record<string, boolean> } };
    };

    expect(guardians.where).toEqual({ status: "ACTIVE" });
    expect(guardians.orderBy).toEqual({ isPrimary: "desc" });
    expect(guardians.take).toBe(1);
    // id is what makes the column a link through to the guardian page.
    expect(guardians.include.parent.select).toMatchObject({
      id: true,
      name: true,
      phone: true,
    });
  });
});

describe("GET /api/students — class picker filters (CORE-3)", () => {
  it("searches name, nickname and NIS", async () => {
    await GET(new Request("http://x/api/students?search=2025001") as never);
    const where = state.lastFindMany?.where as { OR: Record<string, unknown>[] };
    expect(where.OR.map((c) => Object.keys(c)[0])).toEqual(["name", "nickname", "nis"]);
  });

  it("excludes students already ACTIVE in the given class, server-side", async () => {
    await GET(new Request("http://x/api/students?status=ACTIVE&notEnrolledInClass=class-9") as never);
    const where = state.lastFindMany?.where as Record<string, unknown>;
    expect(where.enrollments).toEqual({ none: { classSectionId: "class-9", status: "ACTIVE" } });
    expect(where.status).toBe("ACTIVE");
  });

  it("adds no enrollment filter when the param is absent", async () => {
    await GET(new Request("http://x/api/students?status=ACTIVE") as never);
    expect((state.lastFindMany?.where as Record<string, unknown>).enrollments).toBeUndefined();
  });
});

describe("POST /api/students — full field set (T2)", () => {
  it("persists every supplied schema-editable field, not just the legacy 7", async () => {
    const res = await POST(postReq({
      name: "Aisyah Putri",
      nickname: "Aisyah",
      gender: "P",
      dateOfBirth: "2018-03-15",
      address: "Jl. Mawar No. 12",
      nis: "2026001",
      nisn: "0089998877",
      birthPlace: "Jakarta",
      nik: "3171234567890001",
      kkNumber: "3171234567890002",
      livingWith: "BOTH",
      notes: "Alergi udang",
      status: "ACTIVE",
    }) as never);
    expect(res.status).toBe(201);
    expect(state.lastCreate).toMatchObject({
      tenantId: "t1",
      name: "Aisyah Putri",
      nickname: "Aisyah",
      gender: "P",
      dateOfBirth: "2018-03-15",
      address: "Jl. Mawar No. 12",
      nis: "2026001",
      nisn: "0089998877",
      birthPlace: "Jakarta",
      nik: "3171234567890001",
      kkNumber: "3171234567890002",
      livingWith: "BOTH",
      notes: "Alergi udang",
      status: "ACTIVE",
    });
  });

  it("defaults status to ACTIVE when not provided", async () => {
    const res = await POST(postReq({ name: "Budi" }) as never);
    expect(res.status).toBe(201);
    expect(state.lastCreate?.status).toBe("ACTIVE");
  });

  it("accepts and persists explicit non-ACTIVE status for backfill", async () => {
    const res = await POST(postReq({ name: "Citra", status: "GRADUATED" }) as never);
    expect(res.status).toBe(201);
    expect(state.lastCreate?.status).toBe("GRADUATED");
  });

  it("rejects an invalid status enum value", async () => {
    const res = await POST(postReq({ name: "Dewi", status: "PENDING" }) as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/students — duplicate guards (ADM-2)", () => {
  it("409 NIS_TAKEN with field nis when another student in the tenant has the same NIS", async () => {
    state.findFirstQueue = [{ id: "s-old", name: "Aisyah" }];
    const res = await POST(postReq({ name: "Budi", nis: " 2024001 " }) as never);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "NIS sudah dipakai oleh Aisyah.",
      code: "NIS_TAKEN",
      field: "nis",
    });
    // Tenant-scoped, trimmed, any status.
    expect(state.findFirstCalls[0]).toEqual(
      expect.objectContaining({ where: { tenantId: "t1", nis: "2024001" } }),
    );
    expect(state.lastCreate).toBeNull();
  });

  it("skips the NIS lookup when NIS is empty", async () => {
    const res = await POST(postReq({ name: "Budi", nis: "   " }) as never);
    expect(res.status).toBe(201);
    expect(state.findFirstCalls).toHaveLength(0);
  });

  it("409 DUPLICATE_STUDENT for the same name (case-insensitive) + date of birth, naming the NIS", async () => {
    state.findFirstQueue = [{ id: "s-twin", name: "Aisyah Putri", nis: "2024001", status: "ACTIVE" }];
    const res = await POST(postReq({ name: " aisyah putri ", dateOfBirth: "2020-03-01" }) as never);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Siswa dengan nama dan tanggal lahir yang sama sudah ada: Aisyah Putri (2024001).",
      code: "DUPLICATE_STUDENT",
      existingId: "s-twin",
    });
    expect(state.findFirstCalls[0]).toEqual(
      expect.objectContaining({
        where: {
          tenantId: "t1",
          dateOfBirth: "2020-03-01",
          name: { equals: "aisyah putri", mode: "insensitive" },
        },
      }),
    );
    expect(state.lastCreate).toBeNull();
  });

  it("names the status label when the existing twin has no NIS", async () => {
    state.findFirstQueue = [{ id: "s-twin", name: "Aisyah", nis: null, status: "WITHDRAWN" }];
    const res = await POST(postReq({ name: "Aisyah", dateOfBirth: "2020-03-01" }) as never);
    const body = await res.json();
    expect(body.error).toBe("Siswa dengan nama dan tanggal lahir yang sama sudah ada: Aisyah (Keluar).");
  });

  it("confirmDuplicate: true skips the name + date of birth check and creates", async () => {
    state.findFirstQueue = [{ id: "s-twin", name: "Aisyah", nis: "1", status: "ACTIVE" }];
    const res = await POST(
      postReq({ name: "Aisyah", dateOfBirth: "2020-03-01", confirmDuplicate: true }) as never,
    );

    expect(res.status).toBe(201);
    expect(state.findFirstCalls).toHaveLength(0);
    expect(state.lastCreate).toEqual(expect.objectContaining({ name: "Aisyah" }));
    // The flag is not a column — it must never reach Prisma.
    expect(state.lastCreate).not.toHaveProperty("confirmDuplicate");
  });

  it("confirmDuplicate does NOT bypass a taken NIS", async () => {
    state.findFirstQueue = [{ id: "s-old", name: "Aisyah" }];
    const res = await POST(
      postReq({ name: "Budi", nis: "2024001", confirmDuplicate: true }) as never,
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NIS_TAKEN");
  });

  it("does not look for a twin when the date of birth is missing", async () => {
    const res = await POST(postReq({ name: "Aisyah" }) as never);
    expect(res.status).toBe(201);
    expect(state.findFirstCalls).toHaveLength(0);
  });
});
