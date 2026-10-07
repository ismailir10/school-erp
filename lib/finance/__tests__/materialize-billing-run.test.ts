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

/** Minimal Prisma stand-in: honours the `student.status` filter the way the DB would. */
function fakeDb(invoices: { studentId: string; periodLabel: string }[] = []) {
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
      studentId: e.studentId,
      classSectionId: e.classSectionId,
      student: { id: e.studentId, name: e.studentId },
      classSection: { name: "TKIT A", programId: "prog-1", program: { name: "TKIT" } },
    }));
  });
  const invoiceFindMany = vi.fn(async () => invoices);
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
  };
  return { db: db as unknown as Prisma.TransactionClient, enrollmentFindMany, invoiceFindMany };
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

describe("findAlreadyInvoicedStudentIds", () => {
  it("returns an empty set without querying when there are no candidates", async () => {
    const { db, invoiceFindMany } = fakeDb();
    expect((await findAlreadyInvoicedStudentIds(db, "tnt-1", "Oktober 2026", [])).size).toBe(0);
    expect(invoiceFindMany).not.toHaveBeenCalled();
  });
});
