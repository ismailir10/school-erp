/**
 * T7 (cycle 2026-09-26, admin-ui-standard-c1) — the invoices list's student
 * cell is now a `DataTableLinkCell` `<Link>` to the invoice detail page;
 * `DataTableRowActions` no longer gets `onView` for this list (the row's
 * "Coba Lagi Link" / "Batalkan" menu is unaffected).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { toast } from "sonner";
import { InvoicesClient } from "@/app/admin/invoices/invoices-client";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
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
  opts: {
    invoices?: Array<typeof invoice & { xenditPaymentUrl?: string | null }>;
    stats?: Record<string, number>;
    refresh?: { status: number; body: Record<string, unknown> };
  } = {},
) {
  const invoices = opts.invoices ?? [invoice];
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (/\/api\/invoices\/[^/]+\/refresh-payment/.test(url)) {
      const r = opts.refresh ?? {
        status: 200,
        body: { code: "UPDATED", message: "Pembayaran ditemukan di gateway — tagihan ditandai LUNAS." },
      };
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      } as Response);
    }
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

describe("InvoicesClient — Cek status pembayaran row action", () => {
  const linked = { ...invoice, xenditPaymentUrl: "https://checkout.xendit.co/web/abc" };

  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    await user.click(screen.getByRole("button", { name: /Buka menu aksi|Aksi untuk/ }));
  }

  it("a SENT row with a payment link POSTs refresh-payment, toasts the message and refetches list + stats", async () => {
    const f = stubFetch({ invoices: [linked] });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await openMenu(user);
    const count = (needle: string) => f.mock.calls.filter((c) => String(c[0]).includes(needle)).length;
    const listBefore = count("/api/invoices?");
    const statsBefore = count("/api/invoices/stats");

    await user.click(await screen.findByRole("menuitem", { name: "Cek status pembayaran" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Pembayaran ditemukan di gateway — tagihan ditandai LUNAS.");
    });
    const post = f.mock.calls.find((c) => String(c[0]) === "/api/invoices/inv1/refresh-payment");
    expect((post as unknown[] | undefined)?.[1]).toMatchObject({ method: "POST" });
    await waitFor(() => {
      expect(count("/api/invoices?")).toBeGreaterThan(listBefore);
      expect(count("/api/invoices/stats")).toBeGreaterThan(statsBefore);
    });
  });

  it("reloads with the CURRENT search after the filter changed, not the query the row menu was built with", async () => {
    const f = stubFetch({ invoices: [linked] });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    const listUrls = () => f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/invoices?"));

    await user.type(screen.getByPlaceholderText("Cari siswa atau nomor tagihan..."), "Aisyah");
    await waitFor(() => {
      expect(listUrls().some((u) => u.includes("search=Aisyah"))).toBe(true);
    });
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    await waitFor(() => {
      expect(listUrls().at(-1)).toContain("search=Aisyah");
    });
    const listBefore = listUrls().length;

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Cek status pembayaran" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
      expect(listUrls().length).toBeGreaterThan(listBefore);
    });
    const reloads = listUrls().slice(listBefore);
    expect(reloads.length).toBeGreaterThan(0);
    for (const url of reloads) expect(url).toContain("search=Aisyah");
  });

  it("is absent without a payment link", async () => {
    vi.stubGlobal("fetch", stubFetch({ invoices: [{ ...invoice, xenditPaymentUrl: null }] }));
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await openMenu(user);
    await screen.findByRole("menuitem", { name: "Catat Pembayaran" });
    expect(screen.queryByRole("menuitem", { name: "Cek status pembayaran" })).not.toBeInTheDocument();
  });

  it("is absent on a PAID row", async () => {
    vi.stubGlobal("fetch", stubFetch({ invoices: [{ ...linked, status: "PAID", totalPaid: 500000 }] }));
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByRole("button", { name: /Buka menu aksi|Aksi untuk/ })).not.toBeInTheDocument();
  });

  it("is absent without the recordPayment capability", async () => {
    vi.stubGlobal("fetch", stubFetch({ invoices: [linked] }));
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={{ ...caps, recordPayment: false }} />);
    await openMenu(user);
    await screen.findByRole("menuitem", { name: "Batalkan" });
    expect(screen.queryByRole("menuitem", { name: "Cek status pembayaran" })).not.toBeInTheDocument();
  });

  it("shows the server's error text on a non-ok response (429)", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        invoices: [linked],
        refresh: { status: 429, body: { error: "Terlalu sering memeriksa. Coba lagi sebentar." } },
      }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Cek status pembayaran" }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Terlalu sering memeriksa. Coba lagi sebentar.");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});

it("offers continuation for an interrupted run without offering to discard issued invoices", async () => {
  const usual = stubFetch();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.includes("/api/billing-runs?unfinished=true")) return Promise.resolve({
      ok: true, json: async () => ({ data: [{ id: "run-1", status: "COMMITTING", periodLabel: "Oktober 2026" }] }),
    });
    return usual(input);
  }));
  render(<InvoicesClient gatewayId="xendit" capabilities={{ create: true, recordPayment: true, void: true }} />);
  expect(await screen.findByRole("button", { name: "Lanjutkan pembuatan tagihan" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Buang draf" })).not.toBeInTheDocument();
});
