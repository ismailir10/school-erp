/**
 * Every human-facing CSV download starts with a UTF-8 BOM so Excel does not
 * garble non-ASCII names (ADM-15), and the HR attendance "Total Hari" counts
 * Hadir + Terlambat + Izin (HR-14). The BSI bank-upload file is machine-read
 * and must stay BOM-free.
 *
 * `Response.text()` strips a leading BOM, so assertions read raw bytes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const { employeeFindMany, studentFindMany, payrollFindUnique, payrollUpdateMany, requirePermission } =
  vi.hoisted(() => ({
    employeeFindMany: vi.fn(),
    studentFindMany: vi.fn(),
    payrollFindUnique: vi.fn(),
    payrollUpdateMany: vi.fn(),
    requirePermission: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    employee: { findMany: employeeFindMany },
    student: { findMany: studentFindMany },
    payrollRun: { findUnique: payrollFindUnique, updateMany: payrollUpdateMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

vi.mock("@/lib/auth-guards", () => ({ requirePermission }));

vi.mock("@/lib/attendance/student-recap", () => ({
  resolveRecapRequest: vi.fn(async () => ({ ok: true, rows: [], month: 5, year: 2026 })),
  buildRecapCsv: vi.fn(() => '"Nama"\r\n"Ā é"\r\n'),
}));

vi.mock("@/lib/finance/payments-ledger", () => ({
  resolveLedgerRequest: vi.fn(async () => ({
    ok: true,
    rows: [],
    dateFrom: "2026-05-01",
    dateTo: "2026-05-31",
  })),
  buildLedgerCsv: vi.fn(() => '"Tanggal"\r\n'),
}));

function adminSession(): SessionUser {
  return {
    id: "u1",
    email: "a@a",
    name: "A",
    role: "SUPER_ADMIN",
    tenantId: "t-1",
    employeeId: null,
    parentId: null,
    permissions: getSystemRolePermissions("SUPER_ADMIN"),
    customRoleCode: null,
  };
}

async function bytes(res: Response) {
  return new Uint8Array(await res.arrayBuffer());
}

function startsWithBom(b: Uint8Array) {
  return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(adminSession());
  requirePermission.mockResolvedValue({ session: adminSession() });
  employeeFindMany.mockResolvedValue([]);
  studentFindMany.mockResolvedValue([]);
});

describe("CSV exports start with a UTF-8 BOM", () => {
  it("attendance export", async () => {
    const { GET } = await import("../attendance/export/route");
    const res = await GET(new Request("http://x/api/attendance/export?month=5&year=2026") as never);
    expect(startsWithBom(await bytes(res))).toBe(true);
  });

  it("student attendance export", async () => {
    const { GET } = await import("../student-attendance/export/route");
    const res = await GET(new Request("http://x/api/student-attendance/export") as never);
    const b = await bytes(res);
    expect(startsWithBom(b)).toBe(true);
    // Exactly one BOM, then the CSV body.
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(b)).toBe('﻿"Nama"\r\n"Ā é"\r\n');
  });

  it("students export", async () => {
    const { GET } = await import("../students/export/route");
    const res = await GET(new Request("http://x/api/students/export") as never);
    expect(startsWithBom(await bytes(res))).toBe(true);
  });

  it("payments export", async () => {
    const { GET } = await import("../payments/export/route");
    const res = await GET(new Request("http://x/api/payments/export") as never);
    expect(startsWithBom(await bytes(res))).toBe(true);
  });
});

describe("BSI payroll export is a bank upload file", () => {
  it("has NO BOM (it would corrupt the first header cell for the bank parser)", async () => {
    payrollFindUnique.mockResolvedValue({
      id: "p1",
      tenantId: "t-1",
      status: "APPROVED",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      items: [{ netAmount: 1000, employee: { nama: "Aisyah", bankAccountNo: "123" } }],
    });
    payrollUpdateMany.mockResolvedValue({ count: 1 });
    const { GET } = await import("../payroll/[id]/export/bsi/route");
    const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "p1" }) });
    const b = await bytes(res);
    expect(startsWithBom(b)).toBe(false);
    expect(new TextDecoder().decode(b).startsWith("rekening_tujuan,")).toBe(true);
  });
});

describe("HR-14: attendance export 'Total Hari'", () => {
  it("equals Hadir + Terlambat + Izin (Alpa excluded)", async () => {
    employeeFindMany.mockResolvedValue([
      {
        kode: "E1",
        nama: "Aisyah",
        jabatan: "Guru",
        campus: { name: "Aster" },
        attendanceRecords: [
          { status: "PRESENT" },
          { status: "PRESENT_NO_CHECKOUT" },
          { status: "LATE" },
          { status: "LEAVE" },
          { status: "LEAVE" },
          { status: "ABSENT" },
        ],
      },
    ]);
    const { GET } = await import("../attendance/export/route");
    const res = await GET(new Request("http://x/api/attendance/export?month=5&year=2026") as never);
    const lines = (await res.text()).trim().split("\r\n");
    // Hadir 2, Terlambat 1, Alpa 1, Izin 2, Total Hari 2+1+2 = 5
    expect(lines[0]).toContain('"Total Hari"');
    expect(lines[1]).toBe('"E1","Aisyah","Aster","Guru","2","1","1","2","5"');
  });
});
