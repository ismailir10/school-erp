import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * class-picker-year-scoping cycle (T6) — ClassSection uniqueness widened from
 * (tenantId, academicYearId, name) to (tenantId, academicYearId, campusId,
 * name) (see prisma/migrations/20260729000000_class_section_unique_per_campus).
 *
 * Class names currently embed the campus token ("TK B Metland 3") purely to
 * dodge the old per-year-only unique key. A later task strips that token,
 * which is only safe once two campuses can independently hold the same class
 * name within one academic year. This is a mocked-Prisma unit test: it
 * asserts POST /api/admin/classes' behaviour and error copy on a P2002 from
 * the (now campus-scoped) unique index, not the database constraint itself.
 */

const { requirePermission, db, txMock } = vi.hoisted(() => {
  const txMock = {
    classTrack: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    classSection: { create: vi.fn() },
  };
  const db = {
    campus: { findFirst: vi.fn() },
    program: { findFirst: vi.fn() },
    orgConfig: { findFirst: vi.fn() },
    classSection: { findFirst: vi.fn() },
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
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/classes/year-guard", () => ({
  ensureYearWritableById: vi.fn(async () => ({
    ok: true,
    tenantId: "t1",
    yearStatus: "ACTIVE",
  })),
}));
vi.mock("@/lib/sessions/reconcile", () => ({
  reconcileSessions: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/admin/classes/route";

const ALLOW = {
  session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" },
};

function req(body: unknown) {
  return new Request("http://t/api/admin/classes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const VALID_BODY = {
  campusId: "campus-metland",
  programId: "prog-tk",
  academicYearId: "year-2026",
  name: "TK B",
  capacity: 20,
  slotTemplate: "FULL_DAY",
  ageGroup: "B",
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ALLOW);
  db.campus.findFirst.mockResolvedValue({ id: "campus-metland" });
  db.program.findFirst.mockResolvedValue({ id: "prog-tk" });
  db.classSection.findFirst.mockResolvedValue(null);
  txMock.classTrack.findFirst.mockResolvedValue(null);
  txMock.classTrack.create.mockResolvedValue({ id: "track-1" });
  txMock.classTrack.update.mockResolvedValue({ id: "track-existing" });
});

function p2002() {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`tenantId`,`academicYearId`,`campusId`,`name`)",
    {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["tenantId", "academicYearId", "campusId", "name"] },
    },
  );
}

describe("POST /api/admin/classes — unique per (year, campus, name)", () => {
  it("same name + same year at DIFFERENT campuses both succeed", async () => {
    txMock.classSection.create.mockResolvedValueOnce({
      id: "cs-metland",
      name: "TK B",
      capacity: 20,
      campusId: "campus-metland",
    });

    const res1 = await POST(req(VALID_BODY));
    expect(res1.status).toBe(201);

    // Second campus, same name + same year — must NOT collide.
    db.campus.findFirst.mockResolvedValue({ id: "campus-aster" });
    txMock.classSection.create.mockResolvedValueOnce({
      id: "cs-aster",
      name: "TK B",
      capacity: 20,
      campusId: "campus-aster",
    });

    const res2 = await POST(
      req({ ...VALID_BODY, campusId: "campus-aster" }),
    );
    expect(res2.status).toBe(201);

    const body2 = await res2.json();
    expect(body2.id).toBe("cs-aster");
  });

  it("same name + same year at the SAME campus returns 409 with campus+year copy", async () => {
    txMock.classSection.create.mockRejectedValueOnce(p2002());

    const res = await POST(req(VALID_BODY));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(
      "Kelas dengan nama ini sudah ada di kampus dan tahun ajaran tersebut.",
    );
  });

  it("ADM-15: a name that differs only by case at the same campus + year returns 409 before creating anything", async () => {
    db.classSection.findFirst.mockResolvedValueOnce({ id: "cs-1", name: "TK B" });

    const res = await POST(req({ ...VALID_BODY, name: "  tk b " }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "Kelas dengan nama ini sudah ada di kampus dan tahun ajaran tersebut.",
    );
    expect(db.classSection.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        academicYearId: "year-2026",
        campusId: "campus-metland",
        name: { equals: "tk b", mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    expect(txMock.classSection.create).not.toHaveBeenCalled();
  });

  it("ADM-15: reuses an existing class track whose name matches ignoring case", async () => {
    txMock.classTrack.findFirst.mockResolvedValueOnce({ id: "track-existing" });
    txMock.classSection.create.mockResolvedValueOnce({
      id: "cs-new",
      name: "tk b",
      capacity: 20,
      campusId: "campus-metland",
    });

    const res = await POST(req({ ...VALID_BODY, name: "tk b" }));

    expect(res.status).toBe(201);
    expect(txMock.classTrack.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { equals: "tk b", mode: "insensitive" },
        }),
      }),
    );
    expect(txMock.classTrack.create).not.toHaveBeenCalled();
    expect(txMock.classTrack.update).toHaveBeenCalledWith({
      where: { id: "track-existing" },
      data: { status: "ACTIVE" },
    });
    expect(txMock.classSection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ classTrackId: "track-existing" }),
      }),
    );
  });
});
