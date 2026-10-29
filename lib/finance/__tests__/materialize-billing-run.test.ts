import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { materializeBillingRun, findAlreadyInvoicedStudentIds } from "../materialize-billing-run";

type Enrollment = {
  studentId: string;
  classSectionId: string;
  studentStatus: string;
  programId?: string;
  /** Placement status; default ACTIVE. */
  status?: string;
  id?: string;
};

const ENROLLMENTS: Enrollment[] = [
  { studentId: "s-active", classSectionId: "cls-1", studentStatus: "ACTIVE" },
  // Leftover ACTIVE enrollment on a student who has since left (FINX-5).
  { studentId: "s-withdrawn", classSectionId: "cls-1", studentStatus: "WITHDRAWN" },
  { studentId: "s-graduated", classSectionId: "cls-1", studentStatus: "GRADUATED" },
  { studentId: "s-inactive-extra", classSectionId: "cls-9", studentStatus: "INACTIVE" },
];

type FakeLeave = { enrollmentId: string; status: string; startMonth: string; endMonth: string; tenantId?: string };

/**
 * Minimal Prisma stand-in: honours the `student.status` filter the way the DB would, and the
 * `enrollmentLeave` where-clause (tenant, enrollment ids, status, inclusive month range).
 */
function fakeDb(
  invoices: { studentId: string; periodLabel: string }[] = [],
  leaves: FakeLeave[] = [],
  enrollments: Enrollment[] = ENROLLMENTS,
  bundleRows: { schoolProgramId: string; daycareProgramId: string; feeComponentId: string; amount: Prisma.Decimal }[] = [],
) {
  type SomeEnrollment = {
    status?: string;
    classSection?: { tenantId?: string; academicYearId?: string; id?: { in: string[] } };
  };
  type OrClause = { studentId?: { in: string[] }; student?: { enrollments?: { some?: SomeEnrollment } } };
  const enrollmentFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
    const where = args.where as { status?: string; student?: { status?: string }; OR: OrClause[] };
    const placementOf = (e: Enrollment) => ({ ...e, status: e.status ?? "ACTIVE" });
    return enrollments
      .map(placementOf)
      .filter((e) => {
        if (where.status && e.status !== where.status) return false;
        if (where.student?.status && e.studentStatus !== where.student.status) return false;
        return where.OR.some((c) => {
          if (c.studentId) return c.studentId.in.includes(e.studentId);
          const some = c.student?.enrollments?.some;
          if (some) {
            // "Does the student hold ANY placement matching `some`?" — the sibling rows count.
            return enrollments.map(placementOf).some(
              (o) =>
                o.studentId === e.studentId &&
                (!some.status || o.status === some.status) &&
                (!some.classSection?.id || some.classSection.id.in.includes(o.classSectionId)),
            );
          }
          return false;
        });
      })
      .map((e) => ({
        id: e.id ?? `enr-${e.studentId}`,
        studentId: e.studentId,
        classSectionId: e.classSectionId,
        student: { id: e.studentId, name: e.studentId },
        classSection: {
          name: e.programId && e.programId !== "prog-1" ? "Daycare" : "TKIT A",
          programId: e.programId ?? "prog-1",
          program: { name: e.programId && e.programId !== "prog-1" ? "Daycare" : "TKIT" },
        },
      }));
  });
  const invoiceFindMany = vi.fn(async () => invoices);
  const bundleFindMany = vi.fn(async () => bundleRows);
  const leaveFindMany = vi.fn(
    async (args: {
      where: {
        tenantId: string;
        enrollmentId: { in: string[] };
        status: string;
        startMonth: { lte: string };
        endMonth: { gte: string };
      };
    }) => {
      const w = args.where;
      return leaves
        .filter(
          (l) =>
            (l.tenantId ?? "tnt-1") === w.tenantId &&
            w.enrollmentId.in.includes(l.enrollmentId) &&
            l.status === w.status &&
            l.startMonth <= w.startMonth.lte &&
            l.endMonth >= w.endMonth.gte,
        )
        .map((l) => ({ enrollmentId: l.enrollmentId }));
    },
  );
  const db = {
    studentEnrollment: { findMany: enrollmentFindMany },
    programFeeStructure: {
      findMany: vi.fn(async (args: { where: { programId: { in: string[] } } }) =>
        [
          { programId: "prog-1", feeComponentId: "fc-spp", amount: new Prisma.Decimal(500_000), feeComponent: { label: "SPP" } },
          { programId: "prog-dc", feeComponentId: "fc-spp", amount: new Prisma.Decimal(300_000), feeComponent: { label: "SPP" } },
        ].filter((f) => args.where.programId.in.includes(f.programId)),
      ),
    },
    programBundleFee: { findMany: bundleFindMany },
    invoice: { findMany: invoiceFindMany },
    studentGuardian: { findMany: vi.fn(async () => []) },
    studentFeeAdjustment: { findMany: vi.fn(async () => []) },
    enrollmentLeave: { findMany: leaveFindMany },
  };
  return {
    db: db as unknown as Prisma.TransactionClient,
    enrollmentFindMany,
    invoiceFindMany,
    leaveFindMany,
    bundleFindMany,
  };
}

