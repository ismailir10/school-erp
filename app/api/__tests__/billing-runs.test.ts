import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory tx mock factory — each test rewires the per-call return values.
// Mirrors the style in app/api/__tests__/invoices-generate-batch.test.ts.
const txMock = {
  billingRun: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  billingRunRow: {
    createMany: vi.fn(),
  },
  billingRunLine: {
    createMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    academicYear: { findFirst: vi.fn() },
    classSection: { findMany: vi.fn() },
    student: { findMany: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    programFeeStructure: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    studentGuardian: { findMany: vi.fn() },
    studentFeeAdjustment: { findMany: vi.fn().mockResolvedValue([]) },
    billingRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    billingRunRow: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
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

import { GET as listRuns, POST as createRun } from "../billing-runs/route";
import { GET as getRun, PATCH as cancelRun } from "../billing-runs/[id]/route";
import { PATCH as patchRow } from "../billing-runs/[id]/rows/[rowId]/route";

function makeReq(url: string, body?: unknown, method: "GET" | "POST" | "PATCH" = body ? "POST" : "GET") {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRowParams(id: string, rowId: string) {
  return { params: Promise.resolve({ id, rowId }) };
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

const validCreateBody = {
  periodLabel: "April 2026",
  dueDate: "2026-04-30",
  academicYearId: "ay-1",
  classSectionIds: ["cs-1"],
  includeStudentIds: [] as string[],
  excludeStudentIds: [] as string[],
};

async function primeAdminSession(role: string = "SUPER_ADMIN") {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(adminSession({ role }) as never);
  // The create route verifies academicYearId against the tenant before any
  // other read. Default it to found; the cross-tenant test overrides it.
  const { prisma } = await import("@/lib/db");
  vi.mocked(prisma.academicYear.findFirst).mockResolvedValue({ id: "ay-1" } as never);
}

/** Wire the read side (class sections, enrollments, fees, guardians) for a
 * single eligible student in a single in-tenant class section. */
function wireSingleEligibleStudent() {
  return async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.classSection.findMany).mockResolvedValue([{ id: "cs-1", academicYearId: "ay-1" }] as never);
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.studentEnrollment.findMany).mockResolvedValue([
      {
        studentId: "s-1",
        classSectionId: "cs-1",
        student: { id: "s-1", name: "Budi" },
        classSection: { name: "TKIT A", programId: "p-A", program: { name: "TKIT" } },
      },
    ] as never);
    vi.mocked(prisma.programFeeStructure.findMany).mockResolvedValue([
      {
        programId: "p-A",
        feeComponentId: "fc-1",
        amount: 500_000,
        feeComponent: { label: "SPP" },
      },
    ] as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.studentGuardian.findMany).mockResolvedValue([
      { studentId: "s-1", parentId: "parent-1" },
    ] as never);
    vi.mocked(prisma.studentFeeAdjustment.findMany).mockResolvedValue([] as never);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.billingRun.findFirst.mockReset();
  txMock.billingRun.create.mockReset();
  txMock.billingRunRow.createMany.mockReset();
  txMock.billingRunLine.createMany.mockReset();
  // Default: no existing draft, create succeeds.
  txMock.billingRun.findFirst.mockResolvedValue(null);
  txMock.billingRun.create.mockResolvedValue({ id: "run-1" });
  txMock.billingRunRow.createMany.mockResolvedValue({ count: 1 });
  txMock.billingRunLine.createMany.mockResolvedValue({ count: 1 });
});

describe("billing-runs — auth guard", () => {
  it("POST returns 403 with no session, and the write is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(403);
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
  });

  it("POST returns 403 for TEACHER role, and the write is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "TEACHER" }) as never);

    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(403);
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
  });

  it("POST returns 403 for GUARDIAN role, and the write is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "GUARDIAN" }) as never);

    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(403);
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
  });

  it("GET list returns 403 with no session, and the read is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await listRuns(makeReq("http://localhost/api/billing-runs") as never);
    expect(res.status).toBe(403);
    expect(prisma.billingRun.findMany).not.toHaveBeenCalled();
  });

  it("GET list returns 403 for TEACHER role, and the read is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "TEACHER" }) as never);

    const res = await listRuns(makeReq("http://localhost/api/billing-runs") as never);
    expect(res.status).toBe(403);
    expect(prisma.billingRun.findMany).not.toHaveBeenCalled();
  });

  it("GET list returns 403 for GUARDIAN role, and the read is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "GUARDIAN" }) as never);

    const res = await listRuns(makeReq("http://localhost/api/billing-runs") as never);
    expect(res.status).toBe(403);
    expect(prisma.billingRun.findMany).not.toHaveBeenCalled();
  });

  it("GET [id] returns 403 with no session, and the read is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await getRun(makeReq("http://localhost/api/billing-runs/run-1") as never, makeParams("run-1"));
    expect(res.status).toBe(403);
    expect(prisma.billingRun.findFirst).not.toHaveBeenCalled();
  });

  it("GET [id] returns 403 for TEACHER role, and the read is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "TEACHER" }) as never);

    const res = await getRun(makeReq("http://localhost/api/billing-runs/run-1") as never, makeParams("run-1"));
    expect(res.status).toBe(403);
    expect(prisma.billingRun.findFirst).not.toHaveBeenCalled();
  });

  it("PATCH row returns 403 for GUARDIAN role, and the write is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "GUARDIAN" }) as never);

    const res = await patchRow(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1", { status: "EXCLUDED" }, "PATCH") as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(403);
    expect(prisma.billingRunRow.update).not.toHaveBeenCalled();
  });

  it("PATCH cancel returns 403 for GUARDIAN role, and the write is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/db");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "GUARDIAN" }) as never);

    const res = await cancelRun(
      makeReq("http://localhost/api/billing-runs/run-1", { status: "CANCELLED" }, "PATCH") as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(403);
    expect(prisma.billingRun.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs — validation", () => {
  it("returns 400 with a { error, issues } envelope on an empty scope", async () => {
    await primeAdminSession();

    const res = await createRun(
      makeReq("http://localhost/api/billing-runs", {
        periodLabel: "April 2026",
        dueDate: "2026-04-30",
        academicYearId: "ay-1",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs — tenant scoping", () => {
  it("returns 404 when the academicYearId belongs to another tenant, and nothing is read or created", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    // The year is the one id that prices the entire run — it selects the fee
    // structures and keringanan every line is built from. A foreign year must
    // be rejected before any pricing data is read.
    vi.mocked(prisma.academicYear.findFirst).mockResolvedValue(null);

    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(404);
    expect(prisma.programFeeStructure.findMany).not.toHaveBeenCalled();
    expect(prisma.studentFeeAdjustment.findMany).not.toHaveBeenCalled();
    expect(prisma.studentEnrollment.findMany).not.toHaveBeenCalled();
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
  });

  it("returns 404 when a classSectionId belongs to another tenant, and nothing is created", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    // Tenant query for cs-1 comes back empty — it belongs to another tenant.
    vi.mocked(prisma.classSection.findMany).mockResolvedValue([] as never);

    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(404);
    expect(prisma.studentEnrollment.findMany).not.toHaveBeenCalled();
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
  });

  it("rejects a same-tenant class from another year before materializing an empty draft", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.classSection.findMany).mockResolvedValue([{ id: "cs-1", academicYearId: "ay-other" }] as never);
    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Kelas tidak sesuai tahun ajaran yang dipilih. Pilih ulang kelas atau ubah tahun ajaran." });
    expect(prisma.classSection.findMany).toHaveBeenCalledWith({ where: { id: { in: ["cs-1"] }, tenantId: "tnt-1" }, select: { id: true, academicYearId: true } });
    expect(prisma.studentEnrollment.findMany).not.toHaveBeenCalled();
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
  });

  it("returns 404 when an includeStudentId belongs to another tenant, and nothing is created", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.classSection.findMany).mockResolvedValue([{ id: "cs-1", academicYearId: "ay-1" }] as never);
    vi.mocked(prisma.student.findMany).mockResolvedValue([] as never); // s-foreign not found

    const res = await createRun(
      makeReq("http://localhost/api/billing-runs", {
        ...validCreateBody,
        includeStudentIds: ["s-foreign"],
      }) as never,
    );
    expect(res.status).toBe(404);
    expect(prisma.studentEnrollment.findMany).not.toHaveBeenCalled();
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs — second open draft", () => {
  it("returns 409 with the existing run's id and periodLabel, and nothing new is created", async () => {
    await primeAdminSession();
    const wire = wireSingleEligibleStudent();
    await wire();

    txMock.billingRun.findFirst.mockResolvedValue({ id: "run-existing", periodLabel: "Maret 2026" });

    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.id).toBe("run-existing");
    expect(body.periodLabel).toBe("Maret 2026");
    expect(txMock.billingRun.create).not.toHaveBeenCalled();
    expect(txMock.billingRunRow.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/billing-runs — concurrent create conflicts (STR-10)", () => {
  it.each(["P2034", "P2002"])("maps Prisma %s to 409 with a retry hint instead of a 500", async (code) => {
    await primeAdminSession();
    const wire = wireSingleEligibleStudent();
    await wire();

    txMock.billingRun.findFirst.mockResolvedValue(null);
    txMock.billingRun.create.mockResolvedValue({ id: "run-1" });
    txMock.billingRunRow.createMany.mockRejectedValue(Object.assign(new Error("write conflict"), { code }));

    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Tagihan sedang dibuat oleh proses lain. Coba lagi sebentar.");
  });

  it("still rethrows unrelated errors", async () => {
    await primeAdminSession();
    const wire = wireSingleEligibleStudent();
    await wire();

    txMock.billingRun.findFirst.mockResolvedValue(null);
    txMock.billingRun.create.mockResolvedValue({ id: "run-1" });
    txMock.billingRunRow.createMany.mockRejectedValue(Object.assign(new Error("boom"), { code: "P2000" }));

    await expect(
      createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never),
    ).rejects.toThrow("boom");
  });
});

describe("POST /api/billing-runs — happy path", () => {
  it("persists the expected row + line counts and returns the summary", async () => {
    await primeAdminSession();
    const wire = wireSingleEligibleStudent();
    await wire();

    const res = await createRun(makeReq("http://localhost/api/billing-runs", validCreateBody) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("run-1");
    expect(body.summary).toMatchObject({
      total: 1,
      pending: 1,
      excluded: 0,
      skippedAlreadyInvoiced: 0,
      skippedNoFeeStructure: 0,
      withAdjustments: 0,
    });

    expect(txMock.billingRun.create).toHaveBeenCalledTimes(1);
    const createCall = txMock.billingRun.create.mock.calls[0][0];
    expect(createCall.data.tenantId).toBe("tnt-1");
    expect(createCall.data.status).toBe("DRAFT");

    expect(txMock.billingRunRow.createMany).toHaveBeenCalledTimes(1);
    const rowArgs = txMock.billingRunRow.createMany.mock.calls[0][0];
    expect(rowArgs.data).toHaveLength(1);
    expect(rowArgs.data[0]).toMatchObject({
      billingRunId: "run-1",
      studentId: "s-1",
      status: "PENDING",
    });

    expect(txMock.billingRunLine.createMany).toHaveBeenCalledTimes(1);
    const lineArgs = txMock.billingRunLine.createMany.mock.calls[0][0];
    expect(lineArgs.data).toHaveLength(1);
    expect(lineArgs.data[0]).toMatchObject({
      billingRunRowId: rowArgs.data[0].id,
      feeComponentId: "fc-1",
    });
  });
});

describe("GET /api/billing-runs/[id]", () => {
  it("is tenant-scoped and 404s cross-tenant", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(null);

    const res = await getRun(makeReq("http://localhost/api/billing-runs/run-1") as never, makeParams("run-1"));
    expect(res.status).toBe(404);

    const findCall = vi.mocked(prisma.billingRun.findFirst).mock.calls[0][0]!;
    expect(findCall.where).toMatchObject({ id: "run-1", tenantId: "tnt-1" });
  });

  it("paginates rows", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({
      id: "run-1",
      tenantId: "tnt-1",
      periodLabel: "April 2026",
      dueDate: "2026-04-30",
      academicYearId: "ay-1",
      status: "DRAFT",
      scope: {},
      createdAt: new Date(),
      committedAt: null,
    } as never);
    vi.mocked(prisma.billingRunRow.findMany).mockResolvedValue([
      { id: "row-1", lines: [{ id: "line-1" }] },
    ] as never);
    vi.mocked(prisma.billingRunRow.count).mockResolvedValue(42);

    const res = await getRun(
      makeReq("http://localhost/api/billing-runs/run-1?page=2&pageSize=5") as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.pagination).toEqual({ page: 2, pageSize: 5, total: 42, totalPages: 9 });
    expect(body.rows.data[0].lines).toEqual([{ id: "line-1" }]);

    const findManyCall = vi.mocked(prisma.billingRunRow.findMany).mock.calls[0][0]!;
    expect(findManyCall.where).toMatchObject({ billingRunId: "run-1" });
    expect(findManyCall.skip).toBe(5);
    expect(findManyCall.take).toBe(5);
    expect(findManyCall.include).toMatchObject({ lines: true });
  });
});

describe("PATCH /api/billing-runs/[id]/rows/[rowId] — exclude / re-include", () => {
  it("excludes then re-includes a row in a roundtrip", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "DRAFT" } as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue({ id: "row-1", status: "PENDING" } as never);
    vi.mocked(prisma.billingRunRow.update).mockResolvedValue({ id: "row-1", status: "EXCLUDED" } as never);

    const excludeRes = await patchRow(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1", { status: "EXCLUDED" }, "PATCH") as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(excludeRes.status).toBe(200);
    const excluded = await excludeRes.json();
    expect(excluded.status).toBe("EXCLUDED");

    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue({ id: "row-1", status: "EXCLUDED" } as never);
    vi.mocked(prisma.billingRunRow.update).mockResolvedValue({ id: "row-1", status: "PENDING" } as never);

    const includeRes = await patchRow(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1", { status: "PENDING" }, "PATCH") as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(includeRes.status).toBe(200);
    const included = await includeRes.json();
    expect(included.status).toBe("PENDING");
  });

  it("rejects flipping a COMMITTED row back to PENDING, and never calls update", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "DRAFT" } as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue({ id: "row-1", status: "COMMITTED" } as never);

    const res = await patchRow(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1", { status: "PENDING" }, "PATCH") as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(409);
    expect(prisma.billingRunRow.update).not.toHaveBeenCalled();
  });

  it("rejects when the parent run is not DRAFT, and never calls update", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "COMMITTED" } as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue({ id: "row-1", status: "PENDING" } as never);

    const res = await patchRow(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1", { status: "EXCLUDED" }, "PATCH") as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(409);
    expect(prisma.billingRunRow.update).not.toHaveBeenCalled();
  });

  it("404s when the row does not belong to the run", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "DRAFT" } as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(null);

    const res = await patchRow(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-foreign", { status: "EXCLUDED" }, "PATCH") as never,
      makeRowParams("run-1", "row-foreign"),
    );
    expect(res.status).toBe(404);
    expect(prisma.billingRunRow.update).not.toHaveBeenCalled();
  });

  it("404s when the run does not belong to the tenant", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(null);

    const res = await patchRow(
      makeReq("http://localhost/api/billing-runs/run-foreign/rows/row-1", { status: "EXCLUDED" }, "PATCH") as never,
      makeRowParams("run-foreign", "row-1"),
    );
    expect(res.status).toBe(404);
    expect(prisma.billingRunRow.findFirst).not.toHaveBeenCalled();
    expect(prisma.billingRunRow.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/billing-runs/[id] — cancel", () => {
  it("flips a DRAFT run to CANCELLED", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "DRAFT" } as never);
    vi.mocked(prisma.billingRun.update).mockResolvedValue({ id: "run-1", status: "CANCELLED" } as never);

    const res = await cancelRun(
      makeReq("http://localhost/api/billing-runs/run-1", { status: "CANCELLED" }, "PATCH") as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CANCELLED");
  });

  it("rejects cancelling an already-COMMITTED run", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "COMMITTED" } as never);

    const res = await cancelRun(
      makeReq("http://localhost/api/billing-runs/run-1", { status: "CANCELLED" }, "PATCH") as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(409);
    expect(prisma.billingRun.update).not.toHaveBeenCalled();
  });

  it("rejects cancelling a COMMITTING run — a commit is in flight", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    // Cancelling mid-commit would leave invoices written against a run marked
    // CANCELLED. Only DRAFT is cancellable, so any future status is refused
    // by default rather than becoming silently cancellable.
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "COMMITTING" } as never);

    const res = await cancelRun(
      makeReq("http://localhost/api/billing-runs/run-1", { status: "CANCELLED" }, "PATCH") as never,
      makeParams("run-1"),
    );
    expect(res.status).toBe(409);
    expect(prisma.billingRun.update).not.toHaveBeenCalled();
  });

  it("404s cross-tenant", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(null);

    const res = await cancelRun(
      makeReq("http://localhost/api/billing-runs/run-foreign", { status: "CANCELLED" }, "PATCH") as never,
      makeParams("run-foreign"),
    );
    expect(res.status).toBe(404);
    expect(prisma.billingRun.update).not.toHaveBeenCalled();
  });
});


it("GET unfinished includes interrupted runs and remains tenant-scoped", async () => {
  await primeAdminSession();
  const { prisma } = await import("@/lib/db");
  vi.mocked(prisma.billingRun.findMany).mockResolvedValue([]);
  vi.mocked(prisma.billingRun.count).mockResolvedValue(0);
  const res = await listRuns(makeReq("http://localhost/api/billing-runs?unfinished=true") as never);
  expect(res.status).toBe(200);
  expect(prisma.billingRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { tenantId: "tnt-1", status: { in: ["DRAFT", "COMMITTING"] } },
  }));
});
