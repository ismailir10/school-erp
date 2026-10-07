/**
 * POST /api/payroll/[id]/approve — HRX-5: a run can only be approved once its
 * period is over (Asia/Jakarta); approving locks attendance and shows slips.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { requirePermission, db } = vi.hoisted(() => {
  const db = {
    payrollRun: { findUnique: vi.fn(), updateMany: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    attendanceRecord: { updateMany: vi.fn() },
  };
  return { requirePermission: vi.fn(), db };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({ hasPermission: () => true }));

import { POST } from "../route";

const ALLOW = { session: { tenantId: "t1", id: "u1", role: "SUPER_ADMIN" } };
const params = Promise.resolve({ id: "run1" });
const call = () => POST(new Request("http://t/api/payroll/run1/approve", { method: "POST" }) as never, { params } as never);

function run(overrides: Record<string, unknown> = {}) {
  db.payrollRun.findUnique.mockResolvedValue({
    id: "run1", tenantId: "t1", status: "DRAFT",
    periodStart: "2026-10-06", periodEnd: "2026-10-20", ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // 7 Oct 2026, 10:00 WIB
  vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
  requirePermission.mockResolvedValue(ALLOW);
  db.payrollItem.findMany.mockResolvedValue([{ employeeId: "e1", netAmount: 1_000_000, employee: { nama: "Budi" } }]);
  db.payrollRun.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

describe("POST /api/payroll/[id]/approve — period must have ended", () => {
  it("409s while the period is still running, naming the first approvable day", async () => {
    run();
    const res = await call();
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error).toMatch(/^Periode belum selesai\. Penggajian bisa disetujui mulai /);
    expect(error).toContain("21");
    expect(error).toContain("2026");
    expect(db.payrollRun.updateMany).not.toHaveBeenCalled();
    expect(db.attendanceRecord.updateMany).not.toHaveBeenCalled();
  });

  it("still 409s on the last day of the period (the day is not over yet)", async () => {
    run({ periodEnd: "2026-10-07" });
    expect((await call()).status).toBe(409);
  });

  it("uses the Jakarta calendar day, not UTC (18:00 UTC on the 19th is already the 20th in WIB)", async () => {
    vi.setSystemTime(new Date("2026-10-19T18:00:00Z"));
    run({ periodEnd: "2026-10-19" });
    expect((await call()).status).toBe(200);
  });

  it("approves once the period ended before today", async () => {
    run({ periodEnd: "2026-10-06" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(db.payrollRun.updateMany).toHaveBeenCalled();
    expect(db.attendanceRecord.updateMany).toHaveBeenCalled();
  });

  it("an already-approved run keeps the old 'only drafts' 409, not the period message", async () => {
    run({ status: "APPROVED" });
    db.payrollRun.updateMany.mockResolvedValue({ count: 0 });
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Hanya draf yang bisa disetujui");
  });
});
