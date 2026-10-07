import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ADM-5 (admin-core-guards): PUT/PATCH /api/admin/classes/[id] must not lower
 * capacity below the ACTIVE roster ("2/1"). Equal-to-count is allowed, and an
 * unchanged capacity never trips the guard.
 */

const { requirePermission, db, tx } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    studentEnrollment: { count: vi.fn() },
    classSection: { updateMany: vi.fn() },
    classTrack: { updateMany: vi.fn() },
  };
  const db = {
    classSection: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { requirePermission: vi.fn(), db, tx };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/classes/year-guard", () => ({
  ensureYearWritableForClass: vi.fn(),
}));

import { PATCH, PUT } from "@/app/api/admin/classes/[id]/route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" } };
const ctx = { params: Promise.resolve({ id: "c1" }) };

function req(body: unknown) {
  return new Request("http://localhost/api/admin/classes/c1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const BEFORE = {
  id: "c1",
  name: "TK A",
  capacity: 5,
  slotTemplate: "FULL_DAY",
  ageGroup: "A",
  status: "ACTIVE",
  classTrackId: "ct1",
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ALLOW);
  db.classSection.findFirst.mockResolvedValue(BEFORE);
  db.classSection.findFirstOrThrow.mockResolvedValue({ ...BEFORE, capacity: 2 });
  tx.studentEnrollment.count.mockResolvedValue(2);
});

describe("PATCH /api/admin/classes/[id] — capacity vs roster", () => {
  it("rejects capacity below the ACTIVE roster with a 409 on the capacity field", async () => {
    const res = await PATCH(req({ capacity: 1 }), ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(
      "Kapasitas tidak bisa lebih kecil dari jumlah siswa aktif (2 siswa).",
    );
    expect(body.field).toBe("capacity");
    expect(body.errors).toEqual([{ field: "capacity", message: body.error }]);
    expect(tx.classSection.updateMany).not.toHaveBeenCalled();
    // Only ACTIVE enrolments count toward the roster.
    expect(tx.studentEnrollment.count).toHaveBeenCalledWith({
      where: { classSectionId: "c1", status: "ACTIVE" },
    });
  });

  it("allows capacity equal to the ACTIVE roster", async () => {
    const res = await PATCH(req({ capacity: 2 }), ctx);

    expect(res.status).toBe(200);
    expect(tx.classSection.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", tenantId: "t1" },
      data: { capacity: 2 },
    });
  });

  it("PUT enforces the same guard", async () => {
    const res = await PUT(req({ capacity: 1 }), ctx);
    expect(res.status).toBe(409);
  });

  it("does not block unrelated edits when capacity is unchanged on an already-overfull class", async () => {
    tx.studentEnrollment.count.mockResolvedValue(9);
    const res = await PATCH(req({ name: "TK A2", capacity: 5 }), ctx);

    expect(res.status).toBe(200);
    expect(tx.studentEnrollment.count).not.toHaveBeenCalled();
  });

  it("does not count the roster when capacity is not part of the edit", async () => {
    const res = await PATCH(req({ name: "TK A2" }), ctx);

    expect(res.status).toBe(200);
    expect(tx.studentEnrollment.count).not.toHaveBeenCalled();
  });
});
