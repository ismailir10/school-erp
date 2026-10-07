/**
 * Coverage for PUT /api/students/[id]:
 *   1. Partial-update integrity: fields omitted from the body must pass
 *      `undefined` (skip-column) to Prisma, not `null` (which would clear
 *      the column). Explicitly-supplied `null` still clears it.
 *   2. Lifecycle guard: a direct PUT to status GRADUATED is rejected (400)
 *      unless the student is already GRADUATED — callers must use the
 *      dedicated /graduate route so graduationDate + enrollment cascade fire.
 *   3. Atomic cascade: INACTIVE/WITHDRAWN status flips run the enrollment +
 *      invoice cascade AND the student.update inside the same $transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const studentFindUnique = vi.fn();
const studentUpdate = vi.fn();
const studentFindFirst = vi.fn();
const enrollmentUpdateMany = vi.fn();
const invoiceUpdateMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    student: {
      findUnique: studentFindUnique,
      findFirst: studentFindFirst,
      update: studentUpdate,
    },
    studentEnrollment: {
      updateMany: enrollmentUpdateMany,
    },
    invoice: {
      updateMany: invoiceUpdateMany,
    },
    $transaction: transaction,
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

function makeSession(role: SessionUser["role"] = "SUPER_ADMIN"): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role,
    tenantId: "t1",
    employeeId: null,
    parentId: null,
    permissions: [],
    customRoleCode: null,
  };
}

function makeExisting(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    tenantId: "t1",
    name: "Existing Name",
    nickname: "Old Nick",
    dateOfBirth: "2015-01-01",
    gender: "L",
    address: "Old Address",
    notes: "Old notes",
    nis: "111",
    nisn: "222",
    birthPlace: "Jakarta",
    nik: null,
    kkNumber: null,
    livingWith: null,
    metadata: null,
    status: "ACTIVE",
    ...overrides,
  };
}

function makeReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/students/s1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      studentEnrollment: { updateMany: enrollmentUpdateMany },
      invoice: { updateMany: invoiceUpdateMany },
      student: { update: studentUpdate },
    })
  );
  studentUpdate.mockResolvedValue({ id: "s1" });
  studentFindFirst.mockResolvedValue(null);
  enrollmentUpdateMany.mockResolvedValue({ count: 0 });
  invoiceUpdateMany.mockResolvedValue({ count: 0 });
});

describe("PUT /api/students/[id] — partial-update integrity", () => {
  it("body with only { name } passes undefined (not null) for omitted nullable fields", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    studentFindUnique.mockResolvedValue(makeExisting());

    const { PUT } = await import("../students/[id]/route");
    const res = await PUT(makeReq({ name: "X" }) as never, {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(200);
    expect(studentUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({
        nickname: undefined,
        dateOfBirth: undefined,
        gender: undefined,
        address: undefined,
        notes: undefined,
      }),
    });
  });

  it("body with explicit { nickname: null } clears nickname to null", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    studentFindUnique.mockResolvedValue(makeExisting());

    const { PUT } = await import("../students/[id]/route");
    const res = await PUT(makeReq({ nickname: null }) as never, {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(200);
    expect(studentUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ nickname: null }),
    });
  });
});

describe("PUT /api/students/[id] — lifecycle guard", () => {
  it("rejects direct PUT to GRADUATED on an ACTIVE student with 400 and no update", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    studentFindUnique.mockResolvedValue(makeExisting({ status: "ACTIVE" }));

    const { PUT } = await import("../students/[id]/route");
    const res = await PUT(makeReq({ status: "GRADUATED" }) as never, {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Luluskan/);
    expect(studentUpdate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("allows PUT to GRADUATED when already GRADUATED (no-op re-save)", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    studentFindUnique.mockResolvedValue(makeExisting({ status: "GRADUATED" }));

    const { PUT } = await import("../students/[id]/route");
    const res = await PUT(makeReq({ status: "GRADUATED" }) as never, {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(200);
    expect(studentUpdate).toHaveBeenCalledOnce();
  });
});

describe("PUT /api/students/[id] — atomic cascade", () => {
  it("runs the enrollment/invoice cascade and the student update inside the same transaction", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    studentFindUnique.mockResolvedValue(makeExisting({ status: "ACTIVE" }));

    const { PUT } = await import("../students/[id]/route");
    const res = await PUT(makeReq({ status: "INACTIVE" }) as never, {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledOnce();
    expect(enrollmentUpdateMany).toHaveBeenCalledWith({
      where: { studentId: "s1", status: "ACTIVE" },
      data: { status: "WITHDRAWN" },
    });
    expect(invoiceUpdateMany).toHaveBeenCalledWith({
      where: { studentId: "s1", status: { in: ["DRAFT", "SENT", "PENDING_PAYMENT_LINK"] } },
      data: { status: "CANCELLED" },
    });
    expect(studentUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ status: "INACTIVE" }),
    });

    // Verify call ordering: cascade calls happened before the transaction
    // resolved via student.update — i.e. student.update was invoked from
    // within the same tx callback, not as a separate top-level prisma call.
    const cascadeOrder = enrollmentUpdateMany.mock.invocationCallOrder[0];
    const updateOrder = studentUpdate.mock.invocationCallOrder[0];
    expect(cascadeOrder).toBeLessThan(updateOrder);
  });

  it("does not use a transaction for a plain non-lifecycle update", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    studentFindUnique.mockResolvedValue(makeExisting({ status: "ACTIVE" }));

    const { PUT } = await import("../students/[id]/route");
    const res = await PUT(makeReq({ name: "New Name" }) as never, {
      params: Promise.resolve({ id: "s1" }),
    });

    expect(res.status).toBe(200);
    expect(transaction).not.toHaveBeenCalled();
    expect(studentUpdate).toHaveBeenCalledOnce();
  });
});

describe("PUT /api/students/[id] — reactivation (ADM-1)", () => {
  async function put(body: Record<string, unknown>) {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    const { PUT } = await import("../students/[id]/route");
    return PUT(makeReq(body) as never, { params: Promise.resolve({ id: "s1" }) });
  }

  it("status ACTIVE on a WITHDRAWN student clears withdrawalDate + withdrawalReason and creates no enrollment", async () => {
    studentFindUnique.mockResolvedValue(
      makeExisting({ status: "WITHDRAWN", withdrawalDate: "2026-08-01", withdrawalReason: "Pindah kota" }),
    );

    const res = await put({ status: "ACTIVE" });

    expect(res.status).toBe(200);
    expect(studentUpdate).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ status: "ACTIVE", withdrawalDate: null, withdrawalReason: null }),
    });
    // Plain update, no cascade transaction (that is for INACTIVE/WITHDRAWN).
    expect(transaction).not.toHaveBeenCalled();
    expect(enrollmentUpdateMany).not.toHaveBeenCalled();
  });

  it("an ordinary edit of a WITHDRAWN student leaves the withdrawal fields alone", async () => {
    studentFindUnique.mockResolvedValue(makeExisting({ status: "WITHDRAWN" }));

    await put({ name: "Nama Baru" });

    const data = studentUpdate.mock.calls[0][0].data;
    expect(data.withdrawalDate).toBeUndefined();
    expect(data.withdrawalReason).toBeUndefined();
  });

  it("status ACTIVE on an already ACTIVE student does not touch the withdrawal fields", async () => {
    studentFindUnique.mockResolvedValue(makeExisting({ status: "ACTIVE" }));

    await put({ status: "ACTIVE" });

    const data = studentUpdate.mock.calls[0][0].data;
    expect(data.withdrawalDate).toBeUndefined();
    expect(data.withdrawalReason).toBeUndefined();
  });
});

describe("PUT /api/students/[id] — NIS uniqueness (ADM-2)", () => {
  async function put(body: Record<string, unknown>) {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(makeSession());
    const { PUT } = await import("../students/[id]/route");
    return PUT(makeReq(body) as never, { params: Promise.resolve({ id: "s1" }) });
  }

  it("409 NIS_TAKEN when the new NIS belongs to another student, and nothing is written", async () => {
    studentFindUnique.mockResolvedValue(makeExisting({ nis: "111" }));
    studentFindFirst.mockResolvedValue({ id: "s2", name: "Aisyah" });

    const res = await put({ nis: " 999 " });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "NIS sudah dipakai oleh Aisyah.",
      code: "NIS_TAKEN",
      field: "nis",
    });
    expect(studentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t1", nis: "999", id: { not: "s1" } } }),
    );
    expect(studentUpdate).not.toHaveBeenCalled();
  });

  it("does not look up NIS when it is unchanged", async () => {
    studentFindUnique.mockResolvedValue(makeExisting({ nis: "111" }));

    const res = await put({ nis: "111", name: "X" });

    expect(res.status).toBe(200);
    expect(studentFindFirst).not.toHaveBeenCalled();
  });

  it("clearing the NIS is allowed without a lookup", async () => {
    studentFindUnique.mockResolvedValue(makeExisting({ nis: "111" }));

    const res = await put({ nis: "" });

    expect(res.status).toBe(200);
    expect(studentFindFirst).not.toHaveBeenCalled();
  });

  it("an edit never raises DUPLICATE_STUDENT for name + date of birth", async () => {
    studentFindUnique.mockResolvedValue(makeExisting());

    const res = await put({ name: "Sama Persis", dateOfBirth: "2015-01-01" });

    expect(res.status).toBe(200);
    expect(studentFindFirst).not.toHaveBeenCalled();
  });
});
