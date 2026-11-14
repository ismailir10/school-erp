/**
 * T7 (cycle 2026-09-26, admin-ui-standard-c1) — the payments ledger's
 * student cell is now a `DataTableLinkCell` `<Link>` to the related
 * invoice's detail page (with the invoice number folded in as the
 * description line); the row no longer has a "Lihat" action or column.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import PaymentsLedgerPage from "@/app/admin/payments/page";

const payment = {
  id: "pay1",
  invoiceId: "inv1",
  paidAt: "2026-09-10T02:00:00.000Z",
  amount: 500000,
  method: "TRANSFER",
  methodLabel: "Transfer Bank",
  reference: "TRX-1",
  invoiceNumber: "INV-0001",
  studentName: "Aisyah Putri",
  studentId: "stu1",
};

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/payments?")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [payment],
          summary: { totalAmount: 500000, totalCount: 1, byMethod: [] },
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("PaymentsLedgerPage — name is the link (T7)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("renders the invoice number as the link to the invoice, the student name as a link to the student, and drops the separate Lihat button", async () => {
    render(<PaymentsLedgerPage />);

    await waitFor(() => {
      expect(screen.queryByText("Belum ada penerimaan")).not.toBeInTheDocument();
    });

    const numberLink = await screen.findByRole("link", { name: "INV-0001" });
    expect(numberLink).toHaveAttribute("href", "/admin/invoices/inv1");
    const studentLink = screen.getByRole("link", { name: "Aisyah Putri" });
    expect(studentLink).toHaveAttribute("href", "/admin/students/stu1");
    expect(numberLink.contains(studentLink)).toBe(false);
    expect(screen.queryByRole("button", { name: /^Lihat/ })).not.toBeInTheDocument();
  });
});
