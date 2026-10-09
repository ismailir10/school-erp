/**
 * Parent invoice detail sheet (finance-safety, PAR-7 / PAR-8).
 * PAR-8: the focal figure is labelled "Sisa tagihan" and a Total / Sudah
 *        dibayar / Sisa block sits under Rincian.
 * PAR-7: an unpaid invoice with no payment link tells the parent how to reach
 *        the school (WhatsApp/tel when SCHOOL_CONTACT_PHONE is configured, always
 *        the invoice number to quote).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { InvoiceDetailSheet } from "../invoice-detail-sheet";

const base = {
  id: "inv-3",
  invoiceNumber: "INV-2026-0003",
  periodLabel: "Feb-2026",
  dueDate: "2026-02-15",
  totalDue: 850000,
  totalPaid: 400000,
  status: "PARTIALLY_PAID",
  xenditPaymentUrl: null as string | null,
  schoolContactPhone: null as string | null,
  sentAt: "2026-02-01T00:00:00.000Z",
  paidAt: null as string | null,
  lines: [{ id: "l1", labelSnapshot: "SPP", amount: 850000, finalAmount: 850000, adjustmentAmount: 0, adjustmentNote: null }],
  payments: [
    { id: "p1", amount: 400000, method: "CASH", reference: "Cicilan-1", paidAt: "2026-02-05T03:00:00.000Z" },
  ],
  student: { name: "Aisyah Putri", nickname: "Aisyah", classSection: null },
};

function renderSheet(over: Partial<typeof base> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ ...base, ...over }) })),
  );
  render(<InvoiceDetailSheet open onOpenChange={() => {}} invoiceId="inv-3" />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("InvoiceDetailSheet — partial payment wording (PAR-8)", () => {
  it("labels the focal amount 'Sisa tagihan' and lists Total, Sudah dibayar, Sisa", async () => {
    renderSheet();
    const totals = await screen.findByTestId("invoice-totals");
    const text = (totals.textContent ?? "").replace(/\s/g, "");
    expect(text).toContain("Totaltagihan");
    expect(text).toMatch(/Totaltagihan.*850\.000/);
    expect(text).toMatch(/Sudahdibayar.*400\.000/);
    expect(text).toMatch(/Sisatagihan.*450\.000/);
    expect(screen.getAllByText("Sisa tagihan").length).toBeGreaterThanOrEqual(2); // caption + row
    expect(screen.queryByText(/sisa\s+jatuh tempo/i)).not.toBeInTheDocument();
  });

  it("does not show the admin's internal payment reference to the parent", async () => {
    renderSheet();
    await screen.findByTestId("invoice-totals");
    expect(screen.queryByText(/Cicilan-1/)).not.toBeInTheDocument();
  });

  it("a settled invoice shows Total tagihan and no Sisa row", async () => {
    renderSheet({ status: "PAID", totalPaid: 850000, paidAt: "2026-02-10T03:00:00.000Z" });
    const totals = await screen.findByTestId("invoice-totals");
    expect(within(totals).queryByText("Sisa tagihan")).not.toBeInTheDocument();
    expect(screen.getByText("Total tagihan", { selector: "p" })).toBeInTheDocument();
  });
});

describe("InvoiceDetailSheet — kuitansi on partial payment (R2-P-6)", () => {
  it("offers the kuitansi for a partly paid invoice, labelled as partial proof", async () => {
    renderSheet();
    const link = await screen.findByRole("link", { name: /Kuitansi\.pdf/ });
    expect(link).toHaveAttribute("href", "/api/guardian/invoices/inv-3/pdf");
    expect(link).toHaveTextContent("Bukti pembayaran sebagian");
  });

  it("offers no kuitansi while nothing has been paid", async () => {
    renderSheet({ status: "SENT", totalPaid: 0, payments: [] });
    await screen.findByTestId("invoice-totals");
    expect(screen.queryByRole("link", { name: /Kuitansi\.pdf/ })).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailSheet — no payment link (PAR-7)", () => {
  it("offers WhatsApp + telephone links with the invoice number prefilled when the school contact is configured", async () => {
    renderSheet({ schoolContactPhone: "0812-8877-4402" });
    const box = await screen.findByTestId("contact-school");
    expect(box).toHaveTextContent("INV-2026-0003");

    const wa = within(box).getByRole("link", { name: /WhatsApp/ });
    expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/6281288774402\?text=/);
    expect(decodeURIComponent(wa.getAttribute("href")!)).toContain("INV-2026-0003");
    expect(within(box).getByRole("link", { name: /Telepon/ })).toHaveAttribute("href", "tel:081288774402");
  });

  it("without a configured number still says to contact the school and quote the invoice number (no dead links)", async () => {
    renderSheet({ schoolContactPhone: null });
    const box = await screen.findByTestId("contact-school");
    expect(box).toHaveTextContent("hubungi bagian tata usaha sekolah");
    expect(box).toHaveTextContent("INV-2026-0003");
    expect(within(box).queryByRole("link")).not.toBeInTheDocument();
  });

  it("a live payment link keeps 'Bayar sekarang' and hides the contact box", async () => {
    renderSheet({ xenditPaymentUrl: "https://pay.example/abc" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Bayar sekarang/ })).toBeInTheDocument());
    expect(screen.queryByTestId("contact-school")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailSheet — overdue status (PARX-8)", () => {
  const unpaid = { status: "SENT", totalPaid: 0, payments: [] };

  it("says 'Lewat tempo' for an unpaid invoice past its due date, not 'Belum dibayar'", async () => {
    renderSheet({ ...unpaid, dueDate: "2026-02-15" });
    await screen.findByTestId("invoice-totals");
    expect(screen.getByText("Lewat tempo")).toBeInTheDocument();
    expect(screen.queryByText("Belum dibayar")).not.toBeInTheDocument();
  });

  it("keeps 'Belum dibayar' while the due date is still ahead", async () => {
    renderSheet({ ...unpaid, dueDate: "2999-01-01" });
    await screen.findByTestId("invoice-totals");
    expect(screen.getByText("Belum dibayar")).toBeInTheDocument();
    expect(screen.queryByText("Lewat tempo")).not.toBeInTheDocument();
  });

  it("a partly paid overdue invoice shows both 'Dibayar sebagian' and 'Lewat tempo'", async () => {
    renderSheet({ dueDate: "2026-02-15" });
    await screen.findByTestId("invoice-totals");
    expect(screen.getByText("Dibayar sebagian")).toBeInTheDocument();
    expect(screen.getByText("Lewat tempo")).toBeInTheDocument();
  });

  it("a settled invoice is never overdue", async () => {
    renderSheet({ status: "PAID", totalPaid: 850000, dueDate: "2026-02-15", paidAt: "2026-02-10T03:00:00.000Z" });
    await screen.findByTestId("invoice-totals");
    expect(screen.queryByText("Lewat tempo")).not.toBeInTheDocument();
    expect(screen.getByText("Lunas")).toBeInTheDocument();
  });
});

describe("InvoiceDetailSheet — pending payment (PARX-8)", () => {
  function renderPending(over: Partial<typeof base> = {}, onRefreshStatus?: () => void) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ...base, ...over }) })),
    );
    render(
      <InvoiceDetailSheet
        open
        onOpenChange={() => {}}
        invoiceId="inv-3"
        paymentPending
        onRefreshStatus={onRefreshStatus}
      />,
    );
  }

  it("replaces 'Bayar sekarang' with a calm note even when a live link exists", async () => {
    renderPending({ xenditPaymentUrl: "https://pay.example/abc" });
    const note = await screen.findByTestId("payment-pending");
    expect(note).toHaveTextContent("Pembayaran sedang diperiksa");
    expect(note).toHaveTextContent("tidak perlu bayar lagi");
    expect(screen.queryByRole("button", { name: /Bayar sekarang/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Bayar sekarang/ })).not.toBeInTheDocument();
  });

  it("offers 'Muat ulang status' only when a refresh handler is supplied", async () => {
    const onRefresh = vi.fn();
    renderPending({ xenditPaymentUrl: "https://pay.example/abc" }, onRefresh);
    const btn = await screen.findByRole("button", { name: /Muat ulang status/ });
    btn.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("without the flag the pay button stays", async () => {
    renderSheet({ xenditPaymentUrl: "https://pay.example/abc" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Bayar sekarang/ })).toBeInTheDocument());
    expect(screen.queryByTestId("payment-pending")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailSheet — Cara bayar card (PARX-1)", () => {
  it("is hidden when there is no payment link", async () => {
    renderSheet({ xenditPaymentUrl: null });
    await screen.findByTestId("contact-school");
    expect(screen.queryByText("Cara bayar")).not.toBeInTheDocument();
    expect(screen.queryByText(/Transfer bank \(Virtual Account\)/)).not.toBeInTheDocument();
  });

  it("shows when a payment link exists", async () => {
    renderSheet({ xenditPaymentUrl: "https://pay.example/abc" });
    expect(await screen.findByText("Cara bayar")).toBeInTheDocument();
    expect(screen.getByText(/Transfer bank \(Virtual Account\)/)).toBeInTheDocument();
  });
});

describe("InvoiceDetailSheet — single close control (PARX-12)", () => {
  it("has only the header X, no second 'Tutup' button", async () => {
    renderSheet({ xenditPaymentUrl: "https://pay.example/abc" });
    await screen.findByTestId("invoice-totals");
    expect(screen.getAllByRole("button", { name: "Tutup" })).toHaveLength(1);
  });
});

describe("InvoiceDetailSheet — payment method labels", () => {
  it("shows Indonesian method labels in the history", async () => {
    renderSheet({
      payments: [
        { id: "p1", amount: 100000, method: "CASH", reference: "ref", paidAt: "2026-02-05T03:00:00.000Z" },
        { id: "p2", amount: 100000, method: "DOKU", reference: "ref", paidAt: "2026-02-06T03:00:00.000Z" },
      ],
    });
    await screen.findByTestId("invoice-totals");
    expect(screen.getByText("Tunai")).toBeInTheDocument();
    expect(screen.getByText("Virtual Account")).toBeInTheDocument();
  });
});

/**
 * Dates are instants. The sheet used to cut `paidAt` to its first ten characters
 * before formatting, which handed `formatDate` the UTC day: a payment recorded at
 * 05:00 WIB on 7 Okt (22:00Z on the 6th), or any backdated payment stored as
 * midnight +07:00, read one day early on the wali's receipt.
 */
