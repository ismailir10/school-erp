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
    invoices?: Array<typeof invoice & { xenditPaymentUrl?: string | null; paymentLinkExpiresAt?: string | null }>;
    stats?: Record<string, number>;
    refresh?: { status: number; body: Record<string, unknown> };
    refreshAll?: { status: number; body: Record<string, unknown> };
    createLinks?: { status: number; body: Record<string, unknown> };
    reminders?: Array<Record<string, unknown>>;
  } = {},
) {
  const invoices = opts.invoices ?? [invoice];
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/invoices/create-missing-links") {
      const r = opts.createLinks ?? { status: 200, body: { created: 12, failed: 0, skipped: 0, remaining: 0 } };
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      } as Response);
    }
    if (url === "/api/invoices/refresh-payments") {
      const r = opts.refreshAll ?? {
        status: 200,
        body: { checked: 3, updated: 1, failed: 0, remaining: 0, tally: {} },
      };
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      } as Response);
    }
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
    if (url.startsWith("/api/invoices/reminders")) {
      const data = opts.reminders ?? [];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data,
          pagination: { page: 1, pageSize: 50, total: data.length, totalPages: 1 },
          meta: { excludedNoNumber: 0, truncated: false },
        }),
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
      stubFetch({ stats: { sent: 2, overdue: 1, partiallyPaid: 1, owing: 4, outstanding: 1550000, collectedThisMonth: 1250000 } }),
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

describe("InvoicesClient — Cek semua belum lunas (cycle 2026-10-17-expired-link-overdue, T6)", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  const button = () => screen.findByRole("button", { name: "Cek semua belum lunas" });

  it("POSTs the batch endpoint, toasts the tally and reloads list + stats", async () => {
    const f = stubFetch();
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    const count = (needle: string) => f.mock.calls.filter((c) => String(c[0]).includes(needle)).length;
    const listBefore = count("/api/invoices?");
    const statsBefore = count("/api/invoices/stats");

    await user.click(await button());

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("3 tagihan diperiksa, 1 diperbarui."));
    const post = f.mock.calls.find((c) => String(c[0]) === "/api/invoices/refresh-payments");
    expect((post as unknown[] | undefined)?.[1]).toMatchObject({ method: "POST" });
    await waitFor(() => {
      expect(count("/api/invoices?")).toBeGreaterThan(listBefore);
      expect(count("/api/invoices/stats")).toBeGreaterThan(statsBefore);
    });
  });

  it("says how many are left so the admin knows to press again", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ refreshAll: { status: 200, body: { checked: 50, updated: 0, failed: 0, remaining: 120, tally: {} } } }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await user.click(await button());
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        "50 tagihan diperiksa, 0 diperbarui. Masih ada 120 tagihan, tekan lagi untuk melanjutkan.",
      ),
    );
  });

  it("warns when some invoices could not be checked at the gateway", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ refreshAll: { status: 200, body: { checked: 5, updated: 1, failed: 2, remaining: 0, tally: {} } } }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await user.click(await button());
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith("5 tagihan diperiksa, 1 diperbarui. 2 gagal diperiksa ke gateway."),
    );
  });

  it("tells the admin when there is nothing to check", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ refreshAll: { status: 200, body: { checked: 0, updated: 0, failed: 0, remaining: 0, tally: {} } } }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await user.click(await button());
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Tidak ada tagihan belum lunas yang perlu diperiksa sekarang."),
    );
  });

  it("shows the server's message when the request is refused (rate limit)", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ refreshAll: { status: 429, body: { error: "Terlalu sering memeriksa status. Tunggu sebentar lalu coba lagi." } } }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await user.click(await button());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Terlalu sering memeriksa status. Tunggu sebentar lalu coba lagi."),
    );
  });

  it("is hidden without the recordPayment capability, and does not take the create buttons with it", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<InvoicesClient gatewayId="doku" capabilities={{ create: true, recordPayment: false, void: false }} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByRole("button", { name: "Cek semua belum lunas" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Buat Tagihan/ })).toBeInTheDocument();
  });

  it("is offered to an admin who can record payments but not create invoices", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<InvoicesClient gatewayId="doku" capabilities={{ create: false, recordPayment: true, void: false }} />);
    expect(await button()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buat Tagihan/ })).not.toBeInTheDocument();
  });
});

