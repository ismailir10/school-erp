import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ADM-15 (rename): PUT/PATCH /api/admin/classes/[id] refuses a name that equals
 * another class's name ignoring case in the same year + campus, with the same
 * 409 copy as create and a `name` field error so the edit dialog shows it
 * inline. Renaming a class to a different casing of its own name is allowed.
 */

const { requirePermission, db, tx, recordAudit } = vi.hoisted(() => {
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
  return { requirePermission: vi.fn(), db, tx, recordAudit: vi.fn() };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/audit", () => ({ recordAudit }));
vi.mock("@/lib/classes/year-guard", () => ({
  ensureYearWritableForClass: vi.fn(),
}));

import { PATCH, PUT } from "@/app/api/admin/classes/[id]/route";
import { Prisma } from "@/lib/generated/prisma/client";
import { CLASS_NAME_CLASH_MESSAGE } from "@/lib/classes/name-clash";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" } };
const ctx = { params: Promise.resolve({ id: "c1" }) };

function req(body: unknown, method = "PATCH") {
  return new Request("http://localhost/api/admin/classes/c1", {
    method,
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
  academicYearId: "ay1",
  campusId: "cp1",
};

/** What the clash lookup (the findFirst call that filters by name) returns. */
let clash: { id: string; name: string } | null;

beforeEach(() => {
  vi.clearAllMocks();
  clash = null;
  requirePermission.mockResolvedValue(ALLOW);
  db.classSection.findFirst.mockImplementation(async (args: { where: { name?: unknown } }) =>
    args.where.name ? clash : BEFORE,
  );
  db.classSection.findFirstOrThrow.mockResolvedValue({ ...BEFORE, name: "TK B" });
});

const clashCalls = () =>
  db.classSection.findFirst.mock.calls.filter(([a]) => (a as { where: { name?: unknown } }).where.name);

describe("PATCH/PUT /api/admin/classes/[id] — rename uniqueness", () => {
  it("refuses a rename onto another class's name, ignoring case, with a name field error", async () => {
    clash = { id: "c2", name: "tk b" };

    const res = await PATCH(req({ name: "TK B" }), ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(CLASS_NAME_CLASH_MESSAGE);
    expect(body.field).toBe("name");
    expect(body.errors).toEqual([{ field: "name", message: CLASS_NAME_CLASH_MESSAGE }]);
    expect(tx.classSection.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the class's tenant, year and campus and excludes itself", async () => {
    await PATCH(req({ name: "  TK B  " }), ctx);

    expect(clashCalls()).toHaveLength(1);
    expect(clashCalls()[0][0]).toEqual({
      where: {
        tenantId: "t1",
        academicYearId: "ay1",
        campusId: "cp1",
        name: { equals: "TK B", mode: "insensitive" },
        id: { not: "c1" },
      },
      select: { id: true, name: true },
    });
  });

  it("PUT applies the same check", async () => {
    clash = { id: "c2", name: "TK B" };
    const res = await PUT(req({ name: "TK B" }, "PUT"), ctx);
    expect(res.status).toBe(409);
  });

  it("allows renaming to a free name", async () => {
    const res = await PATCH(req({ name: "TK B" }), ctx);

    expect(res.status).toBe(200);
    expect(tx.classSection.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", tenantId: "t1" },
      data: { name: "TK B" },
    });
  });

  it("allows a case-only change of the same class (excludeId keeps it from clashing with itself)", async () => {
    const res = await PATCH(req({ name: "Tk A" }), ctx);

    expect(res.status).toBe(200);
    expect(clashCalls()).toHaveLength(1);
    expect(clashCalls()[0][0].where.id).toEqual({ not: "c1" });
    expect(tx.classSection.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", tenantId: "t1" },
      data: { name: "Tk A" },
    });
  });

  it("skips the lookup when the name is unchanged or not sent", async () => {
    await PATCH(req({ name: "TK A", capacity: 6 }), ctx);
    await PATCH(req({ capacity: 6 }), ctx);

    expect(clashCalls()).toHaveLength(0);
  });

  it("the DB unique backstop (a lost race) lands on the name field too", async () => {
    tx.classSection.updateMany.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }));

    const res = await PATCH(req({ name: "TK B" }), ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.field).toBe("name");
    expect(body.error).toBe(CLASS_NAME_CLASH_MESSAGE);
  });
});