const base = {
  tenantId: "tnt-1",
  academicYearId: "ay-1",
  periodLabel: "Oktober 2026",
  dueDate: "2026-10-31",
};

describe("materializeBillingRun — student status (FINX-5)", () => {
  it("does not bill a WITHDRAWN / GRADUATED student who still has an ACTIVE enrollment row", async () => {
    const { db } = fakeDb();
    const { rows } = await materializeBillingRun(db, {
      ...base,
      scope: { classSectionIds: ["cls-1"], includeStudentIds: [], excludeStudentIds: [] },
    });
    expect(rows.map((r) => r.studentId)).toEqual(["s-active"]);
  });

  it("applies the same filter on the explicit-include path", async () => {
    const { db, enrollmentFindMany } = fakeDb();
    const { rows } = await materializeBillingRun(db, {
      ...base,
      scope: {
        classSectionIds: [],
        includeStudentIds: ["s-inactive-extra", "s-withdrawn", "s-active"],
        excludeStudentIds: [],
      },
    });
    expect(rows.map((r) => r.studentId)).toEqual(["s-active"]);
    expect(enrollmentFindMany.mock.calls[0][0].where).toMatchObject({ student: { status: "ACTIVE" } });
  });
});

describe("materializeBillingRun — per-student run scope", () => {
  const TWO: Enrollment[] = [
    { id: "enr-two-school", studentId: "s-two", classSectionId: "cls-1", studentStatus: "ACTIVE" },
    { id: "enr-two-dc", studentId: "s-two", classSectionId: "cls-dc", studentStatus: "ACTIVE", programId: "prog-dc" },
    { id: "enr-one", studentId: "s-one", classSectionId: "cls-1", studentStatus: "ACTIVE" },
    { id: "enr-far-a", studentId: "s-far", classSectionId: "cls-8", studentStatus: "ACTIVE" },
    { id: "enr-far-b", studentId: "s-far", classSectionId: "cls-dc", studentStatus: "ACTIVE", programId: "prog-dc" },
    { id: "enr-gone-a", studentId: "s-gone", classSectionId: "cls-1", studentStatus: "WITHDRAWN" },
    { id: "enr-gone-b", studentId: "s-gone", classSectionId: "cls-dc", studentStatus: "WITHDRAWN", programId: "prog-dc" },
    // Stale non-ACTIVE placement of s-old must not admit or be priced.
    { id: "enr-old-a", studentId: "s-old", classSectionId: "cls-1", studentStatus: "ACTIVE", status: "WITHDRAWN" },
    { id: "enr-old-b", studentId: "s-old", classSectionId: "cls-dc", studentStatus: "ACTIVE", programId: "prog-dc" },
  ];
  const scope = (over: Partial<{ classSectionIds: string[]; includeStudentIds: string[]; excludeStudentIds: string[] }> = {}) => ({
    classSectionIds: ["cls-1"],
    includeStudentIds: [],
    excludeStudentIds: [],
    ...over,
  });

  it("asks the DB for every active placement of a student who holds a ticked class, scoped to tenant and year", async () => {
    const { db, enrollmentFindMany } = fakeDb([], [], TWO);
    await materializeBillingRun(db, { ...base, scope: scope({ includeStudentIds: ["s-far"] }) });
    expect(enrollmentFindMany.mock.calls[0][0].where).toEqual({
      status: "ACTIVE",
      student: { status: "ACTIVE" },
      OR: [
        {
          student: {
            enrollments: {
              some: {
                status: "ACTIVE",
                classSection: { tenantId: "tnt-1", academicYearId: "ay-1", id: { in: ["cls-1"] } },
              },
            },
          },
        },
        { studentId: { in: ["s-far"] } },
      ],
      classSection: { tenantId: "tnt-1", academicYearId: "ay-1" },
    });
  });

  it("prices a student with one ticked and one non-ticked placement for both, in one row", async () => {
    const { db } = fakeDb([], [], TWO);
    const { rows } = await materializeBillingRun(db, { ...base, scope: scope() });
    const two = rows.filter((r) => r.studentId === "s-two");
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ status: "PENDING" });
    expect(two[0].totalDue.toString()).toBe("800000");
    // s-one holds a single ticked placement: unchanged.
    expect(rows.find((r) => r.studentId === "s-one")!.totalDue.toString()).toBe("500000");
  });

  it("bills the same child the same when only the OTHER class is ticked", async () => {
    const { db } = fakeDb([], [], TWO);
    const { rows } = await materializeBillingRun(db, { ...base, scope: scope({ classSectionIds: ["cls-dc"] }) });
    expect(rows.find((r) => r.studentId === "s-two")!.totalDue.toString()).toBe("800000");
  });

  it("leaves out a student with no ticked placement and no include", async () => {
    const { db } = fakeDb([], [], TWO);
    const { rows } = await materializeBillingRun(db, { ...base, scope: scope() });
    expect(rows.map((r) => r.studentId)).not.toContain("s-far");
  });

  it("an include admits a student whose placements are all non-ticked, priced for all", async () => {
    const { db } = fakeDb([], [], TWO);
    const { rows } = await materializeBillingRun(db, { ...base, scope: scope({ includeStudentIds: ["s-far"] }) });
    expect(rows.find((r) => r.studentId === "s-far")!.totalDue.toString()).toBe("800000");
  });

  it("exclusions still win over a ticked placement and over an include", async () => {
    const { db } = fakeDb([], [], TWO);
    const { rows } = await materializeBillingRun(db, {
      ...base,
      scope: scope({ includeStudentIds: ["s-far"], excludeStudentIds: ["s-two", "s-far"] }),
    });
    expect(rows.map((r) => r.studentId)).toEqual(["s-one"]);
  });

  it("does not bill a withdrawn student's other placement, nor a non-ACTIVE placement", async () => {
    const { db } = fakeDb([], [], TWO);
    const { rows } = await materializeBillingRun(db, { ...base, scope: scope({ classSectionIds: ["cls-1", "cls-dc"] }) });
    expect(rows.map((r) => r.studentId)).not.toContain("s-gone");
    // s-old's cls-1 placement is not ACTIVE, so only the daycare one is priced.
    expect(rows.find((r) => r.studentId === "s-old")!.totalDue.toString()).toBe("300000");
  });

  it("reads leave for every fetched placement, including the non-ticked ones", async () => {
    const { db, leaveFindMany } = fakeDb(
      [],
      [{ enrollmentId: "enr-two-dc", status: "ACTIVE", startMonth: "2026-10", endMonth: "2026-10" }],
      TWO,
    );
    const { rows } = await materializeBillingRun(db, { ...base, scope: scope() });
    expect(leaveFindMany.mock.calls[0][0].where.enrollmentId.in).toContain("enr-two-dc");
    // The daycare placement is on cuti: school price only.
    expect(rows.find((r) => r.studentId === "s-two")!.totalDue.toString()).toBe("500000");
  });
});

