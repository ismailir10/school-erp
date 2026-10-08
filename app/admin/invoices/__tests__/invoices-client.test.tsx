/**
 * T7 (cycle 2026-09-26, admin-ui-standard-c1) — the invoices list's student
 * cell is now a `DataTableLinkCell` `<Link>` to the invoice detail page;
 * `DataTableRowActions` no longer gets `onView` for this list (the row's
 * "Coba Lagi Link" / "Batalkan" menu is unaffected).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InvoicesClient } from "@/app/admin/invoices/invoices-client";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const invoice = {
  id: "inv1",
  invoiceNumber: "INV-0001",
  periodLabel: "September 2026",
  dueDate: "2026-09-30",
  totalDue: 500000,
  totalPaid: 0,
  status: "SENT",
  createdAt: "2026-09-01T00:00:00.000Z",
  student: { name: "Aisyah Putri", nickname: null },
  _count: { payments: 0 },
};

function stubFetch(
  opts: { invoices?: Array<typeof invoice>; stats?: Record<string, number> } = {},
) {
  const invoices = opts.invoices ?? [invoice];
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/invoices/stats")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          total: 1, draft: 0, sent: 1, partiallyPaid: 0, paid: 0, overdue: 0, cancelled: 0, pendingPaymentLink: 0,
          outstanding: 0, collectedThisMonth: 0,
          ...opts.stats,
        }),
      } as Response);
    }
    if (url.includes("/api/billing-runs")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    }
    if (url.includes("/api/academic-years")) {
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }
    if (url.includes("/api/invoices?")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: invoices,
          pagination: { page: 1, pageSize: 20, total: invoices.length, totalPages: 1 },
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("InvoicesClient — name is the link (T7)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("renders the student name as a link to the invoice detail page and drops the separate Lihat button", async () => {
    render(
      <InvoicesClient
        gatewayId="xendit"
        capabilities={{ create: true, recordPayment: true, void: true }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("Belum ada tagihan")).not.toBeInTheDocument();
    });

    const nameLink = await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(nameLink).toHaveAttribute("href", "/admin/invoices/inv1");
    expect(screen.queryByRole("button", { name: /^Lihat/ })).not.toBeInTheDocument();
  });
});

const caps = { create: true, recordPayment: true, void: true };

describe("InvoicesClient — Rupiah KPIs and void menu (finance-safety)", () => {
  it("FIN-13: shows Piutang and Diterima Bulan Ini in Rupiah next to the counts", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ stats: { sent: 2, overdue: 1, partiallyPaid: 1, outstanding: 1550000, collectedThisMonth: 1250000 } }),
    );
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);

    const piutang = (await screen.findByText("Piutang")).closest("[data-slot=card]") as HTMLElement;
    expect(within(piutang).getByText("Rp 1.550.000")).toBeInTheDocument();
    expect(within(piutang).getByText("4 tagihan belum lunas")).toBeInTheDocument();
    const diterima = screen.getByText("Diterima Bulan Ini").closest("[data-slot=card]") as HTMLElement;
    expect(within(diterima).getByText("Rp 1.250.000")).toBeInTheDocument();
  });

  it("FIN-11: a cancelled row does not show a red 'Sisa'", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ invoices: [{ ...invoice, status: "CANCELLED", totalDue: 123456 }] }),
    );
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByText(/Sisa:/)).not.toBeInTheDocument();
  });

  it("FIN-9: an unpaid OVERDUE row offers Batalkan; an OVERDUE row with payments does not", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        invoices: [
          { ...invoice, id: "od-1", status: "OVERDUE", student: { name: "Overdue Kosong", nickname: null } },
          { ...invoice, id: "od-2", status: "OVERDUE", totalPaid: 100000, student: { name: "Overdue Bayar", nickname: null } },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await screen.findByRole("link", { name: /Overdue Kosong/ });

    // Both rows carry Catat Pembayaran now (R2-ADMIN-12), so both have a menu.
    const menus = screen.getAllByRole("button", { name: /Buka menu aksi|Aksi untuk/ });
    expect(menus).toHaveLength(2);
    await user.click(menus[0]);
    expect(await screen.findByRole("menuitem", { name: "Batalkan" })).toBeInTheDocument();
  });

  it("FIN-9: an OVERDUE row with payments keeps Catat Pembayaran but loses Batalkan", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        invoices: [
          { ...invoice, id: "od-2", status: "OVERDUE", totalPaid: 100000, student: { name: "Overdue Bayar", nickname: null } },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await screen.findByRole("link", { name: /Overdue Bayar/ });
    await user.click(screen.getByRole("button", { name: /Buka menu aksi|Aksi untuk/ }));
    await screen.findByRole("menuitem", { name: "Catat Pembayaran" });
    expect(screen.queryByRole("menuitem", { name: "Batalkan" })).not.toBeInTheDocument();
  });
});

describe("InvoicesClient — Catat Pembayaran row action and ?status= (R2-ADMIN-12/3)", () => {
  beforeEach(() => push.mockClear());

  it("a SENT row offers Catat Pembayaran, which opens the detail page with the dialog flag", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    await user.click(screen.getByRole("button", { name: /Buka menu aksi|Aksi untuk/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Catat Pembayaran" }));
    expect(push).toHaveBeenCalledWith("/admin/invoices/inv1?bayar=1");
  });

  it("is not offered on a DRAFT row or without the payments.record capability", async () => {
    vi.stubGlobal("fetch", stubFetch({ invoices: [{ ...invoice, status: "DRAFT" }] }));
    const { unmount } = render(<InvoicesClient gatewayId="xendit" capabilities={{ ...caps, void: false }} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByRole("button", { name: /Buka menu aksi|Aksi untuk/ })).not.toBeInTheDocument();
    unmount();

    vi.stubGlobal("fetch", stubFetch());
    render(<InvoicesClient gatewayId="xendit" capabilities={{ ...caps, recordPayment: false, void: false }} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByRole("button", { name: /Buka menu aksi|Aksi untuk/ })).not.toBeInTheDocument();
  });

  it("initialStatus seeds the list query (dashboard Lewat tempo link)", async () => {
    const f = stubFetch();
    vi.stubGlobal("fetch", f);
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} initialStatus="OVERDUE" />);
    await waitFor(() => {
      const listCalls = f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/invoices?"));
      expect(listCalls.some((u) => u.includes("status=OVERDUE"))).toBe(true);
    });
  });
});
