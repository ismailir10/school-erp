import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory tx mock factory — each test rewires the per-call return values.
// Mirrors the style in app/api/__tests__/billing-runs.test.ts.
const txMock = {
  billingRunLine: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  billingRunRow: {
    update: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    billingRun: {
      findFirst: vi.fn(),
    },
    billingRunRow: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    billingRunLine: {
      findFirst: vi.fn(),
    },
    feeComponentDef: {
      findFirst: vi.fn(),
      create: vi.fn(),
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

import { POST as addLine } from "../billing-runs/[id]/rows/[rowId]/lines/route";
import { PATCH as patchLine, DELETE as deleteLine } from "../billing-runs/[id]/rows/[rowId]/lines/[lineId]/route";

function makeReq(
  url: string,
  body?: unknown,
  method: "GET" | "POST" | "PATCH" | "DELETE" = body ? "POST" : "GET",
) {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeRowParams(id: string, rowId: string) {
  return { params: Promise.resolve({ id, rowId }) };
}

function makeLineParams(id: string, rowId: string, lineId: string) {
  return { params: Promise.resolve({ id, rowId, lineId }) };
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

const draftRun = { id: "run-1", status: "DRAFT" };
const pendingRow = { id: "row-1", status: "PENDING" };
const excludedRow = { id: "row-1", status: "EXCLUDED" };
const committedRow = { id: "row-1", status: "COMMITTED" };

const catalogAddBody = {
  mode: "CATALOG" as const,
  feeComponentId: "fc-1",
  label: "Seragam",
  amount: 250_000,
};

const discountAddBody = {
  mode: "DISCOUNT" as const,
  label: "Potongan yatim",
  amount: 100_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  txMock.billingRunLine.create.mockReset();
  txMock.billingRunLine.update.mockReset();
  txMock.billingRunLine.delete.mockReset();
  txMock.billingRunLine.findMany.mockReset();
  txMock.billingRunLine.count.mockReset();
  txMock.billingRunRow.update.mockReset();
});

describe("POST /api/billing-runs/[id]/rows/[rowId]/lines — auth guard", () => {
  it("returns 403 for a non-admin role, and the write is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "TEACHER" }) as never);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", catalogAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(403);
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });
});

describe("PATCH .../lines/[lineId] — auth guard", () => {
  it("returns 403 for a non-admin role, and the write is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "GUARDIAN" }) as never);

    const res = await patchLine(
      makeReq(
        "http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1",
        { finalAmount: 100_000 },
        "PATCH",
      ) as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(403);
    expect(txMock.billingRunLine.update).not.toHaveBeenCalled();
  });
});

describe("DELETE .../lines/[lineId] — auth guard", () => {
  it("returns 403 for a non-admin role, and the write is never attempted", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(adminSession({ role: "TEACHER" }) as never);

    const res = await deleteLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1", undefined, "DELETE") as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(403);
    expect(txMock.billingRunLine.delete).not.toHaveBeenCalled();
  });
});

describe("Ownership hops — 404s", () => {
  it("POST 404s when the run does not belong to the tenant, and nothing is read further", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(null);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-foreign/rows/row-1/lines", catalogAddBody) as never,
      makeRowParams("run-foreign", "row-1"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Tidak ditemukan");
    expect(prisma.billingRunRow.findFirst).not.toHaveBeenCalled();
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });

  it("POST 404s when the row does not belong to the run, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(null);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-foreign/lines", catalogAddBody) as never,
      makeRowParams("run-1", "row-foreign"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Baris tidak ditemukan");
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });

  it("PATCH 404s when the line does not belong to the row, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue(null);

    const res = await patchLine(
      makeReq(
        "http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-foreign",
        { finalAmount: 100_000 },
        "PATCH",
      ) as never,
      makeLineParams("run-1", "row-1", "line-foreign"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Baris tagihan tidak ditemukan");
    expect(txMock.billingRunLine.update).not.toHaveBeenCalled();
  });
});

describe("409 guard — run status / row status", () => {
  it("POST refuses when the run is not DRAFT, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "COMMITTED" } as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", catalogAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(409);
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });

  it("POST refuses on a COMMITTED row, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(committedRow as never);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", catalogAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(409);
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });

  it("PATCH refuses when the run is not DRAFT, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue({ id: "run-1", status: "CANCELLED" } as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({
      id: "line-1",
      amount: 500_000,
      source: "BASE",
    } as never);

    const res = await patchLine(
      makeReq(
        "http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1",
        { finalAmount: 100_000 },
        "PATCH",
      ) as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(409);
    expect(txMock.billingRunLine.update).not.toHaveBeenCalled();
  });

  it("DELETE refuses on a COMMITTED row, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(committedRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({
      id: "line-1",
      amount: 500_000,
      source: "BASE",
    } as never);

    const res = await deleteLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1", undefined, "DELETE") as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(409);
    expect(txMock.billingRunLine.delete).not.toHaveBeenCalled();
  });
});