describe("InvoicesClient — Pengingat WhatsApp (cycle 2026-10-17-payment-link-reminders, T8)", () => {
  const reminderButton = () => screen.findByRole("button", { name: "Pengingat WhatsApp" });

  it("is offered with the recordPayment capability and opens the reminder queue", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        reminders: [
          {
            id: "inv1", invoiceNumber: "INV-0001", periodLabel: "September 2026", dueDate: "2026-09-30",
            status: "SENT", totalDue: 500000, totalPaid: 0, remaining: 500000, studentName: "Aisyah Putri",
            guardianName: "Siti", hasLink: true, waUrl: "https://wa.me/6281200000000?text=halo",
            lastRemindedAt: null, lastRemindedByName: null, remindCount: 0,
          },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);

    await user.click(await reminderButton());

    const dialog = await screen.findByRole("dialog", { name: "Pengingat WhatsApp" });
    expect(await within(dialog).findByRole("link", { name: /Buka WhatsApp/ })).toHaveAttribute(
      "href",
      "https://wa.me/6281200000000?text=halo",
    );
  });

  it("is offered to an admin who can record payments but not create invoices", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<InvoicesClient gatewayId="doku" capabilities={{ create: false, recordPayment: true, void: false }} />);
    expect(await reminderButton()).toBeInTheDocument();
  });

  it("is hidden without the recordPayment capability, and does not take the create buttons with it", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<InvoicesClient gatewayId="doku" capabilities={{ create: true, recordPayment: false, void: false }} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByRole("button", { name: "Pengingat WhatsApp" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Buat Tagihan/ })).toBeInTheDocument();
  });
});

describe("InvoicesClient — Buat link baru (cycle 2026-10-17-payment-link-on-demand, T3)", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.warning).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  const withLinksMissing = { unpaidWithoutLink: 12 };
  const label = /Buat link baru \(\d+\)/;

  it("shows the count of unpaid invoices without a link in the label", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: withLinksMissing }));
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    expect(await screen.findByRole("button", { name: "Buat link baru (12)" })).toBeInTheDocument();
  });

  it("is absent when every unpaid invoice has a link", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: { unpaidWithoutLink: 0 } }));
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  });

  it("is absent without the create capability", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: withLinksMissing }));
    render(<InvoicesClient gatewayId="doku" capabilities={{ create: false, recordPayment: true, void: false }} />);
    await screen.findByRole("button", { name: "Cek semua belum lunas" });
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  });

  it("POSTs the batch endpoint, toasts how many were made and reloads list + stats", async () => {
    const f = stubFetch({ stats: withLinksMissing });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    const count = (needle: string) => f.mock.calls.filter((c) => String(c[0]).includes(needle)).length;
    const listBefore = count("/api/invoices?");
    const statsBefore = count("/api/invoices/stats");

    await user.click(await screen.findByRole("button", { name: "Buat link baru (12)" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("12 link dibuat."));
    const post = f.mock.calls.find((c) => String(c[0]) === "/api/invoices/create-missing-links");
    expect((post as unknown[] | undefined)?.[1]).toMatchObject({ method: "POST" });
    await waitFor(() => {
      expect(count("/api/invoices?")).toBeGreaterThan(listBefore);
      expect(count("/api/invoices/stats")).toBeGreaterThan(statsBefore);
    });
  });

  it("says how many are left so the admin knows to press again", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ stats: withLinksMissing, createLinks: { status: 200, body: { created: 25, failed: 0, skipped: 0, remaining: 60 } } }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await user.click(await screen.findByRole("button", { name: "Buat link baru (12)" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("25 link dibuat. Masih ada 60 tagihan, tekan lagi untuk melanjutkan."),
    );
  });

  it("warns when some links could not be made", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ stats: withLinksMissing, createLinks: { status: 200, body: { created: 5, failed: 2, skipped: 0, remaining: 2 } } }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await user.click(await screen.findByRole("button", { name: "Buat link baru (12)" }));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "5 link dibuat. Masih ada 2 tagihan, tekan lagi untuk melanjutkan. 2 gagal dibuat, coba lagi nanti.",
      ),
    );
  });

  it("shows the server's message when the request is refused (rate limit)", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({ stats: withLinksMissing, createLinks: { status: 429, body: { error: "Terlalu sering membuat link. Tunggu sebentar lalu coba lagi." } } }),
    );
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={caps} />);
    await user.click(await screen.findByRole("button", { name: "Buat link baru (12)" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Terlalu sering membuat link. Tunggu sebentar lalu coba lagi."),
    );
  });
});

