/**
 * The pendaftaran fee as the parent sees it (cycle 2026-10-10-pendaftaran-fee-payment):
 * amount, discount, the pay button and what each failure says.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PaymentPanel } from "../payment-panel";
import type { PublicFeeView } from "@/lib/enrollment/fee-view";

const unpaid = (over: Partial<PublicFeeView> = {}): PublicFeeView => ({
  amount: 300_000,
  baseAmount: 300_000,
  discountPercent: 0,
  status: "UNPAID",
  paidAt: null,
  started: false,
  ...over,
});

function reply(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

const navigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => reply(200, { paymentUrl: "https://doku.example/pay/1" })));
});

function renderPanel(props: Partial<React.ComponentProps<typeof PaymentPanel>> = {}) {
  return render(<PaymentPanel token="tok-1" childName="Aisyah" fee={unpaid()} navigate={navigate} {...props} />);
}

describe("PaymentPanel — unpaid, right after submit", () => {
  it("shows the step, the amount and one clear action", () => {
    renderPanel();
    expect(screen.getByText("Langkah terakhir")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bayar biaya pendaftaran" })).toBeInTheDocument();
    expect(screen.getByText("Aisyah")).toBeInTheDocument();
    expect(screen.getByText("Rp 300.000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
    // Reassures about leaving now, and where the money goes.
    expect(screen.getByText(/diarahkan ke halaman pembayaran DOKU/)).toBeInTheDocument();
    expect(screen.getByText(/dibayar nanti lewat tautan formulir yang sama/)).toBeInTheDocument();
  });

  it("shows the normal fee struck through, the discount and the total when there is one", () => {
    renderPanel({ fee: unpaid({ amount: 240_000, baseAmount: 300_000, discountPercent: 20 }) });
    const normal = screen.getByText("Rp 300.000");
    expect(normal).toHaveClass("line-through");
    expect(screen.getByText("Diskon 20%")).toBeInTheDocument();
    // −Rp 60.000, with a spoken "minus" for screen readers
    const discount = screen.getByText(/Rp 60\.000/);
    expect(within(discount).getByText("minus", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Rp 240.000")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("does not mention a discount when there is none", () => {
    renderPanel();
    expect(screen.queryByText(/Diskon/)).not.toBeInTheDocument();
    expect(screen.queryByText("Biaya normal")).not.toBeInTheDocument();
  });

  it("offers to continue (not start) once a payment link was already issued", () => {
    renderPanel({ fee: unpaid({ started: true }) });
    expect(screen.getByRole("button", { name: "Lanjutkan pembayaran" })).toBeInTheDocument();
  });
});

describe("PaymentPanel — paying", () => {
  it("asks the server for a link for THIS token and sends the browser there", async () => {
    const user = userEvent.setup();
    renderPanel({ token: "tok/1 x" });
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://doku.example/pay/1"));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/enrollments/token/tok%2F1%20x/pay");
    expect((init as RequestInit).method).toBe("POST");
    // The amount is the server's business: nothing about it is sent.
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("shows a busy state, ignores a second tap, and stays busy while the browser leaves", async () => {
    let resolve!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((r) => (resolve = r)));
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    const busy = await screen.findByRole("button", { name: /Menyiapkan pembayaran/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    await user.click(busy);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolve({ ok: true, status: 200, json: async () => ({ paymentUrl: "https://doku.example/pay/2" }) } as Response);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://doku.example/pay/2"));
    expect(screen.getByRole("button", { name: /Menyiapkan pembayaran/ })).toBeDisabled();
  });

  it.each([
    ["the gateway cannot issue a link (502)", 502, { error: "LINK_FAILED", message: "raw vendor text" }, "Tautan pembayaran belum bisa dibuat. Coba lagi sebentar."],
    ["rate limited (429)", 429, { error: "rate_limited" }, "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."],
    ["the link is unknown (404)", 404, { error: "Not found" }, "Pembayaran belum bisa dimulai. Silakan hubungi tim penerimaan."],
    ["a server error (500)", 500, {}, "Pembayaran belum bisa dimulai. Silakan hubungi tim penerimaan."],
  ])("says what to do when %s — in our words, never the server's, and lets the parent retry", async (_n, status, body, text) => {
    vi.mocked(fetch).mockImplementation(() => reply(status, body));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByText(/raw vendor text/)).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
  });

  it("a lost connection reads as a connection problem", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Koneksi terputus. Coba lagi sebentar ya.");
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
  });

  it("a rejected application removes the pay button and explains", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(409, { error: "APPLICATION_CLOSED" }));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Pendaftaran ini tidak dilanjutkan");
    expect(screen.queryByRole("button", { name: /Bayar|pembayaran/i })).not.toBeInTheDocument();
    // Said once, not twice (no extra error alert on top of the explanation).
    expect(screen.getAllByText(/Pendaftaran ini tidak dilanjutkan/)).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("paid from another tab: the answer says PAID, so the receipt replaces the button", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(200, { status: "PAID" }));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    expect(await screen.findByRole("heading", { name: /Pembayaran diterima/ })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    // The receipt never shows THIS device's clock as the payment time; the real
    // time arrives with the refreshed server state.
    expect(screen.queryByText("Dibayar")).not.toBeInTheDocument();
  });

  it("Back from DOKU (page restored from the browser cache) releases a button left busy", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(200, { paymentUrl: "https://doku.example/pay/1" }));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    // It stays busy while the browser leaves…
    expect(await screen.findByRole("button", { name: /Menyiapkan pembayaran/ })).toBeDisabled();

    // …and the parent presses Back: the cached page returns with that state intact.
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
  });

  it("an ordinary pageshow (a fresh load) does nothing", async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(screen.getByRole("button", { name: /Menyiapkan pembayaran/ })).toBeDisabled();
  });
});

describe("PaymentPanel — follows the server after a refresh", () => {
  it("Periksa lagi → the server now says PAID → the panel becomes the receipt (no reload needed)", () => {
    const { rerender } = renderPanel({ mode: "pending", fee: unpaid({ started: true }) });
    expect(screen.getByRole("heading", { name: "Menunggu pembayaran" })).toBeInTheDocument();

    // router.refresh() re-renders the server tree: the SAME mounted panel gets a new fee prop.
    rerender(
      <PaymentPanel
        token="tok-1"
        childName="Aisyah"
        mode="pending"
        fee={unpaid({ started: true, status: "PAID", paidAt: "2026-10-10T03:05:00.000Z" })}
        navigate={navigate}
      />,
    );

    expect(screen.getByRole("heading", { name: "Pembayaran diterima" })).toBeInTheDocument();
    expect(screen.queryByText("Menunggu pembayaran")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // The time is the server's.
    expect(screen.getByText(/10 Okt 2026/)).toBeInTheDocument();
  });

  it("staff reject the application while the page is open → the next refresh removes the pay buttons", () => {
    const { rerender } = renderPanel({ mode: "pending", fee: unpaid({ started: true }) });
    expect(screen.getByRole("button", { name: "Lanjutkan pembayaran" })).toBeInTheDocument();

    rerender(<PaymentPanel token="tok-1" childName="Aisyah" mode="pending" fee={unpaid({ started: true })} closed navigate={navigate} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Pendaftaran ini tidak dilanjutkan/)).toBeInTheDocument();
  });

  it("a fee waived by staff while the page is open shows as waived after the refresh", () => {
    const { rerender } = renderPanel();
    rerender(<PaymentPanel token="tok-1" childName="Aisyah" fee={unpaid({ status: "WAIVED", amount: 0 })} navigate={navigate} />);
    expect(screen.getByRole("heading", { name: "Biaya pendaftaran dibebaskan" })).toBeInTheDocument();
  });

  it("the discount staff set shows up after a refresh too", () => {
    const { rerender } = renderPanel({ mode: "pending", fee: unpaid({ started: true }) });
    expect(screen.queryByText(/Diskon/)).not.toBeInTheDocument();
    rerender(
      <PaymentPanel
        token="tok-1"
        childName="Aisyah"
        mode="pending"
        fee={unpaid({ started: true, amount: 240_000, baseAmount: 300_000, discountPercent: 20 })}
        navigate={navigate}
      />,
    );
    expect(screen.getByText("Diskon 20%")).toBeInTheDocument();
    expect(screen.getByText("Rp 240.000")).toBeInTheDocument();
  });

  it("Periksa lagi gives feedback: it says when it last checked", async () => {
    const user = userEvent.setup();
    renderPanel({ mode: "pending", fee: unpaid({ started: true }) });
    expect(screen.queryByText(/Terakhir diperiksa/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Periksa lagi" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Terakhir diperiksa pukul/)).toBeInTheDocument();
  });
});

describe("PaymentPanel — headings", () => {
  it("is an h2 by default (under a page h1)", () => {
    renderPanel();
    expect(screen.getByRole("heading", { level: 2, name: "Bayar biaya pendaftaran" })).toBeInTheDocument();
  });

  it("is an h3 inside a card that already has an h2", () => {
    renderPanel({ headingLevel: 3 });
    expect(screen.getByRole("heading", { level: 3, name: "Bayar biaya pendaftaran" })).toBeInTheDocument();
  });

  it("the receipt and the waived card follow the same level", () => {
    const { unmount } = renderPanel({ fee: unpaid({ status: "PAID", paidAt: "2026-10-10T03:05:00.000Z" }), headingLevel: 3 });
    expect(screen.getByRole("heading", { level: 3, name: "Pembayaran diterima" })).toBeInTheDocument();
    unmount();
    renderPanel({ fee: unpaid({ status: "WAIVED", amount: 0 }) });
    expect(screen.getByRole("heading", { level: 2, name: "Biaya pendaftaran dibebaskan" })).toBeInTheDocument();
  });
});

describe("PaymentPanel — other states", () => {
  it("closed up front (rejected application): the amount stays, no button", () => {
    renderPanel({ closed: true });
    expect(screen.getByText("Rp 300.000")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // Not told to pay, and not told it is the "last step", when it cannot.
    expect(screen.getByRole("heading", { name: "Biaya pendaftaran" })).toBeInTheDocument();
    expect(screen.queryByText("Langkah terakhir")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Pendaftaran ini tidak dilanjutkan/)).toHaveLength(1);
  });

  it("back from DOKU, not paid yet: waits, explains Virtual Account lag, offers to check again", async () => {
    const user = userEvent.setup();
    renderPanel({ mode: "pending", fee: unpaid({ started: true }) });
    expect(screen.getByRole("heading", { name: "Menunggu pembayaran" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Virtual Account bisa memerlukan beberapa menit/);
    expect(screen.queryByText("Langkah terakhir")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Periksa lagi" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    // …and can still go back to pay.
    expect(screen.getByRole("button", { name: "Lanjutkan pembayaran" })).toBeEnabled();
  });

  it("back from DOKU after cancelling: nothing was charged, try again any time", () => {
    renderPanel({ mode: "cancelled", fee: unpaid({ started: true }) });
    expect(screen.getByRole("heading", { name: "Pembayaran belum selesai" })).toBeInTheDocument();
    expect(screen.getByText(/Belum ada pembayaran yang masuk/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Periksa lagi" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjutkan pembayaran" })).toBeEnabled();
  });

  it("paid: a receipt with amount and time in WIB, and no payment action", () => {
    renderPanel({ fee: unpaid({ status: "PAID", paidAt: "2026-10-10T03:05:00.000Z" }) });
    expect(screen.getByRole("heading", { name: "Pembayaran diterima" })).toBeInTheDocument();
    expect(screen.getByText(/Alhamdulillah, biaya pendaftaran ananda/)).toBeInTheDocument();
    expect(screen.getByText("Rp 300.000")).toBeInTheDocument();
    expect(screen.getByText(/10 Okt 2026/)).toBeInTheDocument();
    expect(screen.getByText(/10\.05/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("paid with a discount shows what was actually paid", () => {
    renderPanel({ fee: unpaid({ status: "PAID", amount: 240_000, baseAmount: 300_000, discountPercent: 20, paidAt: "2026-10-10T03:05:00.000Z" }) });
    expect(screen.getByText("Rp 240.000")).toBeInTheDocument();
    expect(screen.queryByText("Rp 300.000")).not.toBeInTheDocument();
  });

  it("waived: says there is nothing to pay", () => {
    renderPanel({ fee: unpaid({ status: "WAIVED", amount: 0 }) });
    expect(screen.getByRole("heading", { name: "Biaya pendaftaran dibebaskan" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
