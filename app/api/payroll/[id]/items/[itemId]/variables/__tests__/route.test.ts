/**
 * PUT /api/payroll/[id]/items/[itemId]/variables — F-15
 * (cycle 2026-09-27-admin-finish-standard): `calculateEmployeePayroll` does
 * not run `assertGajiPokokSortOrder` itself, so this route needs its own
 * guard against a misordered PCT_OF_BASE component (400 instead of a wrong
 * silent recalculation against 0).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requirePermission, db } = vi.hoisted(() => {
  const db = {
    payrollRun: { findUnique: vi.fn() },
    salaryComponentDef: { findMany: vi.fn(), findUnique: vi.fn() },
    payrollItem: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return { requirePermission: vi.fn(), db };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { PUT } from "../route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SCHOOL_ADMIN" } };

function req(body: unknown) {
  return new Request("http://t/api/payroll/run1/items/item1/variables", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const params = Promise.resolve({ id: "run1", itemId: "item1" });

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ALLOW);
  db.payrollRun.findUnique.mockResolvedValue({
    id: "run1",
    tenantId: "t1",
    status: "DRAFT",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    actualWorkDays: 20,
  });
  // verifyTenantOwnership("payrollItem", ...) reads this via `@/lib/auth-guard`,
  // which imports the same `@/lib/db` mock — give it the shape that helper
  // expects (an include of the parent payrollRun's tenantId).
  db.payrollItem.findUnique.mockResolvedValue({
    id: "item1",
    payrollRun: { tenantId: "t1" },
  });
});

describe("PUT .../variables — F-15 ordering guard", () => {
  it("returns 400 naming the component instead of recalculating against a misordered PCT_OF_BASE", async () => {
    db.salaryComponentDef.findMany.mockResolvedValue([
      { id: "gp1", code: "gaji_pokok", label: "Gaji Pokok", category: "INCOME", calcType: "FIXED", isProRated: false, sortOrder: 1 },
      { id: "pct1", code: "insentif_persen", label: "Insentif Persen", category: "INCOME", calcType: "PCT_OF_BASE", isProRated: false, sortOrder: 1 },
    ]);

    const res = await PUT(req({ overtimeHours: 2 }), { params } as never);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Insentif Persen");
    expect(body.error).toContain("Gaji Pokok");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("PUT .../variables — HR-2 manual adjustments survive a recalculation", () => {
  it("re-applies adjustmentAmount/adjustmentNote onto the rebuilt lines and totals", async () => {
    db.salaryComponentDef.findMany.mockResolvedValue([
      { id: "gp1", code: "gaji_pokok", label: "Gaji Pokok", category: "INCOME", calcType: "FIXED", isProRated: false, sortOrder: 1 },
    ]);
    const tx = {
      payrollItem: {
        update: vi.fn().mockResolvedValue({
          employeeId: "e1", overtimeHours: 0, outdoorDays: 2, holidayWorkedDays: 0, dcDays: 0,
        }),
      },
      employeeSalaryValue: { findMany: vi.fn().mockResolvedValue([{ componentDefId: "gp1", value: 0 }]) },
      attendanceRecord: { findMany: vi.fn().mockResolvedValue([]) },
      payrollItemLine: {
        findMany: vi.fn().mockResolvedValue([
          { componentDefId: "gp1", adjustmentAmount: "100000.00", adjustmentNote: "Koreksi manual" },
        ]),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    };
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

    const res = await PUT(req({ outdoorDays: 2 }), { params } as never);
    expect(res.status).toBe(200);

    const rows = tx.payrollItemLine.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].adjustmentNote).toBe("Koreksi manual");
    expect(rows[0].adjustmentAmount.toString()).toBe("100000");
    expect(rows[0].finalAmount.toString()).toBe("100000");

    const totals = tx.payrollItem.update.mock.calls.at(-1)![0].data;
    expect(totals.grossAmount.toString()).toBe("100000");
    expect(totals.netAmount.toString()).toBe("100000");
  });
});

describe("PUT .../variables — HRX-4 day counts bounded by the period", () => {
  it("400s with per-field messages when Hari Outdoor 99 / Hari DC 31 exceed a 30-day period", async () => {
    db.salaryComponentDef.findMany.mockResolvedValue([
      { id: "gp1", code: "gaji_pokok", label: "Gaji Pokok", category: "INCOME", calcType: "FIXED", isProRated: false, sortOrder: 1 },
    ]);
    const res = await PUT(req({ outdoorDays: 99, dcDays: 31 }), { params } as never);
    // 99 is also above the schema's own ceiling, so assert on the DC field (route bound)
    expect(res.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();

    const res2 = await PUT(req({ dcDays: 31 }), { params } as never);
    expect(res2.status).toBe(400);
    const body = await res2.json();
    expect(body.errors).toEqual([{ field: "dcDays", message: "Hari DC harus antara 0 dan 30 hari." }]);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