describe("materializeBillingRun — harga paket sekolah + daycare", () => {
  const TWO: Enrollment[] = [
    { id: "enr-two-school", studentId: "s-two", classSectionId: "cls-1", studentStatus: "ACTIVE" },
    { id: "enr-two-dc", studentId: "s-two", classSectionId: "cls-dc", studentStatus: "ACTIVE", programId: "prog-dc" },
    { id: "enr-one", studentId: "s-one", classSectionId: "cls-1", studentStatus: "ACTIVE" },
  ];
  const BUNDLE = {
    schoolProgramId: "prog-1",
    daycareProgramId: "prog-dc",
    feeComponentId: "fc-spp",
    amount: new Prisma.Decimal(650_000),
  };
  const only = (ids: string[]) => ({ classSectionIds: ids, includeStudentIds: [], excludeStudentIds: [] });

  it("reads the bundle rows for the run's tenant, year and the fetched programs, and prices the pair with them", async () => {
    const { db, bundleFindMany } = fakeDb([], [], TWO, [BUNDLE]);
    const { rows } = await materializeBillingRun(db, { ...base, scope: only(["cls-1"]) });
    expect(bundleFindMany).toHaveBeenCalledTimes(1);
    const where = (bundleFindMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ tenantId: "tnt-1", academicYearId: "ay-1", status: "ACTIVE" });
    expect((where.schoolProgramId as { in: string[] }).in.sort()).toEqual(["prog-1", "prog-dc"]);
    // The pair is billed the bundle (not 500.000 + 300.000), the school-only child the school price.
    expect(rows.find((r) => r.studentId === "s-two")!.totalDue.toString()).toBe("650000");
    expect(rows.find((r) => r.studentId === "s-one")!.totalDue.toString()).toBe("500000");
  });

  it("prices the pair the same from a run that ticks only the daycare class", async () => {
    const { db } = fakeDb([], [], TWO, [BUNDLE]);
    const { rows } = await materializeBillingRun(db, { ...base, scope: only(["cls-dc"]) });
    expect(rows).toHaveLength(1);
    expect(rows[0].totalDue.toString()).toBe("650000");
  });

  it("makes no bundle query when the students hold fewer than two programs", async () => {
    const { db, bundleFindMany } = fakeDb([], [], TWO, [BUNDLE]);
    const { rows } = await materializeBillingRun(db, {
      ...base,
      scope: { classSectionIds: [], includeStudentIds: ["s-one"], excludeStudentIds: [] },
    });
    expect(bundleFindMany).not.toHaveBeenCalled();
    expect(rows[0].totalDue.toString()).toBe("500000");
  });

  it("with no bundle row the pair is billed the sum", async () => {
    const { db } = fakeDb([], [], TWO, []);
    const { rows } = await materializeBillingRun(db, { ...base, scope: only(["cls-1"]) });
    expect(rows.find((r) => r.studentId === "s-two")!.totalDue.toString()).toBe("800000");
  });

  it("a daycare placement on leave for the month drops the bundle: school price only", async () => {
    const { db } = fakeDb(
      [],
      [{ enrollmentId: "enr-two-dc", status: "ACTIVE", startMonth: "2026-10", endMonth: "2026-10" }],
      TWO,
      [BUNDLE],
    );
    const { rows } = await materializeBillingRun(db, { ...base, scope: only(["cls-1"]) });
    expect(rows.find((r) => r.studentId === "s-two")!.totalDue.toString()).toBe("500000");
  });
});

