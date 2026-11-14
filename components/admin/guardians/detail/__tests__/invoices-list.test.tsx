import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InvoicesList } from "../invoices-list";

const summary = { invoiceCount: 1, unpaidCount: 1, outstanding: 400000 } as never;
const invoices = [
  {
    id: "inv-1",
    invoiceNumber: "INV-2026-0001",
    periodLabel: "2026-01",
    totalDue: 500000,
    totalPaid: 100000,
    status: "OVERDUE",
    dueDate: "2026-01-10T00:00:00.000Z",
    studentId: "s1",
    studentName: "Ahmad Fajar",
  },
];

describe("InvoicesList — names are doors", () => {
  it("invoice number opens the invoice, student name opens the student, and neither anchor nests the other", () => {
    render(<InvoicesList summary={summary} invoices={invoices} guardians={[]} />);

    const invoiceLink = screen.getByRole("link", { name: "INV-2026-0001" });
    const studentLink = screen.getByRole("link", { name: "Ahmad Fajar" });
    expect(invoiceLink).toHaveAttribute("href", "/admin/invoices/inv-1");
    expect(studentLink).toHaveAttribute("href", "/admin/students/s1");
    expect(invoiceLink.contains(studentLink)).toBe(false);
    expect(studentLink.closest("a")).toBe(studentLink);
  });
});
