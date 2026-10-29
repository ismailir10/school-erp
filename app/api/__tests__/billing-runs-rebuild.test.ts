import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory tx mock factory — mirrors the style in
// app/api/__tests__/billing-runs.test.ts. materializeBillingRun's reads run
// OUTSIDE the transaction (against the plain `prisma` mock below), so only
// the delete + create calls need to be inside `txMock`.
const txMock = {
  // The route re-checks DRAFT and the COMMITTED-row count UNDER LOCK inside
  // the transaction, not only outside it — a concurrent commit flipping the
  // run to COMMITTING between the outer check and the delete would otherwise
  // have its rows deleted from under it. Hence billingRun.updateMany (the
  // conditional claim) and billingRunRow.count on the tx client too.
  billingRun: {
    updateMany: vi.fn(),
  },
  billingRunRow: {
    count: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  billingRunLine: {
    createMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    billingRun: { findFirst: vi.fn() },
    billingRunRow: { count: vi.fn(), findMany: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    programFeeStructure: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    studentGuardian: { findMany: vi.fn() },
    studentFeeAdjustment: { findMany: vi.fn().mockResolvedValue([]) },
    enrollmentLeave: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

import { POST as rebuildRun } from "../billing-runs/[id]/rebuild/route";
import { LEAVE_RECORDED_AFTER_DRAFT_REASON } from "@/lib/finance/leave-exclusion";

function makeReq(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function adminSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u-1",
    email: "admin@test.com",
    name: "Admin",
    role: "SUPER_ADMIN" as const,
    tenantId: "tnt-1",
    employeeId: null,
    parentId: null,
    permissions: [] as string[],
    customRoleCode: null,
    ...overrides,
  };
}

async function primeAdminSession(role: string = "SUPER_ADMIN") {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(adminSession({ role }) as never);
}

const draftRun = {
  id: "run-1",
  tenantId: "tnt-1",
  academicYearId: "ay-1",
  periodLabel: "April 2026",
  dueDate: "2026-04-30",
  status: "DRAFT",
  scope: { classSectionIds: ["cs-1"], includeStudentIds: [], excludeStudentIds: [] },
  createdAt: new Date(),
  committedAt: null,
  createdBy: "u-1",
};

/** Wire the materializer's reads (enrollments, fees, guardians) for a set of
 * eligible students, each in class section cs-1 / program p-A. */
function wireEligibleStudents(
  students: { id: string; name: string }[],
  feeAmount = 500_000,
) {
  return async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue(
      students.map((s) => ({
        id: `enr-${s.id}`,
        studentId: s.id,
        classSectionId: "cs-1",
        student: { id: s.id, name: s.name },
        classSection: { name: "TKIT A", programId: "p-A", program: { name: "TKIT" } },
      })) as never,
    );
    vi.mocked(prisma.programFeeStructure.findMany).mockResolvedValue([
      {
        programId: "p-A",
        feeComponentId: "fc-1",
        amount: feeAmount,
        feeComponent: { label: "SPP" },
      },
    ] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.studentGuardian.findMany).mockResolvedValue(
      students.map((s) => ({ studentId: s.id, parentId: "parent-1" })) as never,
    );
    vi.mocked(prisma.studentFeeAdjustment.findMany).mockResolvedValue([] as never);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.billingRun.updateMany.mockReset();
  txMock.billingRunRow.count.mockReset();
  txMock.billingRunRow.deleteMany.mockReset();
  txMock.billingRunRow.createMany.mockReset();
  txMock.billingRunLine.createMany.mockReset();
  // Default: the in-transaction claim wins and no row got committed while we
  // were reading. Individual tests override to exercise the lost-claim path.
  txMock.billingRun.updateMany.mockResolvedValue({ count: 1 });
  txMock.billingRunRow.count.mockResolvedValue(0);
  txMock.billingRunRow.deleteMany.mockResolvedValue({ count: 1 });
  txMock.billingRunRow.createMany.mockResolvedValue({ count: 1 });
  txMock.billingRunLine.createMany.mockResolvedValue({ count: 1 });
});

type OldExcludedRow = string | { studentId: string; error: string | null };

async function wireRun(run: typeof draftRun, committedRowCount = 0, excludedStudentIds: OldExcludedRow[] = []) {
  const { prisma } = await import("@/lib/db");
  vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(run as never);
  vi.mocked(prisma.billingRunRow.count).mockResolvedValue(committedRowCount as never);
  vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue(
    excludedStudentIds.map((r) =>
      typeof r === "string" ? { studentId: r, error: null } : r,
    ) as never,
  );
}

describe("POST /api/billing-runs/[id]/rebuild — auth guard", () => {
  it("returns 403 with no session, and nothing is read or written", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(403);
    expect(prisma.billingRun.findFirst).not.toHaveBeenCalled();
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
  });

  it("returns 403 for TEACHER role, and nothing is written", async () => {
    await primeAdminSession("TEACHER");

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(403);
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs/[id]/rebuild — tenant scoping", () => {
  it("404s cross-tenant, and nothing is written", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(null);

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-foreign/rebuild", { confirm: true }) as never,
      makeParams("run-foreign"),
    );
    expect(res.status).toBe(404);
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs/[id]/rebuild — validation", () => {
  it("returns 400 on a body without confirm: true, and nothing is written", async () => {
    await primeAdminSession();
    await wireRun(draftRun);

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", {}) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
  });

  it("returns 400 on a completely empty POST body, and nothing is written", async () => {
    await primeAdminSession();
    await wireRun(draftRun);

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild") as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(400);
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs/[id]/rebuild — status guards", () => {
  it("refuses a non-DRAFT run with 409, and nothing is deleted", async () => {
    await primeAdminSession();
    await wireRun({ ...draftRun, status: "COMMITTED" });

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(409);
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
    expect(txMock.billingRunRow.createMany).not.toHaveBeenCalled();
  });

  it("refuses a run with a COMMITTED row with 409, and nothing is deleted", async () => {
    await primeAdminSession();
    await wireRun(draftRun, /* committedRowCount */ 1);

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/sebagian/);
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
    expect(txMock.billingRunRow.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs/[id]/rebuild — happy path", () => {
  it("deletes the old rows and persists fresh BASE lines — manual edits are gone", async () => {
    await primeAdminSession();
    await wireRun(draftRun);
    const wire = wireEligibleStudents([{ id: "s-1", name: "Budi" }]);
    await wire();

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(200);

    expect(txMock.billingRunRow.deleteMany).toHaveBeenCalledTimes(1);
    expect(txMock.billingRunRow.deleteMany.mock.calls[0][0]).toMatchObject({
      where: { billingRunId: "run-1" },
    });

    expect(txMock.billingRunRow.createMany).toHaveBeenCalledTimes(1);
    const rowArgs = txMock.billingRunRow.createMany.mock.calls[0][0];
    expect(rowArgs.data).toHaveLength(1);
    expect(rowArgs.data[0]).toMatchObject({ studentId: "s-1", status: "PENDING" });

    expect(txMock.billingRunLine.createMany).toHaveBeenCalledTimes(1);
    const lineArgs = txMock.billingRunLine.createMany.mock.calls[0][0];
    expect(lineArgs.data).toHaveLength(1);
    // Freshly materialized lines only ever carry source BASE — a rebuild
    // can never resurrect a MANUAL or EDITED line, which is what "manual
    // edits are gone" means at the persistence layer.
    expect(lineArgs.data[0].source).toBe("BASE");
    expect(lineArgs.data[0].feeComponentId).toBe("fc-1");

    // deleteMany must run before createMany — a delete-then-create, not a
    // diff.
    const deleteOrder = txMock.billingRunRow.deleteMany.mock.invocationCallOrder[0];
    const createOrder = txMock.billingRunRow.createMany.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it("reflects a changed fee structure amount in the rebuilt line", async () => {
    await primeAdminSession();
    await wireRun(draftRun);
    const wire = wireEligibleStudents([{ id: "s-1", name: "Budi" }], /* feeAmount */ 750_000);
    await wire();

    await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );

    const lineArgs = txMock.billingRunLine.createMany.mock.calls[0][0];
    expect(String(lineArgs.data[0].amount)).toBe("750000");
    expect(String(lineArgs.data[0].finalAmount)).toBe("750000");
  });

  // Regression: the candidate query used to filter only on status + tenant.
  // Once T8 replaced first-wins dedup with a group-by (every ACTIVE row now
  // contributes fee lines), an unscoped query would bill a student for BOTH
  // years at once — 16 of 21 current-year students on staging carry a stale
  // ACTIVE row in the ARCHIVED prior year. The run's own academicYearId must
  // be part of the where-clause.
  it("scopes enrollment candidates to the run's academic year, so a stale ARCHIVED-year row cannot contribute fees", async () => {
    await primeAdminSession();
    await wireRun(draftRun);
    const wire = wireEligibleStudents([{ id: "s-1", name: "Budi" }]);
    await wire();

    await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );

    const { prisma } = await import("@/lib/db");
    const where = vi.mocked(prisma.studentEnrollment.findMany).mock.calls[0][0]?.where;
    expect(where?.classSection).toMatchObject({
      tenantId: draftRun.tenantId,
      academicYearId: draftRun.academicYearId,
    });
  });

  it("only resolves ACTIVE primary guardians as the billing parent", async () => {
    await primeAdminSession();
    await wireRun(draftRun);
    const wire = wireEligibleStudents([{ id: "s-1", name: "Budi" }]);
    await wire();

    await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );

    const { prisma } = await import("@/lib/db");
    const where = vi.mocked(prisma.studentGuardian.findMany).mock.calls[0][0]?.where;
    expect(where).toMatchObject({ isPrimary: true, status: "ACTIVE" });
  });

  it("drops a student who is no longer in scope", async () => {
    await primeAdminSession();
    // s-2 previously had a row on the draft (reflected via the EXCLUDED
    // snapshot below) but no longer resolves as an enrollment in scope —
    // simulating "left scope" (unenrolled / moved class).
    await wireRun(draftRun, 0, ["s-2"]);
    const wire = wireEligibleStudents([{ id: "s-1", name: "Budi" }]);
    await wire();

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(200);

    const rowArgs = txMock.billingRunRow.createMany.mock.calls[0][0];
    const studentIds = rowArgs.data.map((r: { studentId: string }) => r.studentId);
    expect(studentIds).toEqual(["s-1"]);
    expect(studentIds).not.toContain("s-2");

    // s-2's stale exclusion snapshot matched nothing in the freshly built
    // rows, so it is silently dropped rather than reapplied to nothing.
    const body = await res.json();
    expect(body.reappliedExclusions).toBe(0);
  });

  it("re-applies EXCLUDED by studentId and corrects the summary", async () => {
    await primeAdminSession();
    await wireRun(draftRun, 0, ["s-1"]);
    const wire = wireEligibleStudents([
      { id: "s-1", name: "Budi" },
      { id: "s-2", name: "Sari" },
    ]);
    await wire();

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reappliedExclusions).toBe(1);
    // The builder always returns summary.excluded === 0 (draft-time
    // exclusion happens post-creation, not at build time) — the route must
    // correct it to the re-applied count.
    expect(body.summary.excluded).toBe(1);
    expect(body.summary.pending).toBe(1);
    expect(body.summary.total).toBe(2);

    const rowArgs = txMock.billingRunRow.createMany.mock.calls[0][0];
    const s1Row = rowArgs.data.find((r: { studentId: string }) => r.studentId === "s-1");
    const s2Row = rowArgs.data.find((r: { studentId: string }) => r.studentId === "s-2");
    expect(s1Row.status).toBe("EXCLUDED");
    expect(s2Row.status).toBe("PENDING");
  });

  it("does NOT re-apply an exclusion that was made because a leave was recorded after the draft", async () => {
    await primeAdminSession();
    await wireRun(draftRun, 0, [
      { studentId: "s-1", error: LEAVE_RECORDED_AFTER_DRAFT_REASON },
      { studentId: "s-2", error: null },
    ]);
    await wireEligibleStudents([
      { id: "s-1", name: "Budi" },
      { id: "s-2", name: "Sari" },
    ])();

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the ordinary exclusion (s-2) is carried over; s-1 follows the new rules (PENDING here).
    expect(body.reappliedExclusions).toBe(1);
    const rowArgs = txMock.billingRunRow.createMany.mock.calls[0][0];
    const byStudent = Object.fromEntries(
      rowArgs.data.map((r: { studentId: string; status: string }) => [r.studentId, r.status]),
    );
    expect(byStudent).toEqual({ "s-1": "PENDING", "s-2": "EXCLUDED" });
  });

  it("rebuilds a leave-excluded student as SKIPPED_ON_LEAVE once the leave is in effect", async () => {
    await primeAdminSession();
    await wireRun(draftRun, 0, [{ studentId: "s-1", error: LEAVE_RECORDED_AFTER_DRAFT_REASON }]);
    await wireEligibleStudents([{ id: "s-1", name: "Budi" }])();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.enrollmentLeave.findMany).mockResolvedValueOnce([{ enrollmentId: "enr-s-1" }] as never);

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reappliedExclusions).toBe(0);
    expect(body.summary.skippedOnLeave).toBe(1);
    expect(body.summary.excluded).toBe(0);
    const rowArgs = txMock.billingRunRow.createMany.mock.calls[0][0];
    expect(rowArgs.data[0]).toMatchObject({ studentId: "s-1", status: "SKIPPED_ON_LEAVE" });
  });

  it("does not reapply EXCLUDED onto a row that is now SKIPPED_ALREADY_INVOICED", async () => {
    await primeAdminSession();
    await wireRun(draftRun, 0, ["s-1"]);
    const wire = wireEligibleStudents([{ id: "s-1", name: "Budi" }]);
    await wire();
    const { prisma } = await import("@/lib/db");
    // s-1 now already has an invoice for this exact periodLabel — the skip
    // reason is the stronger fact and must win over the stale exclusion.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([{ studentId: "s-1", periodLabel: "April 2026" }] as never);

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reappliedExclusions).toBe(0);

    const rowArgs = txMock.billingRunRow.createMany.mock.calls[0][0];
    expect(rowArgs.data[0]).toMatchObject({
      studentId: "s-1",
      status: "SKIPPED_ALREADY_INVOICED",
    });
  });
});

// The outer DRAFT / COMMITTED-row checks are check-then-act on their own: the
// commit route flips the run DRAFT -> COMMITTING and then claims rows inside
// its own transaction, so a commit starting between our check and our delete
// would have its rows deleted out from under it — invoices written against
// rows that no longer exist. Both conditions are therefore re-checked under
// the run's row lock inside the transaction, and these two tests are what
// prove the rebuild backs off rather than deleting.
describe("POST /api/billing-runs/[id]/rebuild — lost race against a concurrent commit", () => {
  it("aborts without deleting when the run stopped being DRAFT under the lock", async () => {
    await primeAdminSession();
    await wireRun(draftRun, 0, []);
    await wireEligibleStudents([{ id: "s-1", name: "Budi" }])();
    // The claim matches nothing — a concurrent commit already flipped the run.
    txMock.billingRun.updateMany.mockResolvedValue({ count: 0 });

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(409);
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
    expect(txMock.billingRunRow.createMany).not.toHaveBeenCalled();
  });

  it("aborts without deleting when a row got committed under the lock", async () => {
    await primeAdminSession();
    await wireRun(draftRun, 0, []);
    await wireEligibleStudents([{ id: "s-1", name: "Budi" }])();
    // Zero COMMITTED rows on the outer read, one by the time we hold the lock.
    txMock.billingRunRow.count.mockResolvedValue(1);

    const res = await rebuildRun(
      makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(409);
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
    expect(txMock.billingRunRow.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs/[id]/rebuild — malformed scope", () => {
  it("500s rather than silently rebuilding an empty run when scope is corrupt", async () => {
    await primeAdminSession();
    await wireRun({
      ...draftRun,
      scope: { classSectionIds: "not-an-array" } as unknown as typeof draftRun.scope,
    });

    await expect(
      rebuildRun(
        makeReq("http://localhost/api/billing-runs/run-1/rebuild", { confirm: true }) as never,
        makeParams("run-1"),
      ),
    ).rejects.toThrow();
    expect(txMock.billingRunRow.deleteMany).not.toHaveBeenCalled();
  });
});
