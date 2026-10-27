/**
 * Cycle 2026-10-27-class-program-visibility (T4) — `GET /api/class-sections`
 * `include=fees`: the billing wizard asks for the per-period fee each class
 * would be billed (its own program, its own year). Opt-in, so every other
 * caller's response stays as it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

const classSectionFindMany = vi.fn();
const feeStructureFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    classSection: { findMany: classSectionFindMany },
    programFeeStructure: { findMany: feeStructureFindMany },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function session(role: SessionUser["role"] = "SUPER_ADMIN"): SessionUser {
  return {
    id: "u1",
    email: "a@a",
    name: "A",
    role,
    tenantId: "t-1",
    employeeId: null,
    parentId: null,
    permissions: getSystemRolePermissions(role),
    customRoleCode: null,
  };
}

async function mockSession(s: SessionUser | null) {
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(s);
}

const section = (id: string, programId: string, academicYearId = "y1") => ({
  id,
  name: id,
  programId,
  academicYearId,
});

const call = async (qs: string) => {
  const { GET } = await import("../class-sections/route");
  return GET(new Request(`http://localhost/api/class-sections${qs}`) as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  classSectionFindMany.mockResolvedValue([
    section("tka", "p-a"),
    section("tkb", "p-b"),
    section("kb", "p-none"),
    section("tka-next", "p-a", "y2"),
  ]);
  feeStructureFindMany.mockResolvedValue([
    { programId: "p-a", academicYearId: "y1", amount: "499000.00" },
    { programId: "p-b", academicYearId: "y1", amount: "504000.00" },
    { programId: "p-b", academicYearId: "y1", amount: "100000.00" },
  ]);
});

describe("GET /api/class-sections?include=fees", () => {
  it("adds each section's recurring fee total for its own program and year", async () => {
    await mockSession(session());

    const body = await (await call("?include=fees")).json();

    expect(body.map((s: { id: string; recurringFeeTotal: number | null }) => [s.id, s.recurringFeeTotal])).toEqual([
      ["tka", 499000],
      ["tkb", 604000], // two recurring components add up
      ["kb", null], // no billable fee line at all
      ["tka-next", null], // same program, but nothing set for that year
    ]);
  });

  it("reads only this tenant's billable (enabled, recurring) fees for the sections' programs and years", async () => {
    await mockSession(session());

    await call("?include=fees");

    expect(feeStructureFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "t-1",
          programId: { in: ["p-a", "p-b", "p-none"] },
          academicYearId: { in: ["y1", "y2"] },
          feeComponent: { isEnabled: true, isRecurring: true },
        },
      }),
    );
  });

  it("leaves the response and the queries untouched without include=fees", async () => {
    await mockSession(session());

    const body = await (await call("")).json();

    expect(feeStructureFindMany).not.toHaveBeenCalled();
    expect(body[0]).not.toHaveProperty("recurringFeeTotal");
  });

  it("ignores an unknown include value", async () => {
    await mockSession(session());

    await call("?include=everything");

    expect(feeStructureFindMany).not.toHaveBeenCalled();
  });

  it("leaves the fee key out (not null) for a role with no finance permission", async () => {
    await mockSession({ ...session("SCHOOL_ADMIN"), permissions: ["academic.view"] });

    const body = await (await call("?include=fees")).json();

    expect(feeStructureFindMany).not.toHaveBeenCalled();
    expect(body).toHaveLength(4);
    expect(body[0]).not.toHaveProperty("recurringFeeTotal");
  });

  it("serves the fees to a role holding only invoices.view", async () => {
    await mockSession({ ...session("SCHOOL_ADMIN"), permissions: ["invoices.view"] });

    const body = await (await call("?include=fees")).json();

    expect(body[0].recurringFeeTotal).toBe(499000);
  });

  it("is still admin-only", async () => {
    await mockSession(session("TEACHER"));

    const res = await call("?include=fees");

    expect(res.status).toBe(403);
    expect(feeStructureFindMany).not.toHaveBeenCalled();
  });
});
