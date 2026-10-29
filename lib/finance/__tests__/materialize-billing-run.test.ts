import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { materializeBillingRun, findAlreadyInvoicedStudentIds } from "../materialize-billing-run";

type Enrollment = {
  studentId: string;
  classSectionId: string;
  studentStatus: string;
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
function fakeDb(invoices: { studentId: string; periodLabel: string }[] = [], leaves: FakeLeave[] = []) {
  const enrollmentFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
    const where = args.where as {
      student?: { status?: string };
      OR: ({ classSectionId?: { in: string[] } } | { studentId?: { in: string[] } })[];
    };
    return ENROLLMENTS.filter((e) => {
      if (where.student?.status && e.studentStatus !== where.student.status) return false;
      return where.OR.some((c) => {
        if ("classSectionId" in c && c.classSectionId) return c.classSectionId.in.includes(e.classSectionId);
        if ("studentId" in c && c.studentId) return c.studentId.in.includes(e.studentId);
        return false;
      });
    }).map((e) => ({
      id: `enr-${e.studentId}`,
      studentId: e.studentId,
      classSectionId: e.classSectionId,
      student: { id: e.studentId, name: e.studentId },
      classSection: { name: "TKIT A", programId: "prog-1", program: { name: "TKIT" } },
    }));
  });
  const invoiceFindMany = vi.fn(async () => invoices);
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
      findMany: vi.fn(async () => [
        {
          programId: "prog-1",
          feeComponentId: "fc-spp",
          amount: new Prisma.Decimal(500_000),
          feeComponent: { label: "SPP" },
        },
      ]),
    },
    invoice: { findMany: invoiceFindMany },
    studentGuardian: { findMany: vi.fn(async () => []) },
    studentFeeAdjustment: { findMany: vi.fn(async () => []) },
    enrollmentLeave: { findMany: leaveFindMany },
  };
  return { db: db as unknown as Prisma.TransactionClient, enrollmentFindMany, invoiceFindMany, leaveFindMany };
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
