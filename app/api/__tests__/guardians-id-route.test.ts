import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";

/**
 * Coverage for PUT /api/guardians/[id] hardening:
 *
 * P1 — prisma.parent.update can throw P2002 on the tenant-unique email
 * (two guardians sharing an edited email). Must surface 409 with
 * Indonesian copy, not bubble as an unhandled 500.
 *
 * P0 — isPrimary:true must run inside a serializable transaction that
 * demotes any existing primary sibling (`id: { not: <this guardian> }`)
 * before writing the new primary, porting the race-safe pattern from
 * app/api/students/[id]/guardians/[guardianId]/route.ts.
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    studentGuardian: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    parent: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

// Cache eviction is a Next runtime call; spy on it instead of loading
// unstable_cache (parent-helpers pulls in the whole parent portal graph).
const { invalidateParentChildren } = vi.hoisted(() => ({ invalidateParentChildren: vi.fn() }));
vi.mock("@/lib/parent-helpers", () => ({ invalidateParentChildren }));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/guardians/g-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makePatchReq(body: unknown) {
  return new Request("http://localhost:3000/api/guardians/g-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSession(): SessionUser {
  return {
    id: "u1",
    email: "admin@t.com",
    name: "Admin",
    role: "SUPER_ADMIN",
    tenantId: "tnt-1",
    employeeId: null,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

function baseGuardian() {
  return {
    id: "g-1",
    studentId: "st-1",
    parentId: "p-1",
    relationship: "AYAH",
    isPrimary: false,
    status: "ACTIVE",
    student: { tenantId: "tnt-1" },
    parent: {
      id: "p-1",
      name: "Ayah",
      phone: null,
      email: "old@x.com",
      whatsapp: null,
      nik: null,
      education: null,
      occupation: null,
      employer: null,
      employerAddress: null,
      employerCity: null,
      incomeRange: null,
      address: null,
      childrenTotal: null,
    },
  };
}

describe("PUT /api/guardians/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("evicts the parent-children cache only after a successful update (STR-15)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue(baseGuardian() as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb({ studentGuardian: { updateMany: vi.fn(), update: vi.fn().mockResolvedValue({ id: "g-1" }) } }),
    );
    const { PUT } = await import("../guardians/[id]/route");
    const params = { params: Promise.resolve({ id: "g-1" }) };

    // Duplicate email → 409 before any link write: no eviction.
    vi.mocked(prisma.parent.update).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dupe", { code: "P2002", clientVersion: "test" }),
    );
    expect((await PUT(makeReq({ email: "dupe@x.com" }) as never, params)).status).toBe(409);
    expect(invalidateParentChildren).not.toHaveBeenCalled();

    vi.mocked(prisma.parent.update).mockResolvedValue({} as never);
    expect((await PUT(makeReq({ name: "Bu Ani" }) as never, params)).status).toBe(200);
    expect(invalidateParentChildren).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when parent.update rejects with P2002 (duplicate email)", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue(baseGuardian() as never);

    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`tenantId`,`email`)",
      { code: "P2002", clientVersion: "test", meta: { target: ["tenantId", "email"] } },
    );
    vi.mocked(prisma.parent.update).mockRejectedValue(p2002);

    const { PUT } = await import("../guardians/[id]/route");
    const res = await PUT(makeReq({ email: "dupe@x.com" }) as never, {
      params: Promise.resolve({ id: "g-1" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Email sudah digunakan oleh wali lain.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("uses a transaction and demotes sibling primaries when isPrimary:true", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue(baseGuardian() as never);
    vi.mocked(prisma.parent.update).mockResolvedValue({} as never);

    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const txUpdateMock = vi.fn().mockResolvedValue({ id: "g-1", isPrimary: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        studentGuardian: {
          updateMany: updateManyMock,
          update: txUpdateMock,
        },
      };
      return cb(tx);
    });

    const { PUT } = await import("../guardians/[id]/route");
    const res = await PUT(makeReq({ isPrimary: true }) as never, {
      params: Promise.resolve({ id: "g-1" }),
    });

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { studentId: "st-1", isPrimary: true, id: { not: "g-1" } },
      data: { isPrimary: false },
    });
    expect(txUpdateMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * T2 — deactivating a guardian via PATCH must clear isPrimary in the same
 * write (finance code later bills a deactivated-but-still-primary parent).
 * CORE-4 — and the student must not be left without an ACTIVE primary: the
 * next active guardian is promoted (or the admin's pick), reactivating into
 * an empty primary slot re-promotes.
 */
