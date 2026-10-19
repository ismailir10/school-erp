import { describe, it, expect } from "vitest";
import {
  buildParentInvoiceView,
  primaryClassName,
  DETAIL_INVOICE_LIMIT,
  UNPAID_INVOICE_LIMIT,
  type ParentInvoiceRow,
  type ClassNameEnrollment,
} from "../detail-invoices";

function inv(n: number, overrides: Partial<ParentInvoiceRow> = {}): ParentInvoiceRow {
  return {
    id: `inv-${n}`,
    invoiceNumber: `INV-${String(n).padStart(4, "0")}`,
    periodLabel: `Periode ${n}`,
    dueDate: `2026-01-${String((n % 28) + 1).padStart(2, "0")}`,
    totalDue: "100000.00",
    totalPaid: "0.00",
    status: "SENT",
    studentId: "stu-1",
    // higher n = newer
    createdAt: new Date(2026, 0, 1, 0, n),
    student: { name: "Aisyah" },
    ...overrides,
  };
}

describe("buildParentInvoiceView", () => {
  it("returns an empty view for no invoices", () => {
    const v = buildParentInvoiceView([]);
    expect(v.invoiceSummary.invoiceCount).toBe(0);
    expect(v.invoiceSummary.outstanding).toBe(0);
    expect(v.invoices).toEqual([]);
    expect(v.unpaidInvoices).toEqual([]);
    expect(v.owedByStudent).toEqual({});
  });

  it("summarises every row while capping the list at 10, unpaid first", () => {
    // 1..15 paid (older), 16..25 unpaid — the newest 10 are unpaid, but make
    // some unpaid rows OLD to prove unpaid beats recency.
    const rows: ParentInvoiceRow[] = [];
    for (let i = 1; i <= 25; i++) {
      rows.push(inv(i, i <= 15 ? { status: "PAID", totalPaid: "100000.00" } : {}));
    }
    // An old unpaid one (created before everything else) must still lead.
    rows.push(inv(26, { createdAt: new Date(2020, 0, 1), status: "OVERDUE" }));

    const v = buildParentInvoiceView(rows);
    expect(v.invoiceSummary.invoiceCount).toBe(26);
    expect(v.invoiceSummary.unpaidCount).toBe(11);
    expect(v.invoiceSummary.outstanding).toBe(1_100_000);
    expect(v.invoiceSummary.overdueCount).toBe(1);

    expect(v.invoices).toHaveLength(DETAIL_INVOICE_LIMIT);
    // All 10 rows are unpaid because 11 unpaid exist; newest unpaid first.
    expect(v.invoices.every((r) => r.status !== "PAID")).toBe(true);
    expect(v.invoices[0].id).toBe("inv-25");
    expect(v.invoices.map((r) => r.id)).not.toContain("inv-26"); // oldest unpaid fell off
  });

  it("puts paid rows after unpaid ones, newest first within each group", () => {
    const v = buildParentInvoiceView([
      inv(1, { status: "PAID", totalPaid: "100000" }),
      inv(2),
      inv(3, { status: "PAID", totalPaid: "100000" }),
      inv(4, { status: "CANCELLED" }),
      inv(5, { status: "PARTIALLY_PAID", totalPaid: "40000" }),
    ]);
    expect(v.invoices.map((r) => r.id)).toEqual(["inv-5", "inv-2", "inv-4", "inv-3", "inv-1"]);
  });

  it("does not treat a settled PARTIALLY_PAID row or DRAFT as unpaid", () => {
    const v = buildParentInvoiceView([
      inv(1, { status: "PARTIALLY_PAID", totalPaid: "100000" }), // remaining 0
      inv(2, { status: "DRAFT" }),
      inv(3, { status: "PENDING_PAYMENT_LINK" }),
    ]);
    expect(v.unpaidInvoices).toEqual([]);
    expect(v.owedByStudent).toEqual({});
    expect(v.invoiceSummary.outstanding).toBe(0);
    // none unpaid → plain createdAt desc
    expect(v.invoices.map((r) => r.id)).toEqual(["inv-3", "inv-2", "inv-1"]);
  });

  it("maps row fields to numbers and strings", () => {
    const v = buildParentInvoiceView([inv(1, { totalDue: "250000.50", totalPaid: "50000", student: { name: "Budi" }, studentId: "stu-9" })]);
    expect(v.invoices[0]).toEqual({
      id: "inv-1",
      invoiceNumber: "INV-0001",
      periodLabel: "Periode 1",
      totalDue: 250000.5,
      totalPaid: 50000,
      status: "SENT",
      dueDate: "2026-01-02",
      studentId: "stu-9",
      studentName: "Budi",
    });
  });

  it("lists unpaid invoices oldest due date first, capped at 25", () => {
    const rows: ParentInvoiceRow[] = [];
    for (let i = 1; i <= 30; i++) {
      // due dates descend as i grows, so the oldest due is the highest i
      rows.push(inv(i, { dueDate: `2026-02-${String(31 - i).padStart(2, "0")}`, totalPaid: "25000" }));
    }
    const v = buildParentInvoiceView(rows);
    expect(v.unpaidInvoices).toHaveLength(UNPAID_INVOICE_LIMIT);
    expect(v.unpaidInvoices[0]).toEqual({
      id: "inv-30",
      invoiceNumber: "INV-0030",
      periodLabel: "Periode 30",
      studentName: "Aisyah",
      remaining: 75000,
    });
    const dues = v.unpaidInvoices.map((u) => rows.find((r) => r.id === u.id)!.dueDate);
    expect([...dues].sort()).toEqual(dues);
    // the summary still counts all 30
    expect(v.invoiceSummary.unpaidCount).toBe(30);
  });

  it("sums what each child owes", () => {
    const v = buildParentInvoiceView([
      inv(1, { studentId: "a", totalPaid: "20000" }), // 80k
      inv(2, { studentId: "a", status: "OVERDUE" }), // 100k
      inv(3, { studentId: "b" }), // 100k
      inv(4, { studentId: "c", status: "PAID", totalPaid: "100000" }),
    ]);
    expect(v.owedByStudent).toEqual({ a: 180000, b: 100000 });
  });
});

function enr(
  id: string,
  name: string,
  type: string,
  enrollDate: string,
  extra: { status?: string; year?: string } = {},
): ClassNameEnrollment {
  return {
    id,
    enrollDate,
    status: extra.status ?? "ACTIVE",
    classSection: {
      name,
      program: { type },
      academicYear: { status: extra.year ?? "ACTIVE" },
    },
  };
}

describe("primaryClassName", () => {
  it("is null with no enrollments", () => {
    expect(primaryClassName([])).toBeNull();
  });

  it("prefers the SEMESTER class over daycare", () => {
    expect(
      primaryClassName([
        enr("e1", "D'Care", "YEAR_ROUND", "2025-07-01"),
        enr("e2", "TKIT A", "SEMESTER", "2025-08-01"),
      ]),
    ).toBe("TKIT A");
  });

  it("ignores archived years and non-active enrollments", () => {
    expect(
      primaryClassName([
        enr("e1", "Lama", "SEMESTER", "2024-07-01", { year: "ARCHIVED" }),
        enr("e2", "Keluar", "SEMESTER", "2025-07-01", { status: "WITHDRAWN" }),
      ]),
    ).toBeNull();
  });
});