describe("InvoicesClient — Status filter, five questions (cycle 2026-10-20-payment-link-expiry-display, T7)", () => {
  const counted = { owing: 9, overdue: 12, pendingPaymentLink: 2, unpaidWithoutLink: 3, paid: 40, cancelled: 1 };
  const listUrls = (f: ReturnType<typeof stubFetch>) =>
    f.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/invoices?"));

  async function openStatus(user: ReturnType<typeof userEvent.setup>) {
    // wait for the counts: options carry them only once the summary has loaded
    await screen.findByText("Piutang");
    await user.click(screen.getByRole("combobox", { name: "Filter Status" }));
    return screen.findAllByRole("option");
  }

  it("lists the six options in order, each with its whole-school count", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: counted }));
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    const options = await openStatus(user);
    expect(options.map((o) => o.textContent)).toEqual([
      "Semua Status",
      "Belum lunas (9)",
      "Lewat Tempo (12)",
      "Perlu link (5)",
      "Lunas (40)",
      "Dibatalkan (1)",
    ]);
  });

  it("offers 'Perlu dicek (N)' after 'Perlu link' only when N > 0", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: { ...counted, needsReview: 2 } }));
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    const options = await openStatus(user);
    expect(options.map((o) => o.textContent)).toEqual([
      "Semua Status", "Belum lunas (9)", "Lewat Tempo (12)", "Perlu link (5)", "Perlu dicek (2)", "Lunas (40)", "Dibatalkan (1)",
    ]);
  });

  it("has no 'Perlu dicek' option when nothing is flagged, or when the summary omits the field", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: { ...counted, needsReview: 0 } }));
    const user = userEvent.setup();
    const { unmount } = render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    expect((await openStatus(user)).some((o) => (o.textContent ?? "").includes("Perlu dicek"))).toBe(false);
    unmount();

    vi.stubGlobal("fetch", stubFetch({ stats: counted }));
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    const options = await openStatus(userEvent.setup());
    expect(options.some((o) => (o.textContent ?? "").includes("Perlu dicek"))).toBe(false);
  });

  it("picking 'Perlu dicek' sends NEEDS_REVIEW to the list", async () => {
    const f = stubFetch({ stats: { ...counted, needsReview: 2 } });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await openStatus(user);
    await user.click(screen.getByRole("option", { name: "Perlu dicek (2)" }));
    await waitFor(() => expect(listUrls(f).some((u) => u.includes("status=NEEDS_REVIEW"))).toBe(true));
  });

  it("a selected 'Perlu dicek' stays in the dropdown even when the count is 0", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: { ...counted, needsReview: 0 } }));
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} initialStatus="NEEDS_REVIEW" />);
    await screen.findByText("Piutang");
    expect(screen.getByRole("combobox", { name: "Filter Status" })).toHaveTextContent("Perlu dicek (0)");
    await user.click(screen.getByRole("combobox", { name: "Filter Status" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toContain("Perlu dicek (0)");
  });

  it("'Perlu link' count is the 'Buat link baru' number plus the 'Coba lagi' number", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: counted }));
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await screen.findByRole("button", { name: "Buat link baru (3)" });
    const options = await openStatus(user);
    expect(options.map((o) => o.textContent)).toContain("Perlu link (5)");
  });

  it("picking 'Belum lunas' and 'Perlu link' sends the derived value to the list", async () => {
    const f = stubFetch({ stats: counted });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await openStatus(user);
    await user.click(screen.getByRole("option", { name: "Belum lunas (9)" }));
    await waitFor(() => expect(listUrls(f).some((u) => u.includes("status=UNPAID"))).toBe(true));
    await user.click(screen.getByRole("combobox", { name: "Filter Status" }));
    await user.click(await screen.findByRole("option", { name: "Perlu link (5)" }));
    await waitFor(() => expect(listUrls(f).some((u) => u.includes("status=NEEDS_LINK"))).toBe(true));
  });

  it("a raw status from the address still filters and shows as one extra option, not 'Semua Status'", async () => {
    const f = stubFetch({ stats: counted });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} initialStatus="SENT" />);
    await waitFor(() => expect(listUrls(f).some((u) => u.includes("status=SENT"))).toBe(true));
    expect(screen.getByRole("combobox", { name: "Filter Status" })).toHaveTextContent("Link Dibuat");
    const options = await openStatus(user);
    expect(options.map((o) => o.textContent)).toEqual([
      "Semua Status", "Belum lunas (9)", "Lewat Tempo (12)", "Perlu link (5)", "Lunas (40)", "Dibatalkan (1)", "Link Dibuat",
    ]);
  });

  it("a dropdown status from the address shows its own counted label", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: counted }));
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} initialStatus="OVERDUE" />);
    await screen.findByText("Piutang");
    expect(screen.getByRole("combobox", { name: "Filter Status" })).toHaveTextContent("Lewat Tempo (12)");
  });
});