describe("materializeBillingRun — period alias duplicate guard (FINX-6)", () => {
  it.each(["oktober 2026", "Okt 2026", " OKT   2026 "])(
    "marks a student invoiced as %j as already invoiced for Oktober 2026",
    async (existingLabel) => {
      const { db } = fakeDb([{ studentId: "s-active", periodLabel: existingLabel }]);
      const { rows, summary } = await materializeBillingRun(db, {
        ...base,
        scope: { classSectionIds: ["cls-1"], includeStudentIds: [], excludeStudentIds: [] },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ studentId: "s-active", status: "SKIPPED_ALREADY_INVOICED" });
      expect(summary.skippedAlreadyInvoiced).toBe(1);
      expect(summary.pending).toBe(0);
    },
  );

  it("does not treat another month or year as a duplicate", async () => {
    const { db } = fakeDb([
      { studentId: "s-active", periodLabel: "Sep 2026" },
      { studentId: "s-active", periodLabel: "Oktober 2025" },
    ]);
    const { rows } = await materializeBillingRun(db, {
      ...base,
      scope: { classSectionIds: ["cls-1"], includeStudentIds: [], excludeStudentIds: [] },
    });
    expect(rows[0].status).toBe("PENDING");
  });

  it("keeps the run's label as typed (no rewriting) and still queries the exact label for old periods", async () => {
    const { db, invoiceFindMany } = fakeDb();
    await materializeBillingRun(db, {
      ...base,
      periodLabel: "okt 2026",
      scope: { classSectionIds: ["cls-1"], includeStudentIds: [], excludeStudentIds: [] },
    });
    const where = (invoiceFindMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where.OR).toEqual([{ periodLabel: "okt 2026" }, { createdAt: { gte: expect.any(Date) } }]);
  });
});

