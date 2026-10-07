import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvoicesClient } from "../client";

vi.mock("../invoice-detail-sheet", () => ({
  InvoiceDetailSheet: ({
    open,
    invoiceId,
    paymentPending,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    invoiceId: string | null;
    paymentPending?: boolean;
  }) => (
    <div data-testid="invoice-detail-sheet" data-payment-pending={String(!!paymentPending)}>
      {open && <div>Sheet open: {invoiceId}</div>}
    </div>
  ),
}));

const toastFn = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
vi.mock("sonner", () => ({
  get toast() {
    return toastFn;
  },
}));

const replaceFn = vi.fn();
const refreshFn = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceFn, push: vi.fn(), refresh: refreshFn }),
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  toastFn.mockClear();
  toastFn.error.mockClear();
  toastFn.success.mockClear();
  replaceFn.mockClear();
  refreshFn.mockClear();
  mockSearchParams = new URLSearchParams();
});

const mockInvoices = [
  {
    id: "inv-1",
    invoiceNumber: "INV-2024-001",
    periodLabel: "Agustus 2024",
    dueDate: "2024-08-31",
    totalDue: 1000000,
    totalPaid: 0,
    status: "SENT",
    xenditPaymentUrl: null,
    sentAt: "2024-08-01",
    paidAt: null,
    createdAt: "2024-08-01",
  },
  {
    id: "inv-2",
    invoiceNumber: "INV-2024-002",
    periodLabel: "September 2024",
    dueDate: "2024-09-30",
    totalDue: 1000000,
    totalPaid: 500000,
    status: "PARTIALLY_PAID",
    xenditPaymentUrl: null,
    sentAt: "2024-09-01",
    paidAt: null,
    createdAt: "2024-09-01",
  },
  {
    id: "inv-3",
    invoiceNumber: "INV-2024-003",
    periodLabel: "Juli 2024",
    dueDate: "2024-07-31",
    totalDue: 1000000,
    totalPaid: 1000000,
    status: "PAID",
    xenditPaymentUrl: null,
    sentAt: "2024-07-01",
    paidAt: "2024-07-15",
    createdAt: "2024-07-01",
  },
];