describe("InvoicesClient — Link berlaku column (cycle 2026-10-20-payment-link-expiry-display, T6)", () => {
  const caps = { create: true, recordPayment: true, void: true };

  it("adds a sortable 'Link berlaku' column after Status and shows the date in WIB", async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    vi.stubGlobal(
      "fetch",
      stubFetch({ invoices: [{ ...invoice, xenditPaymentUrl: "https://pay/x", paymentLinkExpiresAt: future }] }),
    );
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);

    await screen.findByRole("link", { name: /Aisyah Putri/ });
    const headers = screen.getAllByRole("columnheader");
    const labels = headers.map((h) => h.textContent ?? "");
    const statusIdx = labels.findIndex((l) => l.includes("Status"));
    expect(labels[statusIdx + 1]).toContain("Link berlaku");
    expect(within(headers[statusIdx + 1]).getByRole("button")).toBeInTheDocument();
    // column cell + the below-md meta line both render it (meta is css-hidden at md+, not removed)
    expect((await screen.findAllByText(/WIB/)).length).toBeGreaterThanOrEqual(2);
  });

  it("shows red Kedaluwarsa for an unpaid invoice whose date passed, in the column and the meta line", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        invoices: [{ ...invoice, xenditPaymentUrl: "https://pay/x", paymentLinkExpiresAt: "2026-01-01T00:00:00.000Z" }],
      }),
    );
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    const expired = await screen.findAllByText("Kedaluwarsa");
    expect(expired).toHaveLength(2);
    expired.forEach((el) => expect(el).toHaveClass("text-status-absent-text"));
  });

  it("shows an em dash in the column and nothing in the meta line when there is no link", async () => {
    vi.stubGlobal("fetch", stubFetch({ invoices: [{ ...invoice, xenditPaymentUrl: null, paymentLinkExpiresAt: null }] }));
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Link (s\/d|belum)/)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});

describe("InvoicesClient — Catat pembayaran di muka button (gate)", () => {
  const label = "Catat pembayaran di muka";

  it("is offered with both invoices.create and payments.record, and opens the dialog", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={caps} />);
    await user.click(await screen.findByRole("button", { name: label }));
    expect(await screen.findByRole("dialog", { name: "Catat Pembayaran di Muka" })).toBeInTheDocument();
  });

  it("is hidden without payments.record", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<InvoicesClient gatewayId="xendit" capabilities={{ create: true, recordPayment: false, void: false }} />);
    await screen.findByRole("button", { name: "Tagihan Manual" });
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  });

  it("is hidden without invoices.create", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<InvoicesClient gatewayId="xendit" capabilities={{ create: false, recordPayment: true, void: false }} />);
    await screen.findByRole("button", { name: "Cek semua belum lunas" });
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  });
});

