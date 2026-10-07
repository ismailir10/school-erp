/**
 * PUT /api/payroll/[id] — HRX-3: actualWorkDays must be 1..calendar days of the
 * (possibly updated) period; out of range is a 400 with a field message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermission, db } = vi.hoisted(() => {
  const tx = { payrollRun: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() } };
  const db = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    tx,
  };
  return { requirePermission: vi.fn(), db };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true }));

import { PUT } from "../route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SUPER_ADMIN" } };
const params = Promise.resolve({ id: "run1" });

function req(body: unknown) {
  return new Request("http://t/api/payroll/run1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ALLOW);
  db.tx.payrollRun.findUnique.mockResolvedValue({
    id: "run1",
    tenantId: "t1",
    status: "DRAFT",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    actualWorkDays: 22,
  });
  db.tx.payrollRun.findFirst.mockResolvedValue(null);
  db.tx.payrollRun.update.mockImplementation(async ({ data }: { data: object }) => ({ id: "run1", ...data }));
});

describe("PUT /api/payroll/[id] — actualWorkDays bounds", () => {
  it("rejects 0 at the schema (400, field error)", async () => {
    const res = await PUT(req({ actualWorkDays: 0 }), { params } as never);
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0].field).toBe("actualWorkDays");
    expect(db.tx.payrollRun.update).not.toHaveBeenCalled();
  });

  it("rejects 999 against a 30-day period with the range sentence on the field", async () => {
    const res = await PUT(req({ actualWorkDays: 999 }), { params } as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Hari kerja aktual harus antara 1 dan 30 hari.");
    expect(body.errors).toEqual([{ field: "actualWorkDays", message: "Hari kerja aktual harus antara 1 dan 30 hari." }]);
    expect(db.tx.payrollRun.update).not.toHaveBeenCalled();
  });

  it("accepts the upper boundary (30) and a normal value (22)", async () => {
    expect((await PUT(req({ actualWorkDays: 30 }), { params } as never)).status).toBe(200);
    expect((await PUT(req({ actualWorkDays: 22 }), { params } as never)).status).toBe(200);
  });

  it("checks against the UPDATED period when the dates move in the same request", async () => {
    const res = await PUT(
      req({ periodStart: "2026-09-01", periodEnd: "2026-09-10", actualWorkDays: 22 }),
      { params } as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Hari kerja aktual harus antara 1 dan 10 hari.");
  });

  it("does not leak the range check onto a non-DRAFT run (still 409)", async () => {
    db.tx.payrollRun.findUnique.mockResolvedValue({
      id: "run1", tenantId: "t1", status: "APPROVED",
      periodStart: "2026-09-01", periodEnd: "2026-09-30", actualWorkDays: 22,
    });
    const res = await PUT(req({ actualWorkDays: 999 }), { params } as never);
    expect(res.status).toBe(409);
  });
});
