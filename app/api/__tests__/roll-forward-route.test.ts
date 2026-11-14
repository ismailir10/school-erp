import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Integration tests for the Task 5 roll-forward endpoint:
 *   POST /api/admin/academic-years/[id]/roll-forward
 *
 * Covers: clones ACTIVE sections under ACTIVE tracks into the target year;
 * skips a track already rolled (P2002) without aborting; ignores INACTIVE
 * sections / tracks (asserted via the findMany where-clause); 404 on
 * cross-tenant / missing source-or-target year; 400 when source === target;
 * reconcile failure is non-fatal; `trackIds` narrows the set.
 *
 * `reconcileSessions` is mocked — these tests assert the route wiring, not
 * reconcile's own behaviour.
 */

const reconcileSessions = vi.fn();
vi.mock("@/lib/sessions/reconcile", () => ({
  reconcileSessions: (...args: unknown[]) => reconcileSessions(...args),
  SESSION_BATCH_TOO_LARGE: "session_batch_too_large",
}));

const academicYearFindFirst = vi.fn();
const classSectionFindMany = vi.fn();
const classSectionCreate = vi.fn();
const auditLogCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    academicYear: { findFirst: academicYearFindFirst },
    classSection: { findMany: classSectionFindMany, create: classSectionCreate },
    auditLog: { create: auditLogCreate },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) =>
  await importOriginal<typeof import("@/lib/rate-limit")>(),
);

const adminSession = {
  id: "u-admin",
  email: "admin@demo.local",
  name: "Admin",
  role: "SUPER_ADMIN" as const,
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: [],
  customRoleCode: null,
};

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function srcSection(over: Partial<Record<string, unknown>> = {}) {
  return {
    classTrackId: "track-1",
    programId: "prog-1",
    campusId: "camp-1",
    name: "TKIT A",
    capacity: 20,
    slotTemplate: "FULL_DAY",
    ...over,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { __resetRateLimitForTest } = await import("@/lib/rate-limit");
  __resetRateLimitForTest();
  reconcileSessions.mockResolvedValue({
    classSectionId: "cs-new",
    added: 0,
    deletedEmpty: 0,
    keptNonEmpty: 0,
    warnings: [],
  });
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(adminSession);
  // Both years exist + belong to the tenant by default.
  academicYearFindFirst.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve({ id: where.id }),
  );
});

async function call(targetId: string, body: unknown) {
  const { POST } = await import(
    "@/app/api/admin/academic-years/[id]/roll-forward/route"
  );
  return POST(
    jsonReq(`http://l/api/admin/academic-years/${targetId}/roll-forward`, body) as never,
    { params: Promise.resolve({ id: targetId }) } as never,
  );
}