describe("InvoicesClient (cycle-4)", () => {
  describe("Loading State", () => {
    it("shows skeleton when data is null", () => {
      render(<InvoicesClient data={null} />);
      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("Page Header", () => {
    it("renders Tagihan h1", () => {
      render(<InvoicesClient data={mockInvoices} />);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tagihan");
    });
  });

  describe("Outstanding state — Frame 4", () => {
    it("renders focal card with display-size due total", () => {
      render(<InvoicesClient data={mockInvoices} />);
      // SENT 1_000_000 unpaid + PARTIAL remaining 500_000 = 1.500.000
      expect(screen.getByText(/1\.500\.000/)).toBeInTheDocument();
    });

    it("shows count of outstanding tagihan", () => {
      render(<InvoicesClient data={mockInvoices} />);
      // Two outstanding (SENT + PARTIALLY_PAID)
      expect(screen.getByText(/2 tagihan/)).toBeInTheDocument();
    });

    it("says how many are overdue instead of a bare chip (FIN-22)", () => {
      const future = { ...mockInvoices[1], id: "inv-future", periodLabel: "Januari 2999", dueDate: "2999-01-31" };
      render(<InvoicesClient data={[mockInvoices[0], future]} />);
      // inv-1 (2024) is overdue; the 2999 one is not.
      expect(screen.getByText("1 lewat tempo")).toBeInTheDocument();
      expect(screen.queryByText("Lewat tempo")).not.toBeInTheDocument();
      expect(screen.getByText("2 tagihan")).toBeInTheDocument();
    });

    it("counts every overdue invoice when all are late", () => {
      render(<InvoicesClient data={mockInvoices} />);
      expect(screen.getByText("2 lewat tempo")).toBeInTheDocument();
    });

    it("shows no overdue chip when nothing is past due", () => {
      const future = { ...mockInvoices[1], id: "inv-future", dueDate: "2999-01-31" };
      render(<InvoicesClient data={[future]} />);
      expect(screen.queryByText(/lewat tempo/i)).not.toBeInTheDocument();
      expect(screen.getByText(/jatuh tempo terdekat/)).toBeInTheDocument();
    });

    it("leads an overdue row's description with the marker so a clamp cannot cut it (PAR-9)", () => {
      render(<InvoicesClient data={mockInvoices} />);
      const list = screen.getByRole("list", { name: "Tagihan belum dibayar" });
      const row = within(list).getByRole("button", { name: /September 2024/ });
      expect(row.textContent).toMatch(/Lewat tempo · Dibayar sebagian · Jatuh tempo/);
    });

    it("renders Belum dibayar eyebrow group", () => {
      render(<InvoicesClient data={mockInvoices} />);
      // Eyebrow appears twice: inside focal card + as section heading
      expect(screen.getAllByText("Belum dibayar").length).toBeGreaterThan(0);
    });

    it("renders due rows with period label", () => {
      render(<InvoicesClient data={mockInvoices} />);
      expect(screen.getByText("Agustus 2024")).toBeInTheDocument();
      expect(screen.getByText("September 2024")).toBeInTheDocument();
      const list = screen.getByRole("list", { name: "Tagihan belum dibayar" });
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
      expect(within(list).getByRole("button", { name: /Agustus 2024/ })).toBeVisible();
    });

    it("keeps paid history behind an explicit disclosure after outstanding rows", async () => {
      const user = userEvent.setup();
      render(<InvoicesClient data={mockInvoices} />);
      const history = screen.getByRole("button", { name: /Riwayat pembayaran/ });
      expect(history).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("Juli 2024")).not.toBeInTheDocument();
      await user.click(history);
      expect(screen.getByText("Juli 2024")).toBeInTheDocument();
      expect(within(screen.getByRole("list", { name: "Riwayat pembayaran" })).getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByText("Agustus 2024").compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe("All-paid state — Frame 5", () => {
    it("renders Lunas semua celebration when no outstanding", () => {
      const allPaid = mockInvoices.map((inv) => ({
        ...inv,
        status: "PAID",
        totalPaid: inv.totalDue,
      }));
      render(<InvoicesClient data={allPaid} />);
      expect(screen.getByText("Lunas semua")).toBeInTheDocument();
      expect(screen.getByText(/Alhamdulillah, semua tagihan lunas/)).toBeInTheDocument();
    });

    it("still offers paid history when all invoices are paid", async () => {
      const user = userEvent.setup();
      const allPaid = mockInvoices.map((inv) => ({
        ...inv,
        status: "PAID",
        totalPaid: inv.totalDue,
      }));
      render(<InvoicesClient data={allPaid} />);
      await user.click(screen.getByRole("button", { name: /Riwayat pembayaran/ }));
      expect(screen.getByText("Juli 2024")).toBeInTheDocument();
    });
  });

  describe("Empty state", () => {
    it("shows neutral 'Belum ada tagihan' when no invoices ever issued", () => {
      // Spec: data === [] is the no-invoice case, not the all-paid case.
      render(<InvoicesClient data={[]} />);
      expect(screen.getByText("Belum ada tagihan")).toBeInTheDocument();
      expect(screen.queryByText("Lunas semua")).not.toBeInTheDocument();
    });
  });

  describe("Row click opens sheet", () => {
    it("opens detail sheet when an invoice row is clicked", async () => {
      const user = userEvent.setup();
      render(<InvoicesClient data={mockInvoices} />);
      const row = screen.getByRole("button", { name: /Agustus 2024/ });
      await user.click(row);
      expect(screen.getByText(/Sheet open: inv-1/)).toBeInTheDocument();
    });
  });

  describe("Long-list controls", () => {
    const longInvoices = Array.from({ length: 11 }, (_, index) => ({
      ...mockInvoices[index % mockInvoices.length],
      id: `long-${index}`,
      invoiceNumber: `INV-2024-${String(index + 10).padStart(3, "0")}`,
      periodLabel: `Periode ${index + 1}`,
      dueDate: `2024-10-${String(index + 1).padStart(2, "0")}`,
    }));

    it("renders search, status, sort, and reset controls for lists over 10 rows", async () => {
      const user = userEvent.setup();

      render(<InvoicesClient data={longInvoices} />);

      const search = screen.getByPlaceholderText("Cari periode atau nomor tagihan");
      expect(search).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Filter status" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Urutkan tagihan" })).toBeInTheDocument();

      await user.type(search, "tidak-ada");

      expect(screen.getByText("Tidak ada tagihan sesuai filter")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Atur ulang" }));

      expect(search).toHaveValue("");
      expect(screen.getByText("Periode 1")).toBeInTheDocument();
    });
  });

  describe("Xendit return-URL handler", () => {
    it("opens detail sheet and reports pending when the legacy return URL says paid but server says sent", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1&xenditStatus=paid");
      render(<InvoicesClient data={mockInvoices} />);
      expect(toastFn.success).not.toHaveBeenCalled();
      expect(toastFn).toHaveBeenCalledWith(expect.stringContaining("sedang diperiksa"));
      expect(refreshFn).toHaveBeenCalled();
      expect(replaceFn).toHaveBeenCalledWith("/parent/invoices", { scroll: false });
      expect(screen.getByText(/Sheet open: inv-1/)).toBeInTheDocument();
    });

    it("marks the sheet's invoice as payment-pending after a 'sedang diperiksa' return (PARX-8)", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1&paymentStatus=paid");
      render(<InvoicesClient data={mockInvoices} />);
      expect(screen.getByTestId("invoice-detail-sheet")).toHaveAttribute("data-payment-pending", "true");
    });

    it("releases the pending flag once the invoice's paid amount changes", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1&paymentStatus=paid");
      const { rerender } = render(<InvoicesClient data={mockInvoices} />);
      expect(screen.getByTestId("invoice-detail-sheet")).toHaveAttribute("data-payment-pending", "true");
      const updated = mockInvoices.map((i) => (i.id === "inv-1" ? { ...i, totalPaid: 400000, status: "PARTIALLY_PAID" } : i));
      rerender(<InvoicesClient data={updated} />);
      expect(screen.getByTestId("invoice-detail-sheet")).toHaveAttribute("data-payment-pending", "false");
    });

    it("never flags pending when the return was a cancel", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1&paymentStatus=cancel");
      render(<InvoicesClient data={mockInvoices} />);
      expect(screen.getByTestId("invoice-detail-sheet")).toHaveAttribute("data-payment-pending", "false");
    });

    it("fires neutral cancel toast on ?invoice=&xenditStatus=cancel", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1&xenditStatus=cancel");
      render(<InvoicesClient data={mockInvoices} />);
      expect(toastFn).toHaveBeenCalledWith(
        expect.stringContaining("Pembayaran belum selesai"),
      );
      expect(replaceFn).toHaveBeenCalledWith("/parent/invoices", { scroll: false });
    });

    it("does nothing when invoice id is foreign / not in data", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-foreign&xenditStatus=paid");
      render(<InvoicesClient data={mockInvoices} />);
      expect(toastFn.success).not.toHaveBeenCalled();
      expect(toastFn).not.toHaveBeenCalled();
      expect(replaceFn).not.toHaveBeenCalled();
      expect(screen.queryByText(/Sheet open:/)).not.toBeInTheDocument();
    });

    it("does nothing when xenditStatus is missing", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1");
      render(<InvoicesClient data={mockInvoices} />);
      expect(toastFn.success).not.toHaveBeenCalled();
      expect(replaceFn).not.toHaveBeenCalled();
    });

    it("does nothing when invoice param is missing", () => {
      mockSearchParams = new URLSearchParams("xenditStatus=paid");
      render(<InvoicesClient data={mockInvoices} />);
      expect(toastFn.success).not.toHaveBeenCalled();
      expect(replaceFn).not.toHaveBeenCalled();
    });
  });

  // Cycle 2026-07-27-doku-payment-gateway AC-24: the gateway-neutral
  // `paymentStatus` param (new sessions, either gateway) is accepted
  // alongside the legacy `xenditStatus` param (sessions created before this
  // cycle), preferring `paymentStatus` when both are present.
  describe("Payment return-URL handler (paymentStatus, gateway-neutral)", () => {
    it("shows a partial payment as partial even when the callback claims paid", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-2&paymentStatus=paid&child=second");
      render(<InvoicesClient data={mockInvoices} selectedChildId="second" />);
      expect(toastFn.success).not.toHaveBeenCalled();
      expect(toastFn).toHaveBeenCalledWith(expect.stringContaining("tercatat sebagian"));
      expect(screen.getByRole("button", { name: /September 2024/ })).toHaveTextContent("Dibayar sebagian");
      expect(replaceFn).toHaveBeenCalledWith("/parent/invoices?child=second", { scroll: false });
    });

    it("opens detail sheet and confirms payment only when the server says paid", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-3&paymentStatus=paid&child=second&view=home");
      render(<InvoicesClient data={mockInvoices} selectedChildId="second" />);
      expect(toastFn.success).toHaveBeenCalledWith(
        expect.stringContaining("Alhamdulillah"),
      );
      expect(toastFn.success).toHaveBeenCalledWith(
        expect.stringContaining("Juli 2024"),
      );
      expect(replaceFn).toHaveBeenCalledWith("/parent/invoices?child=second&view=home", { scroll: false });
      expect(screen.getByText(/Sheet open: inv-3/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Riwayat pembayaran/ })).toHaveAttribute("aria-expanded", "true");
    });

    it("fires neutral cancel toast on ?invoice=&paymentStatus=cancel", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1&paymentStatus=cancel");
      render(<InvoicesClient data={mockInvoices} />);
      expect(toastFn).toHaveBeenCalledWith(
        expect.stringContaining("Pembayaran belum selesai"),
      );
      expect(replaceFn).toHaveBeenCalledWith("/parent/invoices", { scroll: false });
    });

    it("does not call a cancelled invoice a pending payment after a paid return", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1&paymentStatus=paid");
      const cancelled = mockInvoices.map((inv) => inv.id === "inv-1" ? { ...inv, status: "CANCELLED" } : inv);
      render(<InvoicesClient data={cancelled} />);
      expect(toastFn.success).not.toHaveBeenCalled();
      expect(toastFn).toHaveBeenCalledWith(expect.stringContaining("Pembayaran belum selesai"));
      expect(toastFn).not.toHaveBeenCalledWith(expect.stringContaining("sedang diperiksa"));
      expect(screen.getByText(/Sheet open: inv-1/)).toBeInTheDocument();
    });

    it("prefers paymentStatus over xenditStatus when both are present", () => {
      mockSearchParams = new URLSearchParams(
        "invoice=inv-3&paymentStatus=paid&xenditStatus=cancel",
      );
      render(<InvoicesClient data={mockInvoices} />);
      // The paid server state wins; both transient URL params are removed.
      expect(toastFn.success).toHaveBeenCalledWith(
        expect.stringContaining("Alhamdulillah"),
      );
      expect(toastFn).not.toHaveBeenCalledWith(
        expect.stringContaining("Pembayaran belum selesai"),
      );
      expect(replaceFn).toHaveBeenCalledWith("/parent/invoices", { scroll: false });
    });

    it("does nothing when neither paymentStatus nor xenditStatus is present", () => {
      mockSearchParams = new URLSearchParams("invoice=inv-1");
      render(<InvoicesClient data={mockInvoices} />);
      expect(toastFn.success).not.toHaveBeenCalled();
      expect(replaceFn).not.toHaveBeenCalled();
    });
  });

  describe("Webhook → list freshness poll", () => {
    it("polls router.refresh every 30s when an invoice has an active xendit session", () => {
      vi.useFakeTimers();
      const inFlight = mockInvoices.map((inv) =>
        inv.id === "inv-1"
          ? { ...inv, xenditPaymentUrl: "https://checkout.xendit.co/abc" }
          : inv,
      );
      render(<InvoicesClient data={inFlight} />);
      expect(refreshFn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30_000);
      expect(refreshFn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(30_000);
      expect(refreshFn).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it("does not poll when no invoice has an active xendit session", () => {
      vi.useFakeTimers();
      render(<InvoicesClient data={mockInvoices} />);
      vi.advanceTimersByTime(60_000);
      expect(refreshFn).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe("Status flip → PAID emits one-shot toast", () => {
    it("fires success toast when an invoice transitions from non-PAID to PAID", () => {
      const { rerender } = render(<InvoicesClient data={mockInvoices} />);
      // First render: no flip, no toast (prevDataRef seeds with current data)
      expect(toastFn.success).not.toHaveBeenCalled();
      // Second render: inv-1 (SENT) flips to PAID
      const flipped = mockInvoices.map((inv) =>
        inv.id === "inv-1"
          ? { ...inv, status: "PAID", totalPaid: inv.totalDue, paidAt: "2024-09-01" }
          : inv,
      );
      rerender(<InvoicesClient data={flipped} />);
      expect(toastFn.success).toHaveBeenCalledWith(
        expect.stringContaining("baru saja terbayar"),
      );
      expect(toastFn.success).toHaveBeenCalledWith(
        expect.stringContaining("Agustus 2024"),
      );
    });

    it("does not fire toast on initial mount even if data has PAID rows", () => {
      render(<InvoicesClient data={mockInvoices} />);
      // mockInvoices includes inv-3 PAID — no toast since there's no prior render
      // showing it as non-PAID.
      expect(toastFn.success).not.toHaveBeenCalled();
    });
  });
});