describe("PATCH /api/guardians/[id] — status toggle keeps one active primary (T2 / CORE-4)", () => {
  it("evicts the parent-children cache after a status change, not after a rejected one (STR-15)", async () => {
    const prisma = await arrange({ ...baseGuardian(), isPrimary: false });
    vi.mocked(prisma.studentGuardian.findMany).mockResolvedValue([]);
    expect((await call({ status: "INACTIVE" })).status).toBe(200);
    expect(invalidateParentChildren).toHaveBeenCalledTimes(1);

    invalidateParentChildren.mockClear();
    expect((await call({ status: "BOGUS" })).status).toBe(400);
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });

  async function arrange(guardian: Record<string, unknown>) {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.studentGuardian.findFirst).mockResolvedValue(guardian as never);
    // changeGuardianLinkStatus re-reads isPrimary inside the transaction.
    vi.mocked(prisma.studentGuardian.findUnique).mockResolvedValue({ isPrimary: guardian.isPrimary } as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (cb: (tx: unknown) => unknown) => cb(prisma)) as never);
    vi.mocked(prisma.studentGuardian.update).mockImplementation((async ({ where, data }: { where: { id: string }; data: object }) => ({ id: where.id, ...data })) as never);
    return prisma;
  }
  const call = async (body: unknown) => {
    const { PATCH } = await import("../guardians/[id]/route");
    return PATCH(makePatchReq(body) as never, { params: Promise.resolve({ id: "g-1" }) });
  };

  it('writes status: "INACTIVE", isPrimary: false when deactivating', async () => {
    const prisma = await arrange(baseGuardian());
    vi.mocked(prisma.studentGuardian.findMany).mockResolvedValue([]);

    const res = await call({ status: "INACTIVE" });

    expect(res.status).toBe(200);
    expect(prisma.studentGuardian.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "g-1" }, data: { status: "INACTIVE", isPrimary: false } }),
    );
  });

  it("promotes the remaining active guardian when the primary is deactivated", async () => {
    const prisma = await arrange({ ...baseGuardian(), isPrimary: true });
    vi.mocked(prisma.studentGuardian.findMany).mockResolvedValue([
      { id: "g-2", relationship: "IBU", isPrimary: false, parent: { name: "Ibu Sari" } },
    ] as never);

    const res = await call({ status: "INACTIVE" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.studentGuardian.update).toHaveBeenCalledWith({ where: { id: "g-2" }, data: { isPrimary: true } });
    expect(body.promotedPrimary).toEqual({ id: "g-2", name: "Ibu Sari" });
    expect(body.noActiveGuardian).toBe(false);
  });

  it("promotes the guardian the admin chose, and rejects one who is not an active guardian of the student", async () => {
    const prisma = await arrange({ ...baseGuardian(), isPrimary: true });
    vi.mocked(prisma.studentGuardian.findMany).mockResolvedValue([
      { id: "g-2", relationship: "IBU", isPrimary: false, parent: { name: "Ibu Sari" } },
      { id: "g-3", relationship: "WALI", isPrimary: false, parent: { name: "Om Joko" } },
    ] as never);

    const ok = await call({ status: "INACTIVE", newPrimaryId: "g-3" });
    expect((await ok.json()).promotedPrimary).toEqual({ id: "g-3", name: "Om Joko" });

    const bad = await call({ status: "INACTIVE", newPrimaryId: "g-999" });
    expect(bad.status).toBe(400);
  });

  it("says so when the deactivated primary was the last active guardian", async () => {
    const prisma = await arrange({ ...baseGuardian(), isPrimary: true });
    vi.mocked(prisma.studentGuardian.findMany).mockResolvedValue([]);

    const body = await (await call({ status: "INACTIVE" })).json();

    expect(body.promotedPrimary).toBeNull();
    expect(body.noActiveGuardian).toBe(true);
  });

  it("reactivating keeps isPrimary untouched when another active primary exists", async () => {
    const prisma = await arrange({ ...baseGuardian(), status: "INACTIVE" });
    vi.mocked(prisma.studentGuardian.count).mockResolvedValue(1);

    const res = await call({ status: "ACTIVE" });

    expect(res.status).toBe(200);
    const arg = vi.mocked(prisma.studentGuardian.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({ status: "ACTIVE" });
  });

  it("reactivating into an empty primary slot makes that guardian the primary", async () => {
    const prisma = await arrange({ ...baseGuardian(), status: "INACTIVE" });
    vi.mocked(prisma.studentGuardian.count).mockResolvedValue(0);

    await call({ status: "ACTIVE" });

    const arg = vi.mocked(prisma.studentGuardian.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).toEqual({ status: "ACTIVE", isPrimary: true });
  });
});
