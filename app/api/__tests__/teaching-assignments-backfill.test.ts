import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DOC-1: assigning (or removing) a homeroom teacher must re-derive the teacher
 * on the class's existing sessions. `backfillSessionTeacher` existed but was
 * never called, so a wali kelas assigned after the sessions were generated saw
 * "Belum ada sesi terjadwal" on the teacher home.
 */

const { db, requirePermission, backfill } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    teachingAssignment: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  };
  const db = {
    classSection: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn() },
    teachingAssignment: { findFirst: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    tx,
  };
  return { db, requirePermission: vi.fn(), backfill: vi.fn() };
});

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/classes/year-guard", () => ({
  ensureYearWritableForClass: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: "t1", yearStatus: "ACTIVE" }),
}));
vi.mock("@/lib/sessions/teacher-backfill", () => ({ backfillSessionTeacher: backfill }));

import { POST, DELETE } from "@/app/api/admin/classes/[id]/teaching-assignments/route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" } };
const ctx = { params: Promise.resolve({ id: "cs1" }) };

function post(body: unknown) {
  return new Request("http://t/api/admin/classes/cs1/teaching-assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
function del(employeeId: string) {
  return new Request(
    `http://t/api/admin/classes/cs1/teaching-assignments?employeeId=${employeeId}`,
    { method: "DELETE" },
  ) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ALLOW);
  backfill.mockResolvedValue({ updated: 3 });
  db.classSection.findFirst.mockResolvedValue({ id: "cs1", name: "TKIT A" });
  db.employee.findFirst.mockResolvedValue({ id: "e1", nama: "Bu Sari" });
  db.tx.teachingAssignment.findFirst.mockResolvedValue(null);
  db.tx.teachingAssignment.create.mockResolvedValue({
    id: "ta1",
    role: "HOMEROOM",
    createdAt: new Date(),
    employee: { id: "e1", nama: "Bu Sari", formalName: null },
  });
});

describe("teaching-assignments -> session teacher backfill (DOC-1)", () => {
  it("backfills the class's sessions after a HOMEROOM is assigned", async () => {
    const res = await POST(post({ employeeId: "e1", role: "HOMEROOM" }), ctx);
    expect(res.status).toBe(201);
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledWith("cs1", "t1");
  });

  it("does not touch sessions when an ASSISTANT is assigned", async () => {
    const res = await POST(post({ employeeId: "e1", role: "ASSISTANT" }), ctx);
    expect(res.status).toBe(201);
    expect(backfill).not.toHaveBeenCalled();
  });

  it("does not backfill when the HOMEROOM assignment is refused", async () => {
    db.tx.teachingAssignment.findFirst.mockResolvedValue({
      id: "old",
      employeeId: "e2",
      employee: { id: "e2", nama: "Bu Lain" },
    });
    const res = await POST(post({ employeeId: "e1", role: "HOMEROOM" }), ctx);
    expect(res.status).toBe(409);
    expect(backfill).not.toHaveBeenCalled();
  });

  it("still saves the assignment when the backfill throws", async () => {
    backfill.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({ employeeId: "e1", role: "HOMEROOM" }), ctx);
    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("re-derives (clears) the sessions when the HOMEROOM is removed", async () => {
    db.teachingAssignment.findFirst.mockResolvedValue({ id: "ta1", role: "HOMEROOM" });
    const res = await DELETE(del("e1"), ctx);
    expect(res.status).toBe(200);
    expect(backfill).toHaveBeenCalledWith("cs1", "t1");
  });

  it("leaves sessions alone when an ASSISTANT is removed", async () => {
    db.teachingAssignment.findFirst.mockResolvedValue({ id: "ta2", role: "ASSISTANT" });
    const res = await DELETE(del("e2"), ctx);
    expect(res.status).toBe(200);
    expect(backfill).not.toHaveBeenCalled();
  });
});

it("replaces the confirmed homeroom inside the same transaction", async () => {
  db.tx.teachingAssignment.findFirst.mockResolvedValue({ id: "old", employeeId: "e2", employee: { id: "e2", nama: "Old" } });
  const res = await POST(post({ employeeId: "e1", role: "HOMEROOM", replaceAssignmentId: "old" }), ctx);
  expect(res.status).toBe(201);
  expect(db.tx.teachingAssignment.delete).toHaveBeenCalledWith({ where: { id: "old" } });
  expect(db.teachingAssignment.delete).not.toHaveBeenCalled();
  expect(db.tx.teachingAssignment.delete.mock.invocationCallOrder[0]).toBeLessThan(db.tx.teachingAssignment.create.mock.invocationCallOrder[0]);
});
it("refuses a stale replacement confirmation without deleting the current homeroom", async () => {
  db.tx.teachingAssignment.findFirst.mockResolvedValue({ id: "newer", employeeId: "e2", employee: { id: "e2", nama: "Newer" } });
  const res = await POST(post({ employeeId: "e1", role: "HOMEROOM", replaceAssignmentId: "old" }), ctx);
  expect(res.status).toBe(409);
  expect(db.tx.teachingAssignment.delete).not.toHaveBeenCalled();
  expect(db.tx.teachingAssignment.create).not.toHaveBeenCalled();
});