describe("POST — catalog add", () => {
  it("rejects a foreign feeComponentId with 404, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.feeComponentDef.findFirst).mockResolvedValue(null);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", catalogAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Komponen biaya tidak ditemukan");
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });

  it("rejects a disabled component with the same 404, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    // The tenant-scoped query filters isEnabled: true, status: "ACTIVE" — a
    // disabled component simply doesn't match and comes back null, same as
    // a foreign one.
    vi.mocked(prisma.feeComponentDef.findFirst).mockResolvedValue(null);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", catalogAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(404);
    const findCall = vi.mocked(prisma.feeComponentDef.findFirst).mock.calls[0][0]!;
    expect(findCall.where).toMatchObject({ isEnabled: true, status: "ACTIVE" });
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });

  it("refuses a duplicate component already on the row with 409", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.feeComponentDef.findFirst).mockResolvedValue({ id: "fc-1" } as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({ id: "existing-line" } as never);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", catalogAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(409);
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });

  it("creates the line and returns totalDue matching the row's new line sum", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.feeComponentDef.findFirst).mockResolvedValue({ id: "fc-1" } as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue(null); // no duplicate

    txMock.billingRunLine.create.mockResolvedValue({
      id: "line-new",
      feeComponentId: "fc-1",
      finalAmount: 250_000,
    });
    txMock.billingRunLine.findMany.mockResolvedValue([
      { finalAmount: 500_000 },
      { finalAmount: 250_000 },
    ]);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", catalogAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.line.id).toBe("line-new");
    expect(body.totalDue.toString()).toBe("750000");

    expect(txMock.billingRunLine.create).toHaveBeenCalledTimes(1);
    const createArgs = txMock.billingRunLine.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      billingRunRowId: "row-1",
      feeComponentId: "fc-1",
      source: "MANUAL",
    });
    expect(txMock.billingRunRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row-1" } }),
    );
  });
});

describe("POST — amount bound", () => {
  it("returns 400 for a line amount above the column range, and nothing is created", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", {
        ...catalogAddBody,
        amount: 99_999_999_999_999,
      }) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Nominal maksimal Rp 10.000.000.000");
    expect(txMock.billingRunLine.create).not.toHaveBeenCalled();
  });
});

describe("POST — discount add", () => {
  it("lazily creates the system component exactly once across two calls", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    txMock.billingRunLine.findMany.mockResolvedValue([{ finalAmount: -100_000 }]);
    txMock.billingRunLine.create.mockResolvedValue({
      id: "line-discount",
      feeComponentId: "fc-system",
      finalAmount: -100_000,
    });

    // First call: no system component yet — find returns null, create wires
    // one up.
    vi.mocked(prisma.feeComponentDef.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.feeComponentDef.create).mockResolvedValueOnce({ id: "fc-system" } as never);

    const res1 = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", discountAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res1.status).toBe(201);

    // Second call: the component now exists — find returns it, create must
    // NOT be called again.
    vi.mocked(prisma.feeComponentDef.findFirst).mockResolvedValueOnce({ id: "fc-system" } as never);

    const res2 = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", discountAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res2.status).toBe(201);

    expect(prisma.feeComponentDef.create).toHaveBeenCalledTimes(1);
    const createArgs = vi.mocked(prisma.feeComponentDef.create).mock.calls[0][0]!;
    expect(createArgs.data).toMatchObject({
      code: "penyesuaian_manual",
      label: "Penyesuaian",
      category: "OTHER",
      isRecurring: false,
      isEnabled: false,
    });
  });

  it("survives a concurrent create race (P2002) by re-finding instead of erroring", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    // A base line already on the row plus the new discount line — the sum
    // stays positive so this test isn't confused with sumRowTotal's
    // separate zero-clamp behaviour (covered by lib/finance tests).
    txMock.billingRunLine.findMany.mockResolvedValue([
      { finalAmount: 300_000 },
      { finalAmount: -100_000 },
    ]);
    txMock.billingRunLine.create.mockResolvedValue({
      id: "line-discount",
      feeComponentId: "fc-system",
      finalAmount: -100_000,
    });

    vi.mocked(prisma.feeComponentDef.findFirst)
      .mockResolvedValueOnce(null) // not found initially
      .mockResolvedValueOnce({ id: "fc-system" } as never); // re-find after P2002 succeeds
    vi.mocked(prisma.feeComponentDef.create).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const res = await addLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines", discountAddBody) as never,
      makeRowParams("run-1", "row-1"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.totalDue.toString()).toBe("200000");
  });
});