describe("materializeBillingRun — enrollment leave (cuti)", () => {
  const scope = { classSectionIds: ["cls-1"], includeStudentIds: [], excludeStudentIds: [] };
  const leave = (over: Partial<FakeLeave> = {}): FakeLeave => ({
    enrollmentId: "enr-s-active",
    status: "ACTIVE",
    startMonth: "2026-10",
    endMonth: "2026-10",
    ...over,
  });

  it("loads active leaves for a monthly label and skips the student on leave", async () => {
    const { db, leaveFindMany } = fakeDb([], [leave()]);
    const { rows, summary } = await materializeBillingRun(db, { ...base, scope });
    expect(rows).toEqual([expect.objectContaining({ studentId: "s-active", status: "SKIPPED_ON_LEAVE", lines: [] })]);
    expect(summary.skippedOnLeave).toBe(1);
    expect(leaveFindMany).toHaveBeenCalledTimes(1);
    expect(leaveFindMany.mock.calls[0][0].where).toEqual({
      tenantId: "tnt-1",
      enrollmentId: { in: ["enr-s-active"] },
      status: "ACTIVE",
      startMonth: { lte: "2026-10" },
      endMonth: { gte: "2026-10" },
    });
  });

  it("zero-pads the month and matches an alias label (Okt 2026 -> 2026-10)", async () => {
    const { db, leaveFindMany } = fakeDb([], [leave({ startMonth: "2026-09", endMonth: "2026-12" })]);
    await materializeBillingRun(db, { ...base, periodLabel: "Okt 2026", scope });
    expect(leaveFindMany.mock.calls[0][0].where).toMatchObject({
      startMonth: { lte: "2026-10" },
      endMonth: { gte: "2026-10" },
    });
    const { db: db2 } = fakeDb([], [leave({ startMonth: "2026-09", endMonth: "2026-12" })]);
    const out = await materializeBillingRun(db2, { ...base, periodLabel: "Januari 2026", scope });
    expect(out.rows[0].status).toBe("PENDING");
  });

  it.each([
    ["a cancelled leave", leave({ status: "INACTIVE" })],
    ["a leave that ended before the month", leave({ startMonth: "2026-08", endMonth: "2026-09" })],
    ["a leave that starts after the month", leave({ startMonth: "2026-11", endMonth: "2026-12" })],
    ["another tenant's leave", leave({ tenantId: "tnt-other" })],
    ["a leave on another enrollment", leave({ enrollmentId: "enr-someone-else" })],
  ])("does not apply %s", async (_name, l) => {
    const { db } = fakeDb([], [l]);
    const { rows, summary } = await materializeBillingRun(db, { ...base, scope });
    expect(rows[0].status).toBe("PENDING");
    expect(summary.skippedOnLeave).toBe(0);
  });

  it("applies a leave whose range spans the month inclusively (first and last month)", async () => {
    for (const month of ["2026-10", "2026-12"] as const) {
      const { db } = fakeDb([], [leave({ startMonth: "2026-10", endMonth: "2026-12" })]);
      const label = month === "2026-10" ? "Oktober 2026" : "Desember 2026";
      const { rows } = await materializeBillingRun(db, { ...base, periodLabel: label, scope });
      expect(rows[0].status).toBe("SKIPPED_ON_LEAVE");
    }
  });

  it.each(["Semester 1 2026/2027", "Okt - Des 2026", "Oktober"])(
    "makes no leave query for the non-monthly label %j and never skips on leave",
    async (periodLabel) => {
      const { db, leaveFindMany } = fakeDb([], [leave({ startMonth: "2020-01", endMonth: "2030-12" })]);
      const { rows } = await materializeBillingRun(db, { ...base, periodLabel, scope });
      expect(leaveFindMany).not.toHaveBeenCalled();
      expect(rows[0].status).toBe("PENDING");
    },
  );

  it("makes no leave query when there are no enrollments", async () => {
    const { db, leaveFindMany } = fakeDb([], [leave()]);
    const { rows } = await materializeBillingRun(db, {
      ...base,
      scope: { classSectionIds: ["cls-none"], includeStudentIds: [], excludeStudentIds: [] },
    });
    expect(rows).toEqual([]);
    expect(leaveFindMany).not.toHaveBeenCalled();
  });
});

describe("findAlreadyInvoicedStudentIds", () => {
  it("returns an empty set without querying when there are no candidates", async () => {
    const { db, invoiceFindMany } = fakeDb();
    expect((await findAlreadyInvoicedStudentIds(db, "tnt-1", "Oktober 2026", [])).size).toBe(0);
    expect(invoiceFindMany).not.toHaveBeenCalled();
  });
});