describe("InvoiceDetailSheet — payment dates on the Asia/Jakarta day", () => {
  it("shows a payment recorded after 17:00Z on the next WIB day", async () => {
    renderSheet({
      status: "PAID",
      totalPaid: 850000,
      paidAt: "2026-10-06T22:30:00.000Z",
      payments: [
        { id: "p1", amount: 850000, method: "CASH", reference: "x", paidAt: "2026-10-06T22:30:00.000Z" },
      ],
    });
    await screen.findByTestId("invoice-totals");
    expect(screen.getByText("7 Oktober 2026")).toBeInTheDocument();
    expect(screen.getByText("Diterbitkan 7 Oktober 2026")).toBeInTheDocument();
    expect(screen.queryByText(/6 Oktober 2026/)).not.toBeInTheDocument();
  });

  it("keeps a backdated payment (midnight +07:00) on its own day", async () => {
    renderSheet({
      status: "PAID",
      totalPaid: 850000,
      paidAt: "2026-10-05T17:00:00.000Z",
      payments: [
        { id: "p1", amount: 850000, method: "CASH", reference: "x", paidAt: "2026-10-05T17:00:00.000Z" },
      ],
    });
    await screen.findByTestId("invoice-totals");
    expect(screen.getByText("Diterbitkan 6 Oktober 2026")).toBeInTheDocument();
    expect(screen.queryByText(/5 Oktober 2026/)).not.toBeInTheDocument();
  });

  it("does not shift a UTC-midnight value", async () => {
    renderSheet({
      status: "PAID",
      totalPaid: 850000,
      paidAt: "2026-02-05T00:00:00.000Z",
      payments: [
        { id: "p1", amount: 850000, method: "CASH", reference: "x", paidAt: "2026-02-05T00:00:00.000Z" },
      ],
    });
    await screen.findByTestId("invoice-totals");
    expect(screen.getByText("Diterbitkan 5 Februari 2026")).toBeInTheDocument();
  });
});
