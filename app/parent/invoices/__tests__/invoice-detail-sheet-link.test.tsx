/**
 * Parent invoice sheet — getting a working payment link themselves
 * (cycle 2026-10-17-payment-link-on-demand). An unpaid invoice whose link was
 * cleared after it expired still offers one pinned "Bayar Rp …" that makes the link and
 * goes to checkout; one that still shows a link offers "Link tidak bisa dibuka? Minta
 * link baru". Every message is the
 * app's own; nothing the server says is rendered.
 */
import { MESSAGES } from "@/lib/feedback";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { InvoiceDetailSheet } from "../invoice-detail-sheet";

const invoice = {
  id: "inv-3",
  invoiceNumber: "INV-2026-0003",
  periodLabel: "Feb-2026",
  dueDate: "2026-02-15",
  totalDue: 850000,
  totalPaid: 0,
  status: "OVERDUE",
  xenditPaymentUrl: null as string | null,
  schoolContactPhone: null as string | null,
  // sent long ago, so the page treats the missing link as stale rather than "being prepared"
  sentAt: "2026-02-01T00:00:00.000Z",
  paidAt: null as string | null,
  lines: [{ id: "l1", labelSnapshot: "SPP", amount: 850000, finalAmount: 850000, adjustmentAmount: 0, adjustmentNote: null }],
  payments: [] as unknown[],
  student: { name: "Aisyah Putri", nickname: "Aisyah", classSection: null },
};

type Reply = { status: number; body: Record<string, unknown> };

function renderSheet(over: Partial<typeof invoice>, reply: Reply | "network-error", onRefreshStatus = vi.fn()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/payment-link")) {
      if (reply === "network-error") throw new Error("offline");
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
    }
    return { ok: true, status: 200, json: async () => ({ ...invoice, ...over }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<InvoiceDetailSheet open onOpenChange={() => {}} invoiceId="inv-3" onRefreshStatus={onRefreshStatus} />);
  return { fetchMock, onRefreshStatus };
}

const posts = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).endsWith("/payment-link"));

const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  // Checkout opens in the same tab (window.open after an await is popup-blocked on phones).
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => vi.unstubAllGlobals());

describe("no link (expired and cleared)", () => {
  it("offers one Bayar Rp button pinned in the footer, outside the scrolling body, with the contact help in the body", async () => {
    renderSheet({}, { status: 200, body: { paymentUrl: "https://checkout.doku.com/new", created: true } });
    const footer = await screen.findByTestId("invoice-sheet-footer");
    const pay = within(footer).getByRole("button", { name: "Bayar Rp 850.000" });
    expect(pay).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Buat link pembayaran/ })).not.toBeInTheDocument();
    // The footer is not inside the scroller, which holds the Rincian.
    const scroller = screen.getByTestId("invoice-totals").closest(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(footer)).toBe(false);
    const contact = screen.getByTestId("contact-school");
    expect(scroller!.contains(contact)).toBe(true);
  });

  it("one tap POSTs the payment-link endpoint and goes straight to checkout in the same tab", async () => {
    const user = userEvent.setup();
    const { fetchMock } = renderSheet({}, { status: 200, body: { paymentUrl: "https://checkout.doku.com/new", created: true } });

    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.doku.com/new"));
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0][1]).toMatchObject({ method: "POST" });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("is disabled while the link is being made, so a second tap cannot ask again", async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    const hold = new Promise((r) => (release = r));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/payment-link")) {
        await hold;
        return { ok: true, status: 200, json: async () => ({ paymentUrl: "https://checkout.doku.com/new", created: true }) };
      }
      return { ok: true, status: 200, json: async () => invoice };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InvoiceDetailSheet open onOpenChange={() => {}} invoiceId="inv-3" />);

    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));
    const busy = await screen.findByRole("button", { name: /Menyiapkan pembayaran/ });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(posts(fetchMock)).toHaveLength(1);
    release(undefined);
  });

  it("a gateway failure shows our calm message inline, never the server's text, with Coba lagi and the school contact beside it", async () => {
    const user = userEvent.setup();
    renderSheet({}, { status: 502, body: { error: "DOKU 5xx raw gateway text" } });
    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Link belum bisa dibuat. Coba lagi sebentar lagi, atau hubungi tata usaha."),
    );
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain("DOKU");
    const footer = screen.getByTestId("invoice-sheet-footer");
    expect(within(footer).getByRole("alert")).toHaveTextContent("Link belum bisa dibuat");
    expect(within(footer).getByRole("alert")).not.toHaveTextContent("DOKU");
    expect(within(footer).getByRole("button", { name: "Coba lagi" })).toBeEnabled();
    expect(within(footer).getByTestId("contact-school")).toBeInTheDocument();
    expect(screen.getAllByTestId("contact-school")).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("a lost connection says so gently", async () => {
    const user = userEvent.setup();
    renderSheet({}, "network-error");
    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(MESSAGES.network));
    expect(within(screen.getByTestId("invoice-sheet-footer")).getByRole("alert")).toHaveTextContent(MESSAGES.network);
  });

  it("too many tries is said plainly", async () => {
    const user = userEvent.setup();
    renderSheet({}, { status: 429, body: { error: "Terlalu sering mencoba. Tunggu sebentar ya." } });
    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Terlalu sering mencoba. Tunggu sebentar ya."));
  });

  it("an invoice that can no longer be paid by link (paid meanwhile) re-reads the status instead of erroring", async () => {
    const user = userEvent.setup();
    const { onRefreshStatus } = renderSheet({}, { status: 409, body: { code: "NOT_PAYABLE" } });
    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));
    await waitFor(() => expect(onRefreshStatus).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("Coba lagi after a failure", () => {
  it("asks again and goes to checkout when the second try works", async () => {
    const user = userEvent.setup();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/payment-link")) {
          call += 1;
          return call === 1
            ? { ok: false, status: 502, json: async () => ({}) }
            : { ok: true, status: 200, json: async () => ({ paymentUrl: "https://checkout.doku.com/second", created: true }) };
        }
        return { ok: true, status: 200, json: async () => invoice };
      }),
    );
    render(<InvoiceDetailSheet open onOpenChange={() => {}} invoiceId="inv-3" />);
    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));
    await user.click(await screen.findByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.doku.com/second"));
  });
});

