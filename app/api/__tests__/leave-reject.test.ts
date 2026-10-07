/**
 * Coverage for `POST /api/leave/requests/[id]/reject`.
 *
 * The handler:
 *   - Requires `leave.approve`.
 *   - Requires a non-empty `note` in the body (rejection reason).
 *   - findUnique loads the request with its employee's tenantId; mismatch → 404.
 *   - Only PENDING requests can be rejected → 400 otherwise.
 *   - Conditional update (status PENDING): a racing approve/reject → 409, not a second 200.
 *   - Stamps reviewedBy / reviewedAt / reviewNote on update.
 *   - Writes a "reject" audit row inside the same transaction (none on a lost race).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const findUnique = vi.fn();
const updateMany = vi.fn();
const recordAudit = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    leaveRequest: { findUnique, updateMany },
    // The claim + audit row run in one tx; the tx client exposes the same mocks.
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({ leaveRequest: { findUnique, updateMany } })),
  },
}));
vi.mock("@/lib/audit", () => ({ recordAudit }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function makeSession(role: SessionUser["role"] = "SUPER_ADMIN"): SessionUser {
  return {
    id: "u1",
    email: "a@a",
    name: "A",
    role,
    tenantId: "t-1",
    employeeId: null,
    parentId: null,
    permissions: getSystemRolePermissions(role),
    customRoleCode: null,
  };
}

async function mockSession(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}

function makeReq(body: unknown = { note: "Tidak memenuhi syarat" }) {
  return new Request("http://localhost/api/leave/requests/lr-1/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/leave/requests/[id]/reject", () => {
  it("PENDING → REJECTED with reviewedBy / reviewedAt / reviewNote stamped", async () => {
    await mockSession(makeSession("SUPER_ADMIN"));
    findUnique.mockResolvedValueOnce({
      id: "lr-1",
      status: "PENDING",
      employee: { tenantId: "t-1" },
    });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: "lr-1", status: "REJECTED" });

    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(makeReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "lr-1" },
        include: { employee: { select: { tenantId: true } } },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "lr-1", status: "PENDING" },
        data: expect.objectContaining({
          status: "REJECTED",
          reviewedBy: "u1",
          reviewNote: "Tidak memenuhi syarat",
        }),
      }),
    );
  });

  it("writes a reject audit row inside the transaction with the reason", async () => {
    await mockSession(makeSession("SUPER_ADMIN"));
    findUnique.mockResolvedValueOnce({ id: "lr-1", status: "PENDING", employee: { tenantId: "t-1" } });
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ id: "lr-1", status: "REJECTED" });

    const { POST } = await import("../leave/requests/[id]/reject/route");
    await POST(makeReq() as never, { params: Promise.resolve({ id: "lr-1" }) });

    expect(recordAudit).toHaveBeenCalledWith(
      {
        tenantId: "t-1",
        actorId: "u1",
        entity: "LeaveRequest",
        entityId: "lr-1",
        action: "reject",
        before: { status: "PENDING" },
        after: { status: "REJECTED", reason: "Tidak memenuhi syarat" },
      },
      expect.objectContaining({ leaveRequest: expect.anything() }),
    );
  });

  it("400 when note is missing/blank (rejection reason required)", async () => {
    await mockSession(makeSession("SUPER_ADMIN"));

    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(makeReq({ note: "   " }) as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("400 when request is APPROVED (only PENDING can be rejected)", async () => {
    await mockSession(makeSession("SUPER_ADMIN"));
    findUnique.mockResolvedValueOnce({
      id: "lr-1",
      status: "APPROVED",
      employee: { tenantId: "t-1" },
    });

    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(makeReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("400 when request is already REJECTED (re-reject is not idempotent — guards double-click)", async () => {
    await mockSession(makeSession("SUPER_ADMIN"));
    findUnique.mockResolvedValueOnce({
      id: "lr-1",
      status: "REJECTED",
      employee: { tenantId: "t-1" },
    });

    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(makeReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("409 when a concurrent review already moved the row (conditional update count 0)", async () => {
    await mockSession(makeSession("SUPER_ADMIN"));
    findUnique.mockResolvedValueOnce({
      id: "lr-1",
      status: "PENDING", // read before the racer committed
      employee: { tenantId: "t-1" },
    });
    updateMany.mockResolvedValueOnce({ count: 0 });

    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(makeReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Pengajuan ini sudah diproses.");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("400 (not 500) when the body is missing or not JSON", async () => {
    await mockSession(makeSession("SUPER_ADMIN"));
    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(
      new Request("http://localhost/api/leave/requests/lr-1/reject", { method: "POST" }) as never,
      { params: Promise.resolve({ id: "lr-1" }) },
    );
    expect(res.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("404 when employee.tenantId mismatches session tenant", async () => {
    await mockSession(makeSession("SUPER_ADMIN")); // t-1
    findUnique.mockResolvedValueOnce({
      id: "lr-1",
      status: "PENDING",
      employee: { tenantId: "t-other" },
    });

    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(makeReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("401 when no session", async () => {
    await mockSession(null);

    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(makeReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("403 for non-admin (TEACHER lacks leave.approve)", async () => {
    await mockSession(makeSession("TEACHER"));

    const { POST } = await import("../leave/requests/[id]/reject/route");
    const res = await POST(makeReq() as never, {
      params: Promise.resolve({ id: "lr-1" }),
    });

    expect(res.status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
