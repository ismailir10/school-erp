/**
 * STR-2 / STR-8 — staff attendance routes are HR data.
 *
 * TEACHER holds `attendance.view` (own record, served by /api/attendance/my),
 * so the four admin routes must also require `hr.view`. The CSV export must
 * quote every cell and neutralise formula-leading values.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

vi.mock("@/lib/db", () => ({
  prisma: {
    employee: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    attendanceRecord: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function session(role: SessionUser["role"], extra: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role,
    tenantId: "t1",
    employeeId: role === "TEACHER" ? "emp-self" : null,
    parentId: null,
    permissions: getSystemRolePermissions(role),
    customRoleCode: null,
    ...extra,
  };
}

async function mockSession(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const ROUTES: { name: string; call: () => Promise<Response> }[] = [
  {
    name: "GET /api/attendance/today",
    call: async () => (await import("../attendance/today/route")).GET(new Request("http://localhost/api/attendance/today") as never),
  },
  {
    name: "GET /api/attendance/monthly",
    call: async () =>
      (await import("../attendance/monthly/route")).GET(
        new Request("http://localhost/api/attendance/monthly?month=10&year=2026&campusId=all") as never,
      ),
  },
  {
    name: "GET /api/attendance/export",
    call: async () =>
      (await import("../attendance/export/route")).GET(
        new Request("http://localhost/api/attendance/export?month=10&year=2026") as never,
      ),
  },
  {
    name: "GET /api/employees/[id]/attendance",
    call: async () =>
      (await import("../employees/[id]/attendance/route")).GET(
        new Request("http://localhost/api/employees/emp-other/attendance") as never,
        idParams("emp-other"),
      ),
  },
];

beforeEach(async () => {
  vi.clearAllMocks();
  const { prisma } = await import("@/lib/db");
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-other", tenantId: "t1", nama: "Bu Lain" } as never);
});

describe.each(ROUTES)("$name", ({ call }) => {
  it("403 (hr.view) for TEACHER, who holds attendance.view for their own record", async () => {
    const s = session("TEACHER");
    expect(s.permissions).toContain("attendance.view");
    expect(s.permissions).not.toContain("hr.view");
    await mockSession(s);
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).missing).toBe("hr.view");
    const { prisma } = await import("@/lib/db");
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it("403 for a role holding attendance.view but not hr.view", async () => {
    await mockSession(session("SCHOOL_ADMIN", { permissions: ["attendance.view"] }));
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).missing).toBe("hr.view");
  });

  it("401 with no session", async () => {
    await mockSession(null);
    expect((await call()).status).toBe(401);
  });

  it("200 for SUPER_ADMIN", async () => {
    await mockSession(session("SUPER_ADMIN"));
    expect((await call()).status).toBe(200);
  });

  it("200 for a custom role holding both attendance.view and hr.view", async () => {
    await mockSession(session("SCHOOL_ADMIN", { permissions: ["attendance.view", "hr.view"] }));
    expect((await call()).status).toBe(200);
  });
});

describe("GET /api/attendance/export — CSV escaping (STR-8)", () => {
  it("quotes every cell, doubles quotes and neutralises formula-leading cells", async () => {
    await mockSession(session("SUPER_ADMIN"));
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        kode: "AB1",
        nama: '=HYPERLINK("http://evil","klik")',
        campus: { name: "Aster, Utama" },
        jabatan: 'Guru "Senior"',
        attendanceRecords: [{ status: "PRESENT" }, { status: "LATE" }, { status: "ABSENT" }],
      },
      {
        kode: "AB2",
        nama: "+1+1",
        campus: { name: "@SUM(A1)" },
        jabatan: "-2",
        attendanceRecords: [],
      },
    ] as never);
    const { GET } = await import("../attendance/export/route");
    const res = await GET(new Request("http://localhost/api/attendance/export?month=10&year=2026") as never);
    expect(res.status).toBe(200);
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Kode","Nama","Kampus","Jabatan","Hadir","Terlambat","Alpa","Izin","Total Hari"');
    expect(lines[1]).toBe(
      `"AB1","'=HYPERLINK(""http://evil"",""klik"")","Aster, Utama","Guru ""Senior""","1","1","1","0","2"`,
    );
    expect(lines[2]).toBe(`"AB2","'+1+1","'@SUM(A1)","'-2","0","0","0","0","0"`);
  });
});
