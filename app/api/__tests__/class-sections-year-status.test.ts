/**
 * class-picker-year-scoping cycle — `GET /api/class-sections` `yearStatus` filter.
 *
 * The route previously only filtered on `programId`/`academicYearId`; every
 * admin class picker calls it with no params and gets back all sections
 * across every academic year (53 rows across 5 years in production).
 * `yearStatus` is an opt-in, comma-separated allowlist of
 * `AcademicYear.status` (PLANNING | ACTIVE | ARCHIVED) filtered via the
 * `academicYear` relation. Omitting it (or supplying only garbage tokens)
 * must be byte-identical to today's unfiltered behaviour — four existing
 * callers depend on that.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const classSectionFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    classSection: { findMany: classSectionFindMany },
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

const SECTION_ACTIVE_YEAR = {
  id: "cs-1",
  name: "Kelas A",
  academicYear: { id: "y-2026", name: "2026/2027", status: "ACTIVE" },
};
const SECTION_ARCHIVED_YEAR = {
  id: "cs-2",
  name: "Kelas B",
  academicYear: { id: "y-2020", name: "2020/2021", status: "ARCHIVED" },
};

beforeEach(() => {
  vi.clearAllMocks();
  classSectionFindMany.mockResolvedValue([]);
});

describe("GET /api/class-sections — yearStatus filter", () => {
  it("yearStatus=ACTIVE,PLANNING excludes ARCHIVED sections", async () => {
    await mockSession(adminSession());
    classSectionFindMany.mockResolvedValue([SECTION_ACTIVE_YEAR]);
    const { GET } = await import("../class-sections/route");

    const res = await GET(
      new Request(
        "http://localhost/api/class-sections?yearStatus=ACTIVE,PLANNING",
      ) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([SECTION_ACTIVE_YEAR]);

    expect(classSectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          academicYear: { status: { in: ["ACTIVE", "PLANNING"] } },
        }),
      }),
    );
  });

  it("omitting yearStatus returns all sections (byte-identical to today)", async () => {
    await mockSession(adminSession());
    classSectionFindMany.mockResolvedValue([
      SECTION_ACTIVE_YEAR,
      SECTION_ARCHIVED_YEAR,
    ]);
    const { GET } = await import("../class-sections/route");

    const res = await GET(
      new Request("http://localhost/api/class-sections") as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([SECTION_ACTIVE_YEAR, SECTION_ARCHIVED_YEAR]);

    const call = classSectionFindMany.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId: "t-1" });
    expect(call.where.academicYear).toBeUndefined();
  });

  it("garbage yearStatus value (BOGUS) behaves as if absent", async () => {
    await mockSession(adminSession());
    classSectionFindMany.mockResolvedValue([
      SECTION_ACTIVE_YEAR,
      SECTION_ARCHIVED_YEAR,
    ]);
    const { GET } = await import("../class-sections/route");

    const res = await GET(
      new Request("http://localhost/api/class-sections?yearStatus=BOGUS") as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([SECTION_ACTIVE_YEAR, SECTION_ARCHIVED_YEAR]);

    const call = classSectionFindMany.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId: "t-1" });
    expect(call.where.academicYear).toBeUndefined();
  });

  it("response carries academicYear.status via the extended select", async () => {
    await mockSession(adminSession());
    classSectionFindMany.mockResolvedValue([SECTION_ACTIVE_YEAR]);
    const { GET } = await import("../class-sections/route");

    await GET(new Request("http://localhost/api/class-sections") as never);

    expect(classSectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          academicYear: { select: { id: true, name: true, status: true } },
        }),
      }),
    );
  });
});

describe("GET /api/class-sections — seat count (R2-ADMIN-4)", () => {
  it("counts only ACTIVE enrolments so a withdrawn student frees the seat", async () => {
    await mockSession(adminSession());
    classSectionFindMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/class-sections/route");
    await GET(new Request("http://localhost/api/class-sections") as never);
    const arg = classSectionFindMany.mock.calls.at(-1)![0];
    expect(arg.include._count).toEqual({
      select: { enrollments: { where: { status: "ACTIVE" } } },
    });
  });
});
