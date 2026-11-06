import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermission, db, txMock } = vi.hoisted(() => {
  const txMock = {
    $queryRaw: vi.fn(),
    classSection: { findMany: vi.fn() },
    sentra: { findMany: vi.fn(), update: vi.fn() },
    sentraTeacher: { deleteMany: vi.fn(), createMany: vi.fn() },
    sentraRotation: { findFirst: vi.fn(), update: vi.fn() },
    sentraRotationClass: { findMany: vi.fn() },
    sentraRotationSlot: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const db = {
    campus: { findFirst: vi.fn() },
    employee: { findMany: vi.fn() },
    sentra: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    academicYear: { findFirst: vi.fn() },
    classSection: { findMany: vi.fn() },
    sentraRotation: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
  };
  return { requirePermission: vi.fn(), db, txMock };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

import { GET as listGet, POST as sentraPost } from "@/app/api/admin/sentra/route";
import { PATCH as sentraPatch } from "@/app/api/admin/sentra/[id]/route";
import { GET as optionsGet } from "@/app/api/admin/sentra/options/route";
import { POST as rotationPost } from "@/app/api/admin/sentra/rotations/route";
import { GET as rotationGet, PATCH as rotationPatch } from "@/app/api/admin/sentra/rotations/[id]/route";
import { PUT as slotsPut } from "@/app/api/admin/sentra/rotations/[id]/slots/route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" } };

function deny(status: number, body: object) {
  return { error: Response.json(body, { status }) };
}

function req(method: string, body?: unknown, qs = "") {
  return new Request(`http://t/api/admin/sentra${qs}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ALLOW);
});

describe("permissions", () => {
  it("401 when unauthenticated", async () => {
    requirePermission.mockResolvedValue(deny(401, { error: "unauthorized" }));
    expect((await listGet(req("GET", undefined, "?campusId=c1"))).status).toBe(401);
  });

  it("view permission gates GET, edit gates writes", async () => {
    requirePermission.mockImplementation(async (perm: string) =>
      perm === "academic.view" ? ALLOW : deny(403, { error: "forbidden" }),
    );
    db.campus.findFirst.mockResolvedValue({ id: "c1" });
    db.sentra.findMany.mockResolvedValue([]);
    db.sentraRotation.findMany.mockResolvedValue([]);
    expect((await listGet(req("GET", undefined, "?campusId=c1"))).status).toBe(200);
    expect(
      (await sentraPost(req("POST", { campusId: "c1", name: "Balok", teacherIds: [] }))).status,
    ).toBe(403);
    expect((await sentraPatch(req("PATCH", { name: "x" }), params("s1"))).status).toBe(403);
    expect(
      (await slotsPut(req("PUT", { slots: [] }), params("r1"))).status,
    ).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith("academic.edit");
  });
});

describe("tenant scope", () => {
  it("404 for another tenant's campus", async () => {
    db.campus.findFirst.mockResolvedValue(null);
    const res = await listGet(req("GET", undefined, "?campusId=other"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/tidak ditemukan/);
    expect((await optionsGet(req("GET", undefined, "?campusId=other"))).status).toBe(404);
    expect(
      (await sentraPost(req("POST", { campusId: "other", name: "A", teacherIds: [] }))).status,
    ).toBe(404);
    expect(db.campus.findFirst.mock.calls[0][0].where).toEqual({
      id: "other",
      tenantId: "t1",
    });
  });

  it("404 for another tenant's sentra and rotation", async () => {
    db.sentra.findFirst.mockResolvedValue(null);
    db.sentraRotation.findFirst.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([]);
    expect((await sentraPatch(req("PATCH", { name: "x" }), params("s9"))).status).toBe(404);
    expect((await rotationGet(req("GET"), params("r9"))).status).toBe(404);
    expect((await rotationPatch(req("PATCH", { name: "x" }), params("r9"))).status).toBe(404);
    expect((await slotsPut(req("PUT", { slots: [] }), params("r9"))).status).toBe(404);
  });
});

describe("POST /api/admin/sentra", () => {
  const body = { campusId: "c1", name: " Balok ", teacherIds: ["e1"] };

  beforeEach(() => {
    db.campus.findFirst.mockResolvedValue({ id: "c1" });
    db.employee.findMany.mockResolvedValue([{ id: "e1" }]);
    db.sentra.findFirst.mockResolvedValue(null);
    db.sentra.create.mockResolvedValue({ id: "s1" });
  });

  it("creates with 201 and trimmed name", async () => {
    const res = await sentraPost(req("POST", body));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "s1" });
    expect(db.sentra.create.mock.calls[0][0].data.name).toBe("Balok");
  });

  it("409 on duplicate name", async () => {
    db.sentra.findFirst.mockResolvedValue({ id: "s0" });
    const res = await sentraPost(req("POST", body));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Nama sentra sudah dipakai di kampus ini");
  });

  it("400 when a teacher is not an active employee of the campus", async () => {
    db.employee.findMany.mockResolvedValue([]);
    const res = await sentraPost(req("POST", body));
    expect(res.status).toBe(400);
    expect(db.employee.findMany.mock.calls[0][0].where).toMatchObject({
      campusId: "c1",
      tenantId: "t1",
      status: "ACTIVE",
    });
    expect(db.sentra.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/sentra/[id]", () => {
  it("replaces the teacher set in a transaction", async () => {
    db.sentra.findFirst.mockResolvedValue({ id: "s1", campusId: "c1" });
    db.employee.findMany.mockResolvedValue([{ id: "e2" }, { id: "e3" }]);
    const res = await sentraPatch(
      req("PATCH", { teacherIds: ["e2", "e3"], status: "INACTIVE" }),
      params("s1"),
    );
    expect(res.status).toBe(200);
    expect(txMock.sentra.update.mock.calls[0][0].data).toEqual({ status: "INACTIVE" });
    expect(txMock.sentraTeacher.deleteMany).toHaveBeenCalledWith({ where: { sentraId: "s1" } });
    expect(txMock.sentraTeacher.createMany.mock.calls[0][0].data).toHaveLength(2);
  });
});

describe("POST /api/admin/sentra/rotations", () => {
  const body = {
    campusId: "c1",
    academicYearId: "y1",
    name: "Putaran TK",
    startDate: "2026-11-07", // Saturday
    cycleDays: 10,
    classSectionIds: ["k1", "k2"],
  };

  beforeEach(() => {
    db.campus.findFirst.mockResolvedValue({ id: "c1" });
    db.academicYear.findFirst.mockResolvedValue({ id: "y1" });
    db.classSection.findMany.mockResolvedValue([{ id: "k1" }, { id: "k2" }]);
    db.sentraRotation.findFirst.mockResolvedValue(null);
    db.sentraRotation.create.mockResolvedValue({ id: "r1" });
  });

  it("normalizes a Saturday start to Monday", async () => {
    const res = await rotationPost(req("POST", body));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "r1" });
    expect(db.sentraRotation.create.mock.calls[0][0].data.startDate).toBe("2026-11-09");
  });

  it("400 when a class belongs to another campus or year", async () => {
    db.classSection.findMany.mockResolvedValue([{ id: "k1" }]);
    const res = await rotationPost(req("POST", body));
    expect(res.status).toBe(400);
    expect(db.classSection.findMany.mock.calls[0][0].where).toMatchObject({
      campusId: "c1",
      academicYearId: "y1",
      tenantId: "t1",
    });
    expect(db.sentraRotation.create).not.toHaveBeenCalled();
  });

  it("409 on duplicate name", async () => {
    db.sentraRotation.findFirst.mockResolvedValue({ id: "r0" });
    expect((await rotationPost(req("POST", body))).status).toBe(409);
  });
});

const rotationRow = { id: "r1", campusId: "c1", academicYearId: "y1", cycleDays: 10 };

function expectRotationLock() {
  const [sql, id, tenantId] = txMock.$queryRaw.mock.calls[0];
  expect(sql.join("?")).toMatch(/WHERE id = \? AND "tenantId" = \?\s+FOR UPDATE/);
  expect([id, tenantId]).toEqual(["r1", "t1"]);
}

describe("PATCH rotations/[id]", () => {
  it("locks the rotation before updating and prunes slots using the requested length", async () => {
    db.sentraRotation.findFirst.mockResolvedValue(rotationRow);
    txMock.$queryRaw.mockResolvedValue([{ ...rotationRow, cycleDays: 15 }]);
    const res = await rotationPatch(req("PATCH", { cycleDays: 10 }), params("r1"));

    expect(res.status).toBe(200);
    expectRotationLock();
    expect(txMock.$queryRaw).toHaveBeenCalledBefore(txMock.sentraRotation.update);
    expect(txMock.sentraRotationSlot.deleteMany).toHaveBeenCalledWith({
      where: { rotationId: "r1", tenantId: "t1", dayIndex: { gte: 10 } },
    });
  });
});

describe("PUT rotations/[id]/slots", () => {
  beforeEach(() => {
    const classes = [
      { classSectionId: "k1" },
      { classSectionId: "k2" },
    ];
    db.sentraRotation.findFirst.mockResolvedValue({ ...rotationRow, classes });
    db.sentra.findMany.mockResolvedValue([{ id: "s1" }]);
    txMock.$queryRaw.mockResolvedValue([rotationRow]);
    txMock.sentraRotationClass.findMany.mockResolvedValue(classes);
    txMock.sentra.findMany.mockResolvedValue([{ id: "s1" }]);
  });

  it("rejects a stale grid when the locked rotation was shortened", async () => {
    txMock.$queryRaw.mockResolvedValue([{ ...rotationRow, cycleDays: 5 }]);
    const res = await slotsPut(
      req("PUT", { slots: [{ dayIndex: 5, classSectionId: "k1", sentraId: "s1" }] }),
      params("r1"),
    );
    expect(res.status).toBe(400);
    expectRotationLock();
    expect(txMock.sentraRotationSlot.deleteMany).not.toHaveBeenCalled();
  });

  it("400 when the sentra is not an active sentra of the campus", async () => {
    txMock.sentra.findMany.mockResolvedValue([]);
    const res = await slotsPut(
      req("PUT", { slots: [{ dayIndex: 0, classSectionId: "k1", sentraId: "sX" }] }),
      params("r1"),
    );
    expect(res.status).toBe(400);
    expect(txMock.sentra.findMany.mock.calls[0][0].where).toMatchObject({
      campusId: "c1",
      status: "ACTIVE",
      tenantId: "t1",
    });
  });

  it("reads class membership after locking and rejects a stale grid when a class was removed", async () => {
    txMock.sentraRotationClass.findMany.mockResolvedValue([{ classSectionId: "k1" }]);
    const res = await slotsPut(
      req("PUT", { slots: [{ dayIndex: 0, classSectionId: "k2", sentraId: "s1" }] }),
      params("r1"),
    );
    expect(res.status).toBe(400);
    expectRotationLock();
    expect(txMock.$queryRaw).toHaveBeenCalledBefore(txMock.sentraRotationClass.findMany);
    expect(txMock.sentraRotationSlot.deleteMany).not.toHaveBeenCalled();
  });

  it("drops null cells and allows the same sentra twice on a day", async () => {
    const res = await slotsPut(
      req("PUT", {
        slots: [
          { dayIndex: 0, classSectionId: "k1", sentraId: "s1" },
          { dayIndex: 0, classSectionId: "k2", sentraId: "s1" },
          { dayIndex: 1, classSectionId: "k1", sentraId: null },
        ],
      }),
      params("r1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 2 });
    expect(txMock.$queryRaw).toHaveBeenCalledBefore(txMock.sentraRotationSlot.deleteMany);
    expect(txMock.sentraRotationSlot.deleteMany).toHaveBeenCalledWith({
      where: { rotationId: "r1", tenantId: "t1" },
    });
    expect(txMock.sentraRotationSlot.createMany.mock.calls[0][0].data).toHaveLength(2);
  });
});