describe("POST /api/admin/academic-years/[id]/roll-forward", () => {
  it("clones ACTIVE sections under ACTIVE tracks into the target year + reconciles each", async () => {
    classSectionFindMany.mockResolvedValue([
      srcSection({ classTrackId: "track-1", name: "TKIT A" }),
      srcSection({ classTrackId: "track-2", name: "TKIT B" }),
    ]);
    classSectionCreate
      .mockResolvedValueOnce({ id: "cs-a" })
      .mockResolvedValueOnce({ id: "cs-b" });

    const res = await call("ay-target", { sourceYearId: "ay-source", trackIds: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sectionsCreated).toBe(2);
    expect(body.tracksSkippedAlreadyRolled).toBe(0);
    expect(body.sessionsReconcileFailed).toBe(0);

    // findMany scoped to ACTIVE sections under ACTIVE tracks, source year + tenant.
    expect(classSectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          academicYearId: "ay-source",
          tenantId: "t-1",
          status: "ACTIVE",
          classTrack: { status: "ACTIVE" },
        }),
      }),
    );
    // Created in the target year with ACTIVE status, copying track identity.
    expect(classSectionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          academicYearId: "ay-target",
          tenantId: "t-1",
          classTrackId: "track-1",
          slotTemplate: "FULL_DAY",
          status: "ACTIVE",
        }),
      }),
    );
    expect(reconcileSessions).toHaveBeenCalledTimes(2);
    expect(reconcileSessions).toHaveBeenCalledWith("cs-a");
    expect(reconcileSessions).toHaveBeenCalledWith("cs-b");
  });

  it("skips a track already rolled (P2002) without aborting the run", async () => {
    classSectionFindMany.mockResolvedValue([
      srcSection({ classTrackId: "track-1", name: "TKIT A" }),
      srcSection({ classTrackId: "track-2", name: "TKIT B" }),
    ]);
    // First create conflicts (already rolled), second succeeds.
    classSectionCreate
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce({ id: "cs-b" });

    const res = await call("ay-target", { sourceYearId: "ay-source" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sectionsCreated).toBe(1);
    expect(body.tracksSkippedAlreadyRolled).toBe(1);
    // Skipped diagnostic carries the stable classTrackId, not just the name.
    expect(body.skippedTracks).toEqual([
      { classTrackId: "track-1", name: "TKIT A" },
    ]);
    // The run continued — second section still created + reconciled.
    expect(classSectionCreate).toHaveBeenCalledTimes(2);
    expect(reconcileSessions).toHaveBeenCalledTimes(1);
    expect(reconcileSessions).toHaveBeenCalledWith("cs-b");
  });

  it("propagates a non-P2002 prisma error — not swallowed as already-rolled", async () => {
    classSectionFindMany.mockResolvedValue([
      srcSection({ classTrackId: "track-1", name: "TKIT A" }),
    ]);
    // A different known prisma error (P2025) must bubble — only P2002 is the
    // idempotent "already rolled" skip path.
    classSectionCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Record not found", {
        code: "P2025",
        clientVersion: "test",
      }),
    );
    await expect(
      call("ay-target", { sourceYearId: "ay-source" }),
    ).rejects.toThrow();
    // The conflict path did NOT run — nothing reconciled.
    expect(reconcileSessions).not.toHaveBeenCalled();
  });

  it("propagates a generic error from classSection.create", async () => {
    classSectionFindMany.mockResolvedValue([
      srcSection({ classTrackId: "track-1", name: "TKIT A" }),
    ]);
    classSectionCreate.mockRejectedValueOnce(new Error("db down"));
    await expect(
      call("ay-target", { sourceYearId: "ay-source" }),
    ).rejects.toThrow("db down");
  });

  it("sets truncated:true when the source-section cap is hit", async () => {
    // Exactly MAX_SOURCE_SECTIONS (200) rows back → there may be more to roll.
    const sections = Array.from({ length: 200 }, (_, i) =>
      srcSection({ classTrackId: `track-${i}`, name: `Kelas ${i}` }),
    );
    classSectionFindMany.mockResolvedValue(sections);
    classSectionCreate.mockImplementation(() =>
      Promise.resolve({ id: "cs-x" }),
    );

    const res = await call("ay-target", { sourceYearId: "ay-source" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.sectionsCreated).toBe(200);
    // findMany was called with a take cap.
    expect(classSectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it("sets truncated:false when results are under the cap", async () => {
    classSectionFindMany.mockResolvedValue([srcSection()]);
    classSectionCreate.mockResolvedValueOnce({ id: "cs-a" });
    const res = await call("ay-target", { sourceYearId: "ay-source" });
    const body = await res.json();
    expect(body.truncated).toBe(false);
  });

  it("returns 0 created when no source sections are eligible (still 200)", async () => {
    classSectionFindMany.mockResolvedValue([]);
    const res = await call("ay-target", { sourceYearId: "ay-source" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sectionsCreated).toBe(0);
    expect(classSectionCreate).not.toHaveBeenCalled();
    expect(reconcileSessions).not.toHaveBeenCalled();
  });

  it("404 when the source year is missing or cross-tenant", async () => {
    academicYearFindFirst.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === "ay-target" ? { id: "ay-target" } : null),
    );
    const res = await call("ay-target", { sourceYearId: "ay-source" });
    expect(res.status).toBe(404);
    expect(classSectionFindMany).not.toHaveBeenCalled();
  });

  it("404 when the target year is missing or cross-tenant", async () => {
    academicYearFindFirst.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === "ay-source" ? { id: "ay-source" } : null),
    );
    const res = await call("ay-target", { sourceYearId: "ay-source" });
    expect(res.status).toBe(404);
    expect(classSectionFindMany).not.toHaveBeenCalled();
  });

  it("400 when source === target", async () => {
    const res = await call("ay-same", { sourceYearId: "ay-same" });
    expect(res.status).toBe(400);
    expect(academicYearFindFirst).not.toHaveBeenCalled();
  });

  it("400 on invalid body (missing sourceYearId)", async () => {
    const res = await call("ay-target", { trackIds: [] });
    expect(res.status).toBe(400);
  });

  it("403 for a non-admin session", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue({ ...adminSession, role: "TEACHER" as const });
    const res = await call("ay-target", { sourceYearId: "ay-source" });
    expect(res.status).toBe(403);
  });

  it("reconcile failure is non-fatal — section still counted as created", async () => {
    classSectionFindMany.mockResolvedValue([srcSection()]);
    classSectionCreate.mockResolvedValueOnce({ id: "cs-a" });
    reconcileSessions.mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await call("ay-target", { sourceYearId: "ay-source" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sectionsCreated).toBe(1);
    expect(body.sessionsReconcileFailed).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("trackIds filter narrows the findMany query", async () => {
    classSectionFindMany.mockResolvedValue([]);
    await call("ay-target", { sourceYearId: "ay-source", trackIds: ["track-1", "track-2"] });
    expect(classSectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          classTrackId: { in: ["track-1", "track-2"] },
        }),
      }),
    );
  });
});

it("rejects copying classes into an archived year before creating any class", async () => {
  academicYearFindFirst.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, status: where.id === "target" ? "ARCHIVED" : "ACTIVE" }));
  const res = await call("target", { sourceYearId: "source" });
  expect(res.status).toBe(409);
  expect(classSectionCreate).not.toHaveBeenCalled();
  expect(classSectionFindMany).not.toHaveBeenCalled();
});
