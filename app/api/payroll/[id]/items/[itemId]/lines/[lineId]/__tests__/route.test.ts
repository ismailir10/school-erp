/**
 * PUT .../lines/[lineId] — HRX-4 / FINX-2: integer adjustment within ±Rp 1 miljar
 * that may not push the line below zero; never a 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermission, db } = vi.hoisted(() => {
  const tx = {
    payrollItemLine: { update: vi.fn(), findMany: vi.fn() },
    payrollItem: { update: vi.fn() },
  };
  const db = {
    payrollRun: { findUnique: vi.fn() },
    payrollItem: { findUnique: vi.fn() },
    payrollItemLine: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    tx,
  };
  return { requirePermission: vi.fn(), db };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { PUT } from "../route";

const params = Promise.resolve({ id: "run1", itemId: "item1", lineId: "line1" });
const call = (body: unknown) =>
  PUT(
    new Request("http://t/x", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params } as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ session: { tenantId: "t1", id: "u1", role: "SUPER_ADMIN" } });
  db.payrollRun.findUnique.mockResolvedValue({ id: "run1", tenantId: "t1", status: "DRAFT" });
  db.payrollItem.findUnique.mockResolvedValue({ id: "item1", payrollRunId: "run1" });
  db.payrollItemLine.findUnique.mockResolvedValue({ id: "line1", payrollItemId: "item1", calculatedAmount: 300_000 });
  db.tx.payrollItemLine.findMany.mockResolvedValue([
    { categorySnapshot: "INCOME", finalAmount: 300_000 },
  ]);
});

describe("PUT .../lines/[lineId]", () => {
  it("refuses an adjustment that makes the line negative (-400.000 on a 300.000 allowance)", async () => {
    const res = await call({ adjustmentAmount: -400_000, adjustmentNote: "Koreksi" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Penyesuaian membuat komponen bernilai negatif.");
    expect(body.errors[0].field).toBe("adjustmentAmount");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("allows reducing a line exactly to zero", async () => {
    const res = await call({ adjustmentAmount: -300_000, adjustmentNote: "Dibebaskan" });
    expect(res.status).toBe(200);
    expect(db.tx.payrollItemLine.update).toHaveBeenCalled();
  });

  it("rejects a fractional adjustment with a 400", async () => {
    const res = await call({ adjustmentAmount: 0.5, adjustmentNote: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0].field).toBe("adjustmentAmount");
  });

  it("rejects 1e15 with a 400 instead of a 500", async () => {
    const res = await call({ adjustmentAmount: 1e15, adjustmentNote: "x" });
    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("accepts a normal positive adjustment", async () => {
    const res = await call({ adjustmentAmount: 50_000, adjustmentNote: "Bonus" });
    expect(res.status).toBe(200);
  });
});
