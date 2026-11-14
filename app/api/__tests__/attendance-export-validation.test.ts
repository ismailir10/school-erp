/**
 * F-11 coverage for `GET /api/attendance/export`.
 *
 * Pre-fix: garbage `month=foo&year=bar` was `parseInt`-ed to `NaN` and the
 * route still returned 200 with a misleading non-empty CSV (header rows
 * + every employee with all-zero counts). Post-fix: bad month/year is a 400
 * before any DB read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const employeeFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    employee: { findMany: employeeFindMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

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

async function mockSession(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}

beforeEach(() => {
  vi.clearAllMocks();
  employeeFindMany.mockResolvedValue([]);
});

describe("GET /api/attendance/export — F-11 validation", () => {
  it("includes daily SICK and PERMISSION marks in excused and total days", async () => {
    await mockSession(adminSession());
    employeeFindMany.mockResolvedValue([{ kode: "E1", nama: "Guru", jabatan: "Guru", campus: { name: "Kampus" }, attendanceRecords: [
      { status: "SICK", approvalStatus: "APPROVED" }, { status: "PERMISSION", approvalStatus: "APPROVED" },
    ] }]);
    const { GET } = await import("../attendance/export/route");
    const response = await GET(new Request("http://localhost/api/attendance/export?month=11&year=2026") as never);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"E1","Guru","Kampus","Guru","0","0","0","2","0","2"');
  });

  it("rejects non-numeric month with 400 and does not query employees", async () => {
    await mockSession(adminSession());
    const { GET } = await import("../attendance/export/route");

    const res = await GET(
      new Request("http://localhost/api/attendance/export?month=foo&year=2026") as never,
    );

    expect(res.status).toBe(400);
    expect(employeeFindMany).not.toHaveBeenCalled();
  });

  it("rejects out-of-range month (13) with 400", async () => {
    await mockSession(adminSession());
    const { GET } = await import("../attendance/export/route");

    const res = await GET(
      new Request("http://localhost/api/attendance/export?month=13&year=2026") as never,
    );

    expect(res.status).toBe(400);
    expect(employeeFindMany).not.toHaveBeenCalled();
  });

  it("rejects out-of-range year (1900) with 400", async () => {
    await mockSession(adminSession());
    const { GET } = await import("../attendance/export/route");

    const res = await GET(
      new Request("http://localhost/api/attendance/export?month=5&year=1900") as never,
    );

    expect(res.status).toBe(400);
    expect(employeeFindMany).not.toHaveBeenCalled();
  });

  it("rejects decimal month '1.5' (parseInt would silently truncate to 1)", async () => {
    await mockSession(adminSession());
    const { GET } = await import("../attendance/export/route");

    const res = await GET(
      new Request("http://localhost/api/attendance/export?month=1.5&year=2026") as never,
    );

    expect(res.status).toBe(400);
    expect(employeeFindMany).not.toHaveBeenCalled();
  });

  it("rejects trailing-junk month '1abc'", async () => {
    await mockSession(adminSession());
    const { GET } = await import("../attendance/export/route");

    const res = await GET(
      new Request("http://localhost/api/attendance/export?month=1abc&year=2026") as never,
    );

    expect(res.status).toBe(400);
    expect(employeeFindMany).not.toHaveBeenCalled();
  });

  it("accepts valid month/year and returns CSV", async () => {
    await mockSession(adminSession());
    const { GET } = await import("../attendance/export/route");

    const res = await GET(
      new Request("http://localhost/api/attendance/export?month=5&year=2026") as never,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(employeeFindMany).toHaveBeenCalledOnce();
  });
});
