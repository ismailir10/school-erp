import { describe, it, expect, vi } from "vitest";
import { findOpenInvoicesForLeave, hasOtherActiveEnrollments } from "../open-invoices";
import { findOpenRunsCoveredByLeave } from "../billing-runs";

type Row = Record<string, unknown>;

function invoice(over: Row = {}): Row {
  return {
    id: "inv-1",
    invoiceNumber: "INV-2026-0001",
    periodLabel: "Desember 2026",
    status: "SENT",
    totalDue: "500000",
    dueDate: "2026-12-31",
    lines: [
      { labelSnapshot: "SPP Daycare", finalAmount: "450000", feeComponent: { isRecurring: true } },
      { labelSnapshot: "Seragam", finalAmount: "50000", feeComponent: { isRecurring: false } },
    ],
    ...over,
  };
}

const input = { tenantId: "tnt-1", studentId: "stu-1", startMonth: "2026-12", endMonth: "2027-01" };

describe("findOpenInvoicesForLeave", () => {
  it("queries only the student's unpaid, cancellable invoices in the tenant", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await findOpenInvoicesForLeave({ invoice: { findMany } } as never, input);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: "tnt-1", studentId: "stu-1" });
    expect(where.status.in).toEqual(["DRAFT", "SENT", "PENDING_PAYMENT_LINK", "OVERDUE", "PARTIALLY_PAID"]);
    expect(where.status.in).not.toContain("PAID");
    expect(where.status.in).not.toContain("CANCELLED");
    expect(where.totalPaid).toEqual({ lte: 0 });
    expect(where.payments).toEqual({ none: { status: { not: "REVERSED" }, amount: { gt: 0 } } });
  });

  it("keeps single-month labels inside the range and drops others, oldest first", async () => {
    const findMany = vi.fn().mockResolvedValue([
      invoice({ id: "late", periodLabel: "Januari 2027", invoiceNumber: "INV-2027-0001" }),
      invoice({ id: "in", periodLabel: "Desember 2026" }),
      invoice({ id: "before", periodLabel: "November 2026" }),
      invoice({ id: "after", periodLabel: "Februari 2027" }),
      invoice({ id: "semester", periodLabel: "Semester 1 2026/2027" }),
      invoice({ id: "range", periodLabel: "Des 2026 - Jan 2027" }),
      invoice({ id: "short", periodLabel: "Des 2026", invoiceNumber: "INV-2026-0002" }),
    ]);
    const result = await findOpenInvoicesForLeave({ invoice: { findMany } } as never, input);
    expect(result.map((r) => r.id)).toEqual(["in", "short", "late"]);
  });

  it("maps lines, converts Decimals and flags one-off lines", async () => {
    const findMany = vi.fn().mockResolvedValue([invoice()]);
    const [row] = await findOpenInvoicesForLeave({ invoice: { findMany } } as never, input);
    expect(row).toEqual({
      id: "inv-1",
      invoiceNumber: "INV-2026-0001",
      periodLabel: "Desember 2026",
      status: "SENT",
      totalDue: 500000,
      dueDate: "2026-12-31",
      lines: [
        { label: "SPP Daycare", finalAmount: 450000, isRecurring: true },
        { label: "Seragam", finalAmount: 50000, isRecurring: false },
      ],
      hasOneOffLines: true,
    });
  });

  it("hasOneOffLines is false when every line is recurring", async () => {
    const findMany = vi.fn().mockResolvedValue([
      invoice({ lines: [{ labelSnapshot: "SPP", finalAmount: "1", feeComponent: { isRecurring: true } }] }),
    ]);
    const [row] = await findOpenInvoicesForLeave({ invoice: { findMany } } as never, input);
    expect(row.hasOneOffLines).toBe(false);
  });

  it("returns nothing (and does not query) for a malformed range", async () => {
    const findMany = vi.fn();
    expect(await findOpenInvoicesForLeave({ invoice: { findMany } } as never, { ...input, startMonth: "x" })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("findOpenRunsCoveredByLeave", () => {
  it("returns only DRAFT/COMMITTING runs with a single-month label inside the leave", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "r1", periodLabel: "Desember 2026", status: "DRAFT", academicYearId: "ay-1", scope: {} },
      { id: "r2", periodLabel: "Januari 2027", status: "COMMITTING", academicYearId: "ay-1", scope: {} },
      { id: "r3", periodLabel: "Februari 2027", status: "DRAFT", academicYearId: "ay-1", scope: {} },
      { id: "r4", periodLabel: "Semester 1 2026/2027", status: "DRAFT", academicYearId: "ay-1", scope: {} },
    ]);
    const runs = await findOpenRunsCoveredByLeave({ billingRun: { findMany } } as never, {
      tenantId: "tnt-1",
      startMonth: "2026-12",
      endMonth: "2027-01",
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      tenantId: "tnt-1",
      status: { in: ["DRAFT", "COMMITTING"] },
    });
    expect(runs.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});

describe("hasOtherActiveEnrollments", () => {
  it("looks for other ACTIVE enrollments of the student in the same year and tenant", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const yes = await hasOtherActiveEnrollments({ studentEnrollment: { count } } as never, {
      tenantId: "tnt-1",
      studentId: "stu-1",
      enrollmentId: "enr-1",
      academicYearId: "ay-1",
    });
    expect(yes).toBe(true);
    expect(count.mock.calls[0][0].where).toEqual({
      studentId: "stu-1",
      status: "ACTIVE",
      id: { not: "enr-1" },
      classSection: { tenantId: "tnt-1", academicYearId: "ay-1" },
    });
    count.mockResolvedValue(0);
    expect(
      await hasOtherActiveEnrollments({ studentEnrollment: { count } } as never, {
        tenantId: "tnt-1",
        studentId: "stu-1",
        enrollmentId: "enr-1",
        academicYearId: "ay-1",
      }),
    ).toBe(false);
  });
});
