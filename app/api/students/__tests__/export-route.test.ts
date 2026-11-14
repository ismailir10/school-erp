/**
 * Coverage for GET /api/students/export.
 *
 * Auth gates (401/403), criteria validation (400), tenant scoping, the
 * ACTIVE-enrollment `some` filter shape, column-subset honoring, and the
 * empty-result header-only-CSV contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const studentFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { student: { findMany: studentFindMany } },
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

function guardianSession(): SessionUser {
  return { ...adminSession(), role: "GUARDIAN", permissions: getSystemRolePermissions("GUARDIAN") };
}

async function mockSession(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}

function sampleRow() {
  return {
    name: "Aisyah Putri",
    nickname: "Aisyah",
    gender: "P",
    birthPlace: "Jakarta",
    dateOfBirth: "2020-03-15",
    status: "ACTIVE",
    nis: "001",
    nisn: "1234567890",
    nik: "3173000000000001",
    kkNumber: "3173111111111111",
    address: "Jl. Melati No. 1",
    livingWith: "ORANG_TUA",
    enrollments: [
      {
        enrollDate: "2025-07-01",
        classSection: { name: "TKIT A", program: { name: "TK" }, academicYear: { name: "2025/2026" } },
      },
    ],
    guardians: [{ parent: { name: "Budi", phone: "0812" } }],
  };
}

function call(qs = "") {
  return import("../export/route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/students/export${qs}`) as never),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  studentFindMany.mockResolvedValue([]);
});

describe("GET /api/students/export", () => {
  it("401 when no session", async () => {
    await mockSession(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(studentFindMany).not.toHaveBeenCalled();
  });

  it("403 for a non-admin role", async () => {
    await mockSession(guardianSession());
    const res = await call();
    expect(res.status).toBe(403);
    expect(studentFindMany).not.toHaveBeenCalled();
  });

  it("400 on invalid status, without querying", async () => {
    await mockSession(adminSession());
    const res = await call("?status=BOGUS");
    expect(res.status).toBe(400);
    expect(studentFindMany).not.toHaveBeenCalled();
  });

  it("400 on invalid gender", async () => {
    await mockSession(adminSession());
    const res = await call("?gender=X");
    expect(res.status).toBe(400);
    expect(studentFindMany).not.toHaveBeenCalled();
  });

  it("200 with CSV headers + header-only body on empty result", async () => {
    await mockSession(adminSession());
    const res = await call("?columns=name,nis");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename="siswa_\d{4}-\d{2}-\d{2}\.csv"/);
    expect(await res.text()).toBe('"Nama Lengkap","NIS"\r\n');
  });

  it("scopes the query to the session tenant", async () => {
    await mockSession(adminSession());
    await call();
    expect(studentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: "t-1" }) }),
    );
  });

  it("builds an ACTIVE-enrollment `some` filter from class/program/year criteria", async () => {
    await mockSession(adminSession());
    await call("?classSectionId=cs1&programId=p1&academicYearId=ay1");
    const arg = studentFindMany.mock.calls[0][0];
    expect(arg.where.enrollments).toEqual({
      some: {
        status: "ACTIVE",
        classSectionId: "cs1",
        classSection: { programId: "p1", academicYearId: "ay1" },
      },
    });
  });

  it("omits the enrollment filter when no class/program/year criteria given", async () => {
    await mockSession(adminSession());
    await call("?status=ACTIVE");
    const arg = studentFindMany.mock.calls[0][0];
    expect(arg.where.enrollments).toBeUndefined();
    expect(arg.where.status).toBe("ACTIVE");
  });

  it("honors the requested column subset in canonical order", async () => {
    await mockSession(adminSession());
    studentFindMany.mockResolvedValue([sampleRow()]);
    const res = await call("?columns=nisn,name");
    const body = await res.text();
    const [header, data] = body.trimEnd().split("\r\n");
    expect(header).toBe('"Nama Lengkap","NISN"');
    expect(data).toBe('"Aisyah Putri","1234567890"');
  });
});

it("denies CSV disclosure to an admissions-only admin", async () => {
 await mockSession({ ...adminSession(), role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
 expect((await call()).status).toBe(403);
 expect(studentFindMany).not.toHaveBeenCalled();
});
