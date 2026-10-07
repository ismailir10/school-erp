import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

/**
 * Coverage for the two bulk-create invariants added to
 * app/api/students/route.ts POST:
 *
 * P0 — client-supplied `isPrimary` on the guardians array is unchecked
 * before landing in `studentGuardian.createMany`. Two guardians flagged
 * primary must be rejected before anything is created; zero flagged
 * primary must normalize to index 0 winning.
 *
 * P1 — a guardian email colliding with an existing Employee account must
 * be rejected before any writes, mirroring the per-add guard in
 * app/api/students/[id]/guardians/route.ts.
 */

vi.mock("@/lib/db", () => ({
  prisma: {
    student: { create: vi.fn() },
    employee: { findFirst: vi.fn() },
    parent: { create: vi.fn(), upsert: vi.fn() },
    studentGuardian: { createMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

const { invalidateParentChildren } = vi.hoisted(() => ({ invalidateParentChildren: vi.fn() }));
vi.mock("@/lib/parent-helpers", () => ({ invalidateParentChildren }));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

function makeReq(body: unknown) {
  return new Request("http://localhost:3000/api/students", {
    method: "POST",
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

describe("POST /api/students — bulk guardian invariants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when 2 guardians are both isPrimary:true, creates nothing", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());

    const { POST } = await import("../students/route");
    const res = await POST(
      makeReq({
        name: "Anak Satu",
        guardians: [
          { name: "Ayah", relationship: "AYAH", isPrimary: true },
          { name: "Ibu", relationship: "IBU", isPrimary: true },
        ],
      }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Hanya satu wali utama yang diperbolehkan.");
    expect(prisma.student.create).not.toHaveBeenCalled();
    expect(prisma.studentGuardian.createMany).not.toHaveBeenCalled();
  });

  it("normalizes to index 0 primary when no guardian is flagged primary", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.create).mockResolvedValue({ id: "s-new" } as never);
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parent.create)
      .mockResolvedValueOnce({ id: "p-1" } as never)
      .mockResolvedValueOnce({ id: "p-2" } as never);
    vi.mocked(prisma.studentGuardian.createMany).mockResolvedValue({ count: 2 } as never);

    const { POST } = await import("../students/route");
    const res = await POST(
      makeReq({
        name: "Anak Dua",
        guardians: [
          { name: "Ayah", relationship: "AYAH", isPrimary: false },
          { name: "Ibu", relationship: "IBU", isPrimary: false },
        ],
      }) as never,
    );

    expect(res.status).toBe(201);
    expect(prisma.studentGuardian.createMany).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.studentGuardian.createMany).mock.calls[0][0] as {
      data: { isPrimary: boolean }[];
    };
    expect(call.data).toHaveLength(2);
    expect(call.data[0].isPrimary).toBe(true);
    expect(call.data[1].isPrimary).toBe(false);
    // Guardians were linked after the write committed: evict the parent cache.
    expect(invalidateParentChildren).toHaveBeenCalledTimes(1);
  });

  it("does not evict the parent cache when no guardians are linked", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.student.create).mockResolvedValue({ id: "s-new" } as never);

    const { POST } = await import("../students/route");
    const res = await POST(makeReq({ name: "Anak Tanpa Wali" }) as never);

    expect(res.status).toBe(201);
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });

  it("does not evict the parent cache when the request is refused", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());

    const { POST } = await import("../students/route");
    const res = await POST(
      makeReq({
        name: "Anak Satu",
        guardians: [
          { name: "Ayah", relationship: "AYAH", isPrimary: true },
          { name: "Ibu", relationship: "IBU", isPrimary: true },
        ],
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(invalidateParentChildren).not.toHaveBeenCalled();
  });

  it("rejects when a guardian email matches an existing employee", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1" } as never);

    const { POST } = await import("../students/route");
    const res = await POST(
      makeReq({
        name: "Anak Tiga",
        guardians: [
          { name: "Ayah", relationship: "AYAH", email: "staff@school.id", isPrimary: true },
        ],
      }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "Email ini sudah digunakan oleh karyawan. Gunakan email lain untuk orang tua.",
    );
    expect(prisma.student.create).not.toHaveBeenCalled();
  });
});
