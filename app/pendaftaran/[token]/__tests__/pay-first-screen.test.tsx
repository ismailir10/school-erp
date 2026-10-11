/**
 * The "Bayar dulu" screen (pay-first): what is owed and for what, what waits behind
 * the payment, one action, and an honest note that the fee is not refundable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PayFirstScreen } from "../pay-first-screen";
import type { PaymentGateView } from "@/lib/enrollment/payment-gate";

const STEPS = ["Data Anak", "Data Ayah", "Data Ibu", "Program", "Berkas", "Persetujuan", "Tinjau"];

const gate = (over: Partial<PaymentGateView> = {}): PaymentGateView => ({
  programName: "Kelompok Bermain",
  dcareAddon: false,
  fee: { amount: 300_000, baseAmount: 300_000, discountPercent: 0, status: "UNPAID", paidAt: null, started: false },
  steps: STEPS,
  requiredDocuments: [
    { key: "akta", label: "Akta kelahiran anak" },
    { key: "kk", label: "Kartu Keluarga (KK)" },
  ],
  closed: false,
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

function renderScreen(props: Partial<React.ComponentProps<typeof PayFirstScreen>> = {}) {
  return render(<PayFirstScreen token="tok-1" gate={gate()} mode="start" phone={null} navigate={navigate} {...props} />);
}

describe("PayFirstScreen — what the parent sees", () => {
  it("leads with the headline, then the amount for the program", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Bayar biaya formulir untuk mulai mengisi" })).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Biaya formulir" });
    expect(within(panel).getByText("Kelompok Bermain")).toBeInTheDocument();
    expect(within(panel).getByText("Rp 300.000")).toHaveClass("tabular-nums");
    expect(within(panel).queryByText("Tambahan Day Care")).not.toBeInTheDocument();
  });

  it("names the Day Care add-on when it is on", () => {
    renderScreen({ gate: gate({ dcareAddon: true }) });
    expect(screen.getByText("Tambahan Day Care")).toBeInTheDocument();
  });

  it("still shows the amount when the program was removed since", () => {
    renderScreen({ gate: gate({ programName: null }) });
    expect(screen.getByText("Rp 300.000")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Biaya formulir" })).queryByText("Program")).not.toBeInTheDocument();
  });

  it("shows the discount and the total when staff gave one", () => {
    renderScreen({
      gate: gate({ fee: { amount: 240_000, baseAmount: 300_000, discountPercent: 20, status: "UNPAID", paidAt: null, started: false } }),
    });
    expect(screen.getByText("Diskon 20%")).toBeInTheDocument();
    expect(screen.getByText("Rp 240.000")).toBeInTheDocument();
  });

  it("lists the seven steps in order and the documents to prepare", () => {
    renderScreen();
    const after = screen.getByRole("region", { name: "Setelah bayar, Bapak/Ibu bisa mengisi:" });
    const items = within(within(after).getAllByRole("list")[0]).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(STEPS.map((s, i) => `${i + 1}.${s}`));
    expect(within(after).getByText("Akta kelahiran anak")).toBeInTheDocument();
    expect(within(after).getByText("Kartu Keluarga (KK)")).toBeInTheDocument();
  });

  it("falls back to a generic line when the school requires no document", () => {
    renderScreen({ gate: gate({ requiredDocuments: [] }) });
    expect(screen.getByText(/Berkas pendukung diunggah di langkah Berkas; daftar lengkapnya akan terlihat di sana\./)).toBeInTheDocument();
    expect(screen.queryByText(/Akta kelahiran, Kartu Keluarga/)).not.toBeInTheDocument();
  });

  it("says the fee cannot be refunded and where to get help", () => {
    renderScreen();
    expect(screen.getByText(/Biaya formulir tidak dapat dikembalikan\./)).toBeInTheDocument();
    expect(screen.getByText(/Butuh bantuan\? Hubungi sekolah\./)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers one-tap WhatsApp and call links when the school has a number", () => {
    renderScreen({ phone: "0812-8877-4402" });
    expect(screen.getByRole("link", { name: /Chat WhatsApp\s+\(tab baru\)/ })).toHaveAttribute("href", "https://wa.me/6281288774402");
    expect(screen.getByRole("link", { name: /Telepon sekolah/ })).toHaveAttribute("href", "tel:081288774402");
  });

  it("says the fee is not refundable before the pay button, not after it", () => {
    renderScreen();
    const note = screen.getByText(/Biaya formulir tidak dapat dikembalikan\./);
    const button = screen.getByRole("button", { name: "Bayar sekarang" });
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not point back at the form: there is no way past the payment", () => {
    renderScreen();
    expect(screen.queryByRole("link", { name: /formulir pendaftaran/i })).not.toBeInTheDocument();
  });

  it("moves focus to the headline so a screen reader starts there", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });
});

describe("PayFirstScreen — paying", () => {
  it("Bayar sekarang asks for a link for THIS token and goes to the gateway", async () => {
    const user = userEvent.setup();
    renderScreen();
    const button = screen.getByRole("button", { name: "Bayar sekarang" });
    expect(button).toBeEnabled();
    expect(button).toHaveClass("h-12");

    await user.click(button);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://doku.example/pay/1"));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/enrollments/token/tok-1/pay");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("shows the loading state while the link is being made", async () => {
    let release!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((r) => (release = r)));
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    expect(await screen.findByRole("button", { name: "Menyiapkan pembayaran..." })).toBeDisabled();
    release({ ok: true, status: 200, json: async () => ({ paymentUrl: "https://doku.example/pay/1" }) } as Response);
  });

  it("a failed link says so in words and lets the parent try again", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(502, { error: "LINK_FAILED" }));
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Tautan pembayaran belum bisa dibuat. Coba lagi sebentar.");
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
  });

  it("a fee settled in another tab refreshes the page, which hands on to the form", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(200, { status: "PAID" }));
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // No child name yet on this screen: the receipt must not name a blank "ananda".
    expect(screen.getByText(/biaya pendaftaran sudah lunas\./).textContent).not.toMatch(/ananda/);
  });

  it("a waived fee settled in another tab reads without a blank child name", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(200, { status: "WAIVED" }));
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    expect(await screen.findByText("Biaya pendaftaran sudah dibebaskan.")).toBeInTheDocument();
  });

  it.each(["javascript:alert(1)", "http://doku.example/pay/1", "data:text/html,x", "//evil.example/x"])(
    "never navigates to %s",
    async (url) => {
      vi.mocked(fetch).mockImplementation(() => reply(200, { paymentUrl: url }));
      const user = userEvent.setup();
      renderScreen();
      await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Tautan pembayaran belum bisa dibuat. Coba lagi sebentar.");
      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Bayar sekarang" })).toBeEnabled();
    },
  );

  it("an expired link says so, with where to go", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(410, { error: "EXPIRED" }));
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Bayar sekarang" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tautan sudah kedaluwarsa. Hubungi tim penerimaan untuk tautan baru.");
  });
});

describe("PayFirstScreen — coming back from the gateway", () => {
  it("not received yet: a gentle note, a way to check again, and the way to pay again", () => {
    renderScreen({ mode: "pending", gate: gate({ fee: { ...gate().fee, started: true } }) });
    expect(screen.getByRole("heading", { name: "Menunggu pembayaran" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Kami belum menerima pembayaran/);
    expect(screen.getByRole("button", { name: "Periksa lagi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjutkan pembayaran" })).toBeEnabled();
    expect(screen.getByText(/tidak dapat dikembalikan/)).toBeInTheDocument();
  });

  it("cancelled: says nothing came in and offers to try again", () => {
    renderScreen({ mode: "cancelled", gate: gate({ fee: { ...gate().fee, started: true } }) });
    expect(screen.getByRole("heading", { name: "Pembayaran belum selesai" })).toBeInTheDocument();
    expect(screen.getByText(/Belum ada pembayaran yang masuk/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjutkan pembayaran" })).toBeEnabled();
  });
});