describe("InvoicesClient — Tagihan Manual no longer offers Sudah dibayar (cycle 2026-10-30-prepay-other-fees)", () => {
  it.each([
    ["with payments.record", caps],
    ["without payments.record", { create: true, recordPayment: false, void: false }],
  ])("shows no paid-at-creation option %s", async (_name, capabilities) => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="xendit" capabilities={capabilities} />);
    await user.click(await screen.findByRole("button", { name: "Tagihan Manual" }));
    const dialog = await screen.findByRole("dialog", { name: "Tagihan Manual" });
    expect(within(dialog).queryByRole("checkbox", { name: /Sudah dibayar/ })).not.toBeInTheDocument();
  });
});

describe("InvoicesClient — Lainnya menu (phone header, cycle 2026-10-29-admin-mobile-stress, T2)", () => {
  const full = { create: true, recordPayment: true, void: true };
  const trigger = () => screen.findByRole("button", { name: "Lainnya" });

  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
  });

  it("lists the five secondary actions, with the link count, when opened", async () => {
    vi.stubGlobal("fetch", stubFetch({ stats: { unpaidWithoutLink: 12 } }));
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={full} />);
    await user.click(await trigger());
    const menu = await screen.findByRole("menu");
    const names = within(menu).getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(names).toEqual([
      "Buat link baru (12)",
      "Cek semua belum lunas",
      "Pengingat WhatsApp",
      "Tagihan Manual",
      "Catat pembayaran di muka",
    ]);
  });

  it("keeps the primary 'Buat Tagihan' outside the menu", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={full} />);
    await user.click(await trigger());
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Buat Tagihan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Buat Tagihan/ })).toBeInTheDocument();
  });

  it("offers only the actions the role may use", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={{ create: false, recordPayment: true, void: false }} />);
    await user.click(await trigger());
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((el) => el.textContent?.trim())).toEqual([
      "Cek semua belum lunas",
      "Pengingat WhatsApp",
    ]);
  });

  it("is absent when the role has no secondary action", async () => {
    vi.stubGlobal("fetch", stubFetch());
    render(<InvoicesClient gatewayId="doku" capabilities={{ create: false, recordPayment: false, void: true }} />);
    await screen.findByRole("link", { name: /Aisyah Putri/ });
    expect(screen.queryByRole("button", { name: "Lainnya" })).not.toBeInTheDocument();
  });

  it("'Tagihan Manual' in the menu opens the same dialog as the inline button", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={full} />);
    await user.click(await trigger());
    await user.click(await screen.findByRole("menuitem", { name: "Tagihan Manual" }));
    expect(await screen.findByRole("dialog", { name: "Tagihan Manual" })).toBeInTheDocument();
  });

  it("'Catat pembayaran di muka' in the menu opens its dialog", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={full} />);
    await user.click(await trigger());
    await user.click(await screen.findByRole("menuitem", { name: "Catat pembayaran di muka" }));
    expect(await screen.findByRole("dialog", { name: "Catat Pembayaran di Muka" })).toBeInTheDocument();
  });

  it("'Pengingat WhatsApp' in the menu opens the reminder queue", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={full} />);
    await user.click(await trigger());
    await user.click(await screen.findByRole("menuitem", { name: "Pengingat WhatsApp" }));
    expect(await screen.findByRole("dialog", { name: "Pengingat WhatsApp" })).toBeInTheDocument();
  });

  it("'Cek semua belum lunas' in the menu runs the same batch as the inline button", async () => {
    const f = stubFetch();
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={full} />);
    await user.click(await trigger());
    await user.click(await screen.findByRole("menuitem", { name: "Cek semua belum lunas" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("3 tagihan diperiksa, 1 diperbarui."));
    expect(f.mock.calls.some((c) => String(c[0]) === "/api/invoices/refresh-payments")).toBe(true);
  });

  it("'Buat link baru' in the menu POSTs the create-links endpoint", async () => {
    const f = stubFetch({ stats: { unpaidWithoutLink: 12 } });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<InvoicesClient gatewayId="doku" capabilities={full} />);
    await user.click(await trigger());
    await user.click(await screen.findByRole("menuitem", { name: "Buat link baru (12)" }));
    await waitFor(() =>
      expect(f.mock.calls.some((c) => String(c[0]) === "/api/invoices/create-missing-links")).toBe(true),
    );
  });
});