describe("the parent moves to another invoice while a request is out", () => {
  const byId: Record<string, typeof invoice> = {
    "inv-A": { ...invoice, id: "inv-A", invoiceNumber: "INV-A" },
    "inv-B": { ...invoice, id: "inv-B", invoiceNumber: "INV-B" },
  };

  async function setUp(reply: { status: number; body: Record<string, unknown> }) {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/payment-link")) {
        await hold;
        return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
      }
      return { ok: true, status: 200, json: async () => byId[url.split("/").pop()!] };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const ui = (id: string) => <InvoiceDetailSheet open onOpenChange={() => {}} invoiceId={id} />;
    const view = render(ui("inv-A"));
    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));
    view.rerender(ui("inv-B")); // the parent opened B while A's request is still out
    await screen.findAllByText("INV-B");
    return { release: async () => { release(); await new Promise((r) => setTimeout(r, 50)); }, fetchMock };
  }

  it("A's checkout link never lands on B: B still offers to make its own, and nothing is toasted", async () => {
    const { release } = await setUp({ status: 200, body: { paymentUrl: "https://checkout.doku.com/invoice-A", created: true } });

    await release();

    expect(screen.queryByRole("link", { name: /Bayar Rp/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bayar Rp/ })).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("B does not look busy because A's request is in flight, and can make its own link", async () => {
    await setUp({ status: 200, body: { paymentUrl: "https://checkout.doku.com/invoice-A", created: true } });
    expect(screen.getByRole("button", { name: /Bayar Rp/ })).toBeEnabled();
  });

  it("a failure for A is not toasted over B either", async () => {
    const { release } = await setUp({ status: 502, body: { error: "x" } });
    await release();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Bayar Rp/ })).toBeEnabled();
  });

  it("closing the sheet while the request is out drops the answer too", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/payment-link")) {
          await hold;
          return { ok: true, status: 200, json: async () => ({ paymentUrl: "https://checkout.doku.com/invoice-A", created: true }) };
        }
        return { ok: true, status: 200, json: async () => byId["inv-A"] };
      }),
    );
    const user = userEvent.setup();
    const view = render(<InvoiceDetailSheet open onOpenChange={() => {}} invoiceId="inv-A" />);
    await user.click(await screen.findByRole("button", { name: /Bayar Rp/ }));
    view.rerender(<InvoiceDetailSheet open={false} onOpenChange={() => {}} invoiceId="inv-A" />);
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("a link is shown (maybe already expired)", () => {
  const withLink = { xenditPaymentUrl: "https://checkout.doku.com/old", status: "SENT" };

  it("shows Bayar Rp as a link to the checkout and adds the small Minta link baru action", async () => {
    renderSheet(withLink, { status: 200, body: { paymentUrl: "https://checkout.doku.com/old", created: false } });
    const pay = await screen.findByRole("link", { name: "Bayar Rp 850.000" });
    expect(pay).toHaveAttribute("href", "https://checkout.doku.com/old");
    expect(pay).toHaveAttribute("target", "_blank");
    expect(within(screen.getByTestId("invoice-sheet-footer")).getByRole("link", { name: /Bayar Rp/ })).toBe(pay);
    expect(screen.getByRole("button", { name: "Link tidak bisa dibuka? Minta link baru" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bayar Rp/ })).not.toBeInTheDocument();
  });

  it("a replaced link points Bayar Rp at the new one", async () => {
    const user = userEvent.setup();
    renderSheet(withLink, { status: 200, body: { paymentUrl: "https://checkout.doku.com/fresh", created: true } });
    await user.click(await screen.findByRole("button", { name: "Link tidak bisa dibuka? Minta link baru" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Bayar Rp/ })).toHaveAttribute("href", "https://checkout.doku.com/fresh"),
    );
  });

  it("a link that is still live is kept and the parent is told it still works", async () => {
    const user = userEvent.setup();
    renderSheet(withLink, { status: 200, body: { paymentUrl: "https://checkout.doku.com/old", created: false } });
    await user.click(await screen.findByRole("button", { name: "Link tidak bisa dibuka? Minta link baru" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Link pembayaran masih berlaku. Silakan ketuk tombol Bayar."),
    );
    expect(screen.getByRole("link", { name: /Bayar Rp/ })).toHaveAttribute("href", "https://checkout.doku.com/old");
  });
});

describe("states that must not offer it", () => {
  it("a paid invoice shows neither button", async () => {
    renderSheet({ status: "PAID", totalPaid: 850000, paidAt: "2026-02-10T00:00:00.000Z" }, { status: 200, body: {} });
    await screen.findByTestId("invoice-totals");
    expect(screen.queryByRole("button", { name: /Bayar Rp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Minta link baru/ })).not.toBeInTheDocument();
  });

  it("a link still being prepared (sent a minute ago) keeps its disabled note and no create button", async () => {
    renderSheet({ sentAt: new Date().toISOString(), status: "SENT" }, { status: 200, body: {} });
    expect(await screen.findByText(/sedang disiapkan/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bayar Rp/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).not.toBeInTheDocument();
  });
});
