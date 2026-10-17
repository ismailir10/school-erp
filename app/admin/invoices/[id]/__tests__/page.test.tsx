/**
 * finance-safety (2026-09-29): recording is now two steps — "Tinjau
 * Pembayaran" opens a review (invoice, student, Rp amount, method, date,
 * resulting status) and only "Catat Rp …" POSTs. Also covers reversal,
 * reversed-row rendering, "Dicatat oleh", cancel for OVERDUE invoices, and
 * the FIN-11/20/23 details.
 *
 * T6 (2026-09-27 admin-finish-standard) — the "Catat Pembayaran" dialog
 * migrated from a 4-field `useState` onto react-hook-form + zod
 * (`invoicePaymentFormSchema`, lib/validations/invoice.ts). POST
 * /api/invoices/[id]/payments switched from ad-hoc `safeParse` to
 * `validateBody` (same `recordPaymentSchema`) so a rejected amount maps back
 * onto the Jumlah field instead of only a generic toast.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "inv-1" }) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import InvoiceDetailPage from "../page";

const TODAY = getTodayInTimezone("Asia/Jakarta");
const daysAgo = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const baseInvoice = {
  capabilities: { create: true, recordPayment: true, void: true },
  id: "inv-1",
  invoiceNumber: "INV-2026-001",
  periodLabel: "September 2026",
  dueDate: "2026-09-30",
  totalDue: 1000000,
  totalPaid: 400000,
  status: "PARTIALLY_PAID",
  xenditPaymentUrl: null as string | null,
  paymentLinkError: null,
  student: {
    name: "Ahmad",
    nickname: null,
    guardians: [] as Array<{ parent: { name: string; phone: string | null; email: string | null; whatsapp: string | null } }>,
  },
  lines: [],
  payments: [] as Array<Record<string, unknown>>,
};

const cashPayment = {
  id: "pay-1", amount: 400000, method: "CASH", reference: null, notes: null,
  paidAt: "2026-09-10T03:00:00.000Z", status: "RECORDED", createdBy: "u-9", createdByName: "Bu Nur",
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

function fixture(
  overrides: { postStatus?: number; postBody?: unknown; invoice?: Partial<typeof baseInvoice> } = {},
) {
  const { postStatus = 201, postBody = { id: "pay-1" } } = overrides;
  const invoice = { ...baseInvoice, ...overrides.invoice };
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === "/api/invoices/inv-1/payments" && init?.method === "POST") {
      return Promise.resolve(jsonResponse(postBody, postStatus < 400, postStatus));
    }
    if (input.endsWith("/reverse") && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (input === "/api/invoices/inv-1/void" && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (input === "/api/invoices/inv-1") return Promise.resolve(jsonResponse(invoice));
    // PaymentActivityCard always fetches this on mount and expects an array.
    if (input === "/api/invoices/inv-1/webhook-events") return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof fixture>, urlPart = "/payments") =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes(urlPart) && (init as RequestInit | undefined)?.method === "POST",
  );

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Catat Pembayaran" }));
  return screen.findByRole("dialog", { name: "Catat Pembayaran" });
}

describe("InvoiceDetailPage — Catat Pembayaran dialog", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("blocks an empty amount with 'Jumlah pembayaran wajib diisi' and sends no POST", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    const dialog = await openDialog();
    await user.clear(within(dialog).getByRole("textbox", { name: "Jumlah" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));

    expect(await within(dialog).findByText("Jumlah pembayaran wajib diisi")).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("FIN-6: the primary button only opens a review; nothing is POSTed until 'Catat Rp …'", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    const dialog = await openDialog();
    // The remaining balance stays prefilled (convenience kept).
    expect(within(dialog).getByRole("textbox", { name: "Jumlah" })).toHaveValue("600.000");
    await user.type(within(dialog).getByRole("textbox", { name: "Referensi" }), "TRX-001");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));

    const review = await within(dialog).findByTestId("payment-review");
    expect(posts(fetchMock)).toHaveLength(0);
    expect(within(review).getByText("INV-2026-001")).toBeInTheDocument();
    expect(within(review).getByText("Ahmad")).toBeInTheDocument();
    expect(within(review).getByTestId("payment-review-amount")).toHaveTextContent("Rp 600.000");
    expect(within(review).getByText("Tunai")).toBeInTheDocument();
    expect(within(review).getByText("TRX-001")).toBeInTheDocument();
    expect(within(review).getByText("Lunas")).toBeInTheDocument(); // 600k settles the 600k balance

    fireEvent.click(within(dialog).getByRole("button", { name: "Catat Rp 600.000" }));

    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const [, postInit] = posts(fetchMock)[0];
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      idempotencyKey: expect.any(String),
      amount: 600000, // totalDue (1,000,000) - totalPaid (400,000)
      method: "CASH",
      reference: "TRX-001",
      notes: "",
      paidAt: TODAY, // FINX-9: defaults to today (Asia/Jakarta)
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pembayaran dicatat"));
  });

  it("keeps the attempt key after a lost response and starts a fresh key after success", async () => {
    const fetchMock = fixture();
    const original = fetchMock.getMockImplementation()!;
    let loseResponse = true;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      if (input.endsWith("/payments") && init?.method === "POST" && loseResponse) {
        loseResponse = false;
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return original(input, init);
    });
    render(<InvoiceDetailPage />);
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Catat Rp 600.000" }));
    await within(dialog).findByText(/Hasil pencatatan belum dapat dipastikan/);
    const body = (index: number) => JSON.parse(posts(fetchMock)[index][1]!.body as string);
    const firstKey = body(0).idempotencyKey;
    expect(sessionStorage.getItem("manual-payment-attempt:inv-1")).toBe(firstKey);
    fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Catat Rp 600.000" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(body(1).idempotencyKey).toBe(firstKey);
    expect(sessionStorage.getItem("manual-payment-attempt:inv-1")).toBeNull();
    const next = await openDialog();
    fireEvent.click(within(next).getByRole("button", { name: "Tinjau Pembayaran" }));
    fireEvent.click(await within(next).findByRole("button", { name: "Catat Rp 600.000" }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(3));
    expect(body(2).idempotencyKey).not.toBe(firstKey);
  });

  it("FINX-9: 'Tanggal bayar' defaults to today, caps at today, and a back-dated choice reaches the review and the POST", async () => {
    // A coarse pointer renders the native <input type="date">, which jsdom can drive.
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("pointer: coarse"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const fetchMock = fixture();
      render(<InvoiceDetailPage />);

      const dialog = await openDialog();
      const date = (await within(dialog).findByLabelText(/Tanggal bayar/)) as HTMLInputElement;
      expect(date).toHaveValue(TODAY);
      expect(date).toHaveAttribute("max", TODAY);

      const day = daysAgo(4);
      fireEvent.change(date, { target: { value: day } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));

      const review = await within(dialog).findByTestId("payment-review");
      expect(within(review).getByText("Tanggal bayar")).toBeInTheDocument();
      expect(within(review).getByText(new Date(`${day}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }))).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: "Catat Rp 600.000" }));
      await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
      const [, postInit] = posts(fetchMock)[0];
      expect(JSON.parse((postInit as RequestInit).body as string).paidAt).toBe(day);
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it("review of a partial amount on a past-due invoice says 'Lewat Tempo' with the remainder", async () => {
    fixture({ invoice: { dueDate: daysAgo(3) } });
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    const dialog = await openDialog();
    const amount = within(dialog).getByRole("textbox", { name: "Jumlah" });
    await user.clear(amount);
    await user.type(amount, "250000");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));

    const review = await within(dialog).findByTestId("payment-review");
    expect(within(review).getByText("Lewat Tempo")).toBeInTheDocument();
    expect(within(review).queryByText("Dibayar Sebagian")).not.toBeInTheDocument();
    expect(review).toHaveTextContent("Sisa Rp 350.000");
  });

  it("review of a partial amount says 'Dibayar Sebagian' with the remainder; 'Ubah' returns to the form", async () => {
    const fetchMock = fixture({ invoice: { dueDate: daysAgo(-14) } });
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    const dialog = await openDialog();
    const amount = within(dialog).getByRole("textbox", { name: "Jumlah" });
    await user.clear(amount);
    await user.type(amount, "250000");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));

    const review = await within(dialog).findByTestId("payment-review");
    expect(within(review).getByText("Dibayar Sebagian")).toBeInTheDocument();
    expect(review).toHaveTextContent("Sisa Rp 350.000");

    fireEvent.click(within(dialog).getByRole("button", { name: "Ubah" }));
    expect(await within(dialog).findByRole("textbox", { name: "Jumlah" })).toHaveValue("250.000");
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("FIN-8: an overpayment is stopped on the Jumlah field with Rupiah amounts, no review, no POST", async () => {
    const fetchMock = fixture();
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    const dialog = await openDialog();
    const amount = within(dialog).getByRole("textbox", { name: "Jumlah" });
    await user.clear(amount);
    await user.type(amount, "700000");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));

    expect(
      await within(dialog).findByText("Jumlah pembayaran (Rp 700.000) melebihi sisa tagihan (Rp 600.000)"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByTestId("payment-review")).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("FIN-23: the manual method list offers Tunai, Transfer Bank and Lainnya only", async () => {
    fixture();
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    const dialog = await openDialog();
    await user.click(within(dialog).getByRole("combobox", { name: /Metode Pembayaran/ }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Tunai", "Transfer Bank", "Lainnya"]);
  });

  it("maps a validateBody field error from the server back onto Jumlah (returns to the form)", async () => {
    fixture({
      postStatus: 400,
      postBody: { error: "Validasi gagal", errors: [{ field: "amount", message: "Jumlah harus lebih dari 0" }] },
    });
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    const dialog = await openDialog();
    const amountInput = within(dialog).getByRole("textbox", { name: "Jumlah" });
    await user.clear(amountInput);
    await user.type(amountInput, "1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tinjau Pembayaran" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Catat Rp 1" }));

    expect(await within(dialog).findByText("Jumlah harus lebih dari 0")).toBeInTheDocument();
  });
});

describe("InvoiceDetailPage — payment history, reversal and cancel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("FIN-7: shows 'Dicatat oleh <nama>'; a REVERSED payment is struck through and labelled Dibatalkan with no reverse button", async () => {
    fixture({
      invoice: {
        payments: [
          cashPayment,
          { ...cashPayment, id: "pay-2", amount: 100000, status: "REVERSED", notes: "Dibatalkan 2026-09-11 oleh Bu Nur: salah input" },
        ],
      },
    });
    render(<InvoiceDetailPage />);

    const active = await screen.findByTestId("payment-row-pay-1");
    expect(active).toHaveTextContent("Dicatat oleh Bu Nur");
    expect(within(active).getByRole("button", { name: /Batalkan pembayaran/ })).toBeInTheDocument();

    const reversed = screen.getByTestId("payment-row-pay-2");
    expect(reversed).toHaveAttribute("data-status", "REVERSED");
    expect(within(reversed).getByText("Dibatalkan")).toBeInTheDocument();
    expect(within(reversed).getByText("Rp 100.000").className).toMatch(/line-through/);
    expect(within(reversed).queryByRole("button", { name: /Batalkan pembayaran/ })).not.toBeInTheDocument();
    expect(reversed).toHaveTextContent("salah input");
  });

  it("gateway payments have no reverse button", async () => {
    fixture({
      invoice: { payments: [{ ...cashPayment, id: "pay-gw", method: "XENDIT", xenditPaymentId: "gw-1", createdBy: null, createdByName: null }] },
    });
    render(<InvoiceDetailPage />);
    const row = await screen.findByTestId("payment-row-pay-gw");
    expect(within(row).queryByRole("button", { name: /Batalkan pembayaran/ })).not.toBeInTheDocument();
  });

  it("reversal requires a reason, then POSTs it to the reverse endpoint and refreshes", async () => {
    const fetchMock = fixture({ invoice: { payments: [cashPayment] } });
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Batalkan pembayaran/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Batalkan Pembayaran" }));
    expect(await within(dialog).findByText("Alasan wajib diisi (minimal 5 karakter)")).toBeInTheDocument();
    expect(posts(fetchMock, "/reverse")).toHaveLength(0);

    await user.type(within(dialog).getByRole("textbox", { name: /Alasan pembatalan/ }), "Salah input nominal");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Batalkan Pembayaran" }));

    await waitFor(() => expect(posts(fetchMock, "/reverse")).toHaveLength(1));
    const [url, init] = posts(fetchMock, "/reverse")[0];
    expect(url).toBe("/api/invoices/inv-1/payments/pay-1/reverse");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reason: "Salah input nominal" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pembayaran dibatalkan"));
  });

  it("FIN-9: an OVERDUE invoice with no payments can be cancelled from the menu", async () => {
    const fetchMock = fixture({ invoice: { status: "OVERDUE", totalPaid: 0, payments: [] } });
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Aksi lainnya" }));
    await user.click(await screen.findByRole("menuitem", { name: "Batalkan Tagihan" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Ya, Batalkan" }));

    await waitFor(() => expect(posts(fetchMock, "/void")).toHaveLength(1));
  });

  it("FIN-9: an invoice with payments explains that payments must be reversed first (no POST)", async () => {
    const fetchMock = fixture({ invoice: { status: "OVERDUE", payments: [cashPayment] } });
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Aksi lainnya" }));
    await user.click(await screen.findByRole("menuitem", { name: "Batalkan Tagihan" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Tagihan sudah menerima pembayaran");
    expect(dialog).toHaveTextContent("Rp 400.000");
    expect(dialog).toHaveTextContent("Batalkan pembayarannya lebih dulu");
    expect(posts(fetchMock, "/void")).toHaveLength(0);
  });

  it("FIN-11: a cancelled invoice shows no red 'Sisa' row", async () => {
    fixture({ invoice: { status: "CANCELLED", totalPaid: 0 } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    expect(screen.queryByText("Sisa")).not.toBeInTheDocument();
  });

  it("FIN-20: a PAID invoice drops the live payment link card and the gateway refresh button", async () => {
    fixture({ invoice: { status: "PAID", totalPaid: 1000000, xenditPaymentUrl: "https://pay.example/abc" } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    expect(screen.queryByText("Link Pembayaran")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invoice-refresh-payment-btn")).not.toBeInTheDocument();
  });

  it("FIN-20: an unpaid invoice with a link labels the refresh action 'Cek status pembayaran'", async () => {
    fixture({ invoice: { xenditPaymentUrl: "https://pay.example/abc" } });
    render(<InvoiceDetailPage />);
    expect(await screen.findByTestId("invoice-refresh-payment-btn")).toHaveTextContent("Cek status pembayaran");
  });
});

describe("InvoiceDetailPage — Unduh kuitansi (FINX-9)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("a PAID invoice offers 'Unduh kuitansi' in the header, opening the admin PDF route in a new tab", async () => {
    fixture({ invoice: { status: "PAID", totalPaid: 1000000 } });
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(<InvoiceDetailPage />);
    fireEvent.click(await screen.findByTestId("invoice-receipt-btn"));
    expect(open).toHaveBeenCalledWith("/api/invoices/inv-1/pdf", "_blank", "noopener");
  });

  it("a PARTIALLY_PAID invoice keeps the header uncrowded: the action lives in the overflow menu", async () => {
    fixture();
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);
    await screen.findByRole("button", { name: "Catat Pembayaran" });
    expect(screen.queryByTestId("invoice-receipt-btn")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));
    expect(await screen.findByTestId("invoice-receipt-btn")).toHaveTextContent("Unduh kuitansi");
  });

  it("an OVERDUE invoice with payments keeps the kuitansi, in the overflow menu", async () => {
    fixture({ invoice: { status: "OVERDUE", totalPaid: 400000 } });
    const user = userEvent.setup();
    render(<InvoiceDetailPage />);
    await screen.findByRole("button", { name: "Catat Pembayaran" });
    expect(screen.queryByTestId("invoice-receipt-btn")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));
    expect(await screen.findByTestId("invoice-receipt-btn")).toHaveTextContent("Unduh kuitansi");
  });

  it.each(["SENT", "OVERDUE", "DRAFT", "CANCELLED"])("a %s invoice has no kuitansi action", async (status) => {
    fixture({ invoice: { status, totalPaid: 0 } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    expect(screen.queryByTestId("invoice-receipt-btn")).not.toBeInTheDocument();
    expect(screen.queryByText("Unduh kuitansi")).not.toBeInTheDocument();
  });

  it("no kuitansi action without the payment capability", async () => {
    fixture({ invoice: { status: "PAID", totalPaid: 1000000, capabilities: { create: true, recordPayment: false, void: true } } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    expect(screen.queryByTestId("invoice-receipt-btn")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailPage — ?bayar=1 auto-opens Catat Pembayaran (R2-ADMIN-12)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("opens the dialog once with the balance prefilled and strips the flag from the URL", async () => {
    window.history.replaceState(null, "", "/admin/invoices/inv-1?bayar=1");
    fixture({ invoice: { status: "SENT", totalPaid: 0 } });
    render(<InvoiceDetailPage />);
    const dialog = await screen.findByRole("dialog", { name: "Catat Pembayaran" });
    expect(within(dialog).getByText("Sisa tagihan: Rp 1.000.000")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("does not open for a PAID invoice", async () => {
    window.history.replaceState(null, "", "/admin/invoices/inv-1?bayar=1");
    fixture({ invoice: { status: "PAID", totalPaid: 1000000 } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    expect(screen.queryByRole("dialog", { name: "Catat Pembayaran" })).not.toBeInTheDocument();
  });

  it("stays closed without the flag", async () => {
    fixture({ invoice: { status: "SENT", totalPaid: 0 } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    expect(screen.queryByRole("dialog", { name: "Catat Pembayaran" })).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailPage — WhatsApp reminder to the wali", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const withGuardian = (parent: { name: string; phone: string | null; email: string | null; whatsapp: string | null }) => ({
    student: { name: "Ahmad", nickname: null, guardians: [{ parent }] },
  });
  const ibu = { name: "Siti", phone: null, email: null, whatsapp: "0812-3456-7890" };

  it("an outstanding invoice offers Chat WhatsApp on the wali's number with the reminder written", async () => {
    fixture({ invoice: { status: "OVERDUE", ...withGuardian(ibu) } });
    render(<InvoiceDetailPage />);

    const wa = await screen.findByTestId("invoice-whatsapp-reminder");
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa.getAttribute("rel")).toContain("noopener");
    expect(wa).toHaveAccessibleName("Chat WhatsApp: ingatkan Siti soal tagihan ini");
    const href = wa.getAttribute("href")!;
    expect(href.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    const text = decodeURIComponent(href.split("?text=")[1]);
    expect(text).toContain("Bapak/Ibu Siti");
    expect(text).toContain("ananda Ahmad");
    expect(text).toContain("INV-2026-001");
    // totalDue 1.000.000 − totalPaid 400.000: what is LEFT, not the total.
    expect(text).toContain("600.000");
  });

  it("puts the DOKU payment link in the message when the invoice has one", async () => {
    fixture({ invoice: { status: "SENT", totalPaid: 0, xenditPaymentUrl: "https://doku.example/pay/abc", ...withGuardian(ibu) } });
    render(<InvoiceDetailPage />);
    const wa = await screen.findByTestId("invoice-whatsapp-reminder");
    expect(decodeURIComponent(wa.getAttribute("href")!.split("?text=")[1])).toContain("https://doku.example/pay/abc");
  });

  it("without a payment link the message points to the parent portal", async () => {
    fixture({ invoice: { status: "SENT", totalPaid: 0, xenditPaymentUrl: null, ...withGuardian(ibu) } });
    render(<InvoiceDetailPage />);
    const wa = await screen.findByTestId("invoice-whatsapp-reminder");
    expect(decodeURIComponent(wa.getAttribute("href")!.split("?text=")[1])).toContain("/parent/invoices");
  });

  it("falls back to the wali's phone when there is no WhatsApp number", async () => {
    fixture({ invoice: { status: "OVERDUE", ...withGuardian({ ...ibu, whatsapp: null, phone: "0813-9999-0000" }) } });
    render(<InvoiceDetailPage />);
    const wa = await screen.findByTestId("invoice-whatsapp-reminder");
    expect(wa.getAttribute("href")).toContain("https://wa.me/6281399990000?text=");
  });

  it("with no usable number it says so instead of offering a dead button", async () => {
    fixture({ invoice: { status: "OVERDUE", ...withGuardian({ ...ibu, whatsapp: null, phone: "123" }) } });
    render(<InvoiceDetailPage />);
    expect(await screen.findByText(/Belum ada nomor WhatsApp wali/)).toBeInTheDocument();
    expect(screen.queryByTestId("invoice-whatsapp-reminder")).not.toBeInTheDocument();
  });

  it.each(["PAID", "CANCELLED", "DRAFT"])("a %s invoice has nothing to chase", async (status) => {
    fixture({ invoice: { status, totalPaid: status === "PAID" ? 1000000 : 0, ...withGuardian(ibu) } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Kontak Wali");
    expect(screen.queryByTestId("invoice-whatsapp-reminder")).not.toBeInTheDocument();
    expect(screen.queryByText(/Belum ada nomor WhatsApp wali/)).not.toBeInTheDocument();
  });
});