describe("PATCH — edit a line", () => {
  it("returns 400 with resolveLineEdit's error on a rejected negative base line, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({
      id: "line-1",
      amount: 500_000,
      source: "BASE",
    } as never);

    const res = await patchLine(
      makeReq(
        "http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1",
        { finalAmount: -1 },
        "PATCH",
      ) as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(txMock.billingRunLine.update).not.toHaveBeenCalled();
  });

  it("returns 400 with an Indonesian message (not a 500) for an amount above the column range, and the write is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({
      id: "line-1",
      amount: 500_000,
      source: "BASE",
    } as never);

    const res = await patchLine(
      makeReq(
        "http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1",
        { finalAmount: 99_999_999_999_999 },
        "PATCH",
      ) as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Nominal maksimal Rp 10.000.000.000");
    expect(body.issues[0].path).toEqual(["finalAmount"]);
    expect(txMock.billingRunLine.update).not.toHaveBeenCalled();
  });

  it("edits a line, never writes `amount`, and returns totalDue matching the new line sum", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({
      id: "line-1",
      amount: 500_000,
      source: "BASE",
    } as never);

    txMock.billingRunLine.update.mockResolvedValue({ id: "line-1", finalAmount: 400_000 });
    txMock.billingRunLine.findMany.mockResolvedValue([{ finalAmount: 400_000 }]);

    const res = await patchLine(
      makeReq(
        "http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1",
        { finalAmount: 400_000 },
        "PATCH",
      ) as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalDue.toString()).toBe("400000");

    const updateArgs = txMock.billingRunLine.update.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty("amount");
    expect(updateArgs.data).toMatchObject({
      adjustmentAmount: expect.anything(),
      finalAmount: expect.anything(),
      source: "EDITED",
    });
  });
});

describe("DELETE — remove a line", () => {
  it("refuses deleting the last remaining line of a PENDING row, and the delete is never attempted", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({
      id: "line-1",
      amount: 500_000,
      source: "BASE",
    } as never);
    txMock.billingRunLine.count.mockResolvedValue(1);

    const res = await deleteLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1", undefined, "DELETE") as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(txMock.billingRunLine.delete).not.toHaveBeenCalled();
  });

  it("allows deleting the last remaining line of an EXCLUDED row", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(excludedRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({
      id: "line-1",
      amount: 500_000,
      source: "BASE",
    } as never);
    txMock.billingRunLine.count.mockResolvedValue(1);
    txMock.billingRunLine.findMany.mockResolvedValue([]);

    const res = await deleteLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1", undefined, "DELETE") as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(200);
    expect(txMock.billingRunLine.delete).toHaveBeenCalledTimes(1);
  });

  it("deletes a line and returns totalDue matching the row's new line sum", async () => {
    await primeAdminSession();
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.billingRun.findFirst).mockResolvedValue(draftRun as never);
    vi.mocked(prisma.billingRunRow.findFirst).mockResolvedValue(pendingRow as never);
    vi.mocked(prisma.billingRunLine.findFirst).mockResolvedValue({
      id: "line-1",
      amount: 500_000,
      source: "BASE",
    } as never);
    txMock.billingRunLine.count.mockResolvedValue(2);
    txMock.billingRunLine.findMany.mockResolvedValue([{ finalAmount: 300_000 }]);

    const res = await deleteLine(
      makeReq("http://localhost/api/billing-runs/run-1/rows/row-1/lines/line-1", undefined, "DELETE") as never,
      makeLineParams("run-1", "row-1", "line-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalDue.toString()).toBe("300000");
    expect(txMock.billingRunLine.delete).toHaveBeenCalledWith({ where: { id: "line-1" } });
  });
});
