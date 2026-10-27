import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cycle 2026-10-27-class-program-visibility (T1): GET
 * /api/admin/classes/[id]/program-impact — the preview behind Ubah Kelas'
 * "Program" field. Read-only, tenant-scoped.
 */

const { requirePermission, db } = vi.hoisted(() => {
  const db = {
    classSection: { findFirst: vi.fn() },
    program: { findFirst: vi.fn() },
    studentEnrollment: { count: vi.fn() },
    invoice: { findMany: vi.fn() },
    billingRunRow: { findMany: vi.fn() },
    programFeeStructure: { findMany: vi.fn() },
  };
  return { requirePermission: vi.fn(), db };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { GET } from "@/app/api/admin/classes/[id]/program-impact/route";

const ALLOW = {
  session: {
    tenantId: "t1",
    id: "u1",
    role: "SCHOOL_ADMIN",
    permissions: ["academic.view", "fees.view"],
  },
};
const ctx = { params: Promise.resolve({ id: "c1" }) };
const call = (qs = "") =>
  GET(new Request(`http://localhost/api/admin/classes/c1/program-impact${qs}`) as never, ctx);

const fee = (label: string, amount: string) => ({
  amount,
  feeComponent: { label, sortOrder: 1 },
});

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue(ALLOW);
  db.classSection.findFirst.mockResolvedValue({
    id: "c1",
    academicYearId: "ay1",
    program: { id: "p-b", name: "TK B" },
    academicYear: { id: "ay1", name: "2026/2027", startDate: "2026-07-01" },
  });
  db.program.findFirst.mockResolvedValue({ id: "p-a", name: "TK A" });
  db.studentEnrollment.count.mockResolvedValue(13);
  db.invoice.findMany.mockResolvedValue([]);
  db.billingRunRow.findMany.mockResolvedValue([]);
  db.programFeeStructure.findMany.mockImplementation(
    async (args: { where: { programId: string } }) =>
      args.where.programId === "p-a" ? [fee("SPP Bulanan", "499000.00")] : [fee("SPP Bulanan", "504000.00")],
  );
});

describe("GET /api/admin/classes/[id]/program-impact", () => {
  it("returns the current and prospective recurring fees with the affected student count", async () => {
    const res = await call("?programId=p-a");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      academicYear: { id: "ay1", name: "2026/2027" },
      activeStudents: 13,
      invoicedStudents: 0,
      blockedReason: null,
      current: {
        programId: "p-b",
        programName: "TK B",
        fees: { total: 504000, lines: [{ label: "SPP Bulanan", amount: 504000 }] },
      },
      next: {
        programId: "p-a",
        programName: "TK A",
        fees: { total: 499000, lines: [{ label: "SPP Bulanan", amount: 499000 }] },
      },
    });
  });

  it("reads only the billable (enabled, recurring) fees of the class's own year", async () => {
    await call("?programId=p-a");

    expect(db.programFeeStructure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "t1",
          programId: "p-a",
          academicYearId: "ay1",
          feeComponent: { isEnabled: true, isRecurring: true },
        },
      }),
    );
  });

  it("reports why the move is blocked when students already hold invoices", async () => {
    db.invoice.findMany.mockResolvedValue([{ studentId: "s1" }]);

    const body = await (await call("?programId=p-a")).json();

    expect(body.invoicedStudents).toBe(1);
    expect(body.blockedReason).toContain("1 siswa");
  });

  it("returns only the current program when no target is given", async () => {
    const body = await (await call()).json();

    expect(body.next).toBeNull();
    expect(db.program.findFirst).not.toHaveBeenCalled();
  });

  it("looks the class and target program up inside the caller's tenant", async () => {
    await call("?programId=p-a");

    expect(db.classSection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", tenantId: "t1" } }),
    );
    expect(db.program.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p-a", tenantId: "t1", status: "ACTIVE" } }),
    );
  });

  it("404s on an unknown class or a foreign program", async () => {
    db.classSection.findFirst.mockResolvedValue(null);
    expect((await call("?programId=p-a")).status).toBe(404);

    db.classSection.findFirst.mockResolvedValue({
      id: "c1",
      academicYearId: "ay1",
      program: { id: "p-b", name: "TK B" },
      academicYear: { id: "ay1", name: "2026/2027", startDate: "2026-07-01" },
    });
    db.program.findFirst.mockResolvedValue(null);
    expect((await call("?programId=other-tenant")).status).toBe(404);
  });

  it("keeps fee data from a role that can view classes but not fees", async () => {
    requirePermission.mockResolvedValue({
      session: { tenantId: "t1", id: "u2", role: "CUSTOM", permissions: ["academic.view"] },
    });

    const res = await call("?programId=p-a");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", missing: "fees.view" });
    expect(db.programFeeStructure.findMany).not.toHaveBeenCalled();
  });

  it("passes the permission guard's refusal straight through", async () => {
    const denied = new Response(null, { status: 403 });
    requirePermission.mockResolvedValue({ error: denied });

    expect(await call()).toBe(denied);
  });
});
