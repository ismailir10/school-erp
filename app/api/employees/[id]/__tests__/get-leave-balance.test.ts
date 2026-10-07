import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  hasPermission: vi.fn(),
  employeeFindUnique: vi.fn(),
  sumLeaveDays: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { employee: { findUnique: h.employeeFindUnique } } }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: h.requirePermission }));
vi.mock("@/lib/permissions", () => ({ hasPermission: h.hasPermission }));
vi.mock("@/lib/leave/balance", () => ({ sumLeaveDays: h.sumLeaveDays }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { GET } from "../route";

const ctx = { params: Promise.resolve({ id: "emp-1" }) };
const call = () => GET(new NextRequest("http://localhost/api/employees/emp-1"), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  h.requirePermission.mockResolvedValue({ session: { id: "u1", tenantId: "t-1" } });
  h.hasPermission.mockReturnValue(true);
  h.employeeFindUnique.mockResolvedValue({
    id: "emp-1",
    tenantId: "t-1",
    nama: "Budi",
    bankAccountNo: "123",
    bankName: "BCA",
    bpjsEnrolled: true,
    leaveBalanceAnnual: 12,
    leaveBalanceSick: 14,
  });
  h.sumLeaveDays.mockImplementation(async (_db, args: { leaveType: string }) =>
    args.leaveType === "ANNUAL" ? 3 : 1,
  );
});

describe("GET /api/employees/[id] — Saldo Cuti", () => {
  it("returns APPROVED days used this year for ANNUAL and SICK next to the allowance", async () => {
    const body = await (await call()).json();
    expect(body.leaveBalanceAnnual).toBe(12);
    expect(body.leaveUsedAnnual).toBe(3);
    expect(body.leaveUsedSick).toBe(1);
    expect(h.sumLeaveDays).toHaveBeenCalledWith(expect.anything(), {
      employeeId: "emp-1",
      leaveType: "ANNUAL",
      statuses: ["APPROVED"],
    });
    expect(h.sumLeaveDays).toHaveBeenCalledWith(expect.anything(), {
      employeeId: "emp-1",
      leaveType: "SICK",
      statuses: ["APPROVED"],
    });
  });

  it("includes usage for viewers without payroll access, still hiding bank fields", async () => {
    h.hasPermission.mockReturnValue(false);
    const body = await (await call()).json();
    expect(body.leaveUsedAnnual).toBe(3);
    expect(body.bankAccountNo).toBeUndefined();
  });

  it("does not compute usage for another tenant's employee", async () => {
    h.employeeFindUnique.mockResolvedValue({ id: "emp-1", tenantId: "other" });
    const res = await call();
    expect(res.status).toBe(404);
    expect(h.sumLeaveDays).not.toHaveBeenCalled();
  });
});
