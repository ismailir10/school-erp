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
  paymentLinkExpiresAt: null as string | null,
  paymentLinkError: null,
  lastRemindedAt: null as string | null,
  lastRemindedByName: null as string | null,
  reminderTemplate: null as string | null,
  remindCount: 0,
  student: {
    name: "Ahmad",
    nickname: null,
    guardians: [] as Array<{ parent: { name: string; phone: string | null; email: string | null; whatsapp: string | null } }>,
  },
  lines: [],
  payments: [] as Array<Record<string, unknown>>,
  paymentProblems: [] as Array<{ code: string; message: string; createdAt: string }>,
};

const cashPayment = {
  id: "pay-1", amount: 400000, method: "CASH", reference: null, notes: null,
  paidAt: "2026-09-10T03:00:00.000Z", status: "RECORDED", createdBy: "u-9", createdByName: "Bu Nur",
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body };
}

function fixture(
  overrides: {
    postStatus?: number; postBody?: unknown; invoice?: Partial<typeof baseInvoice>;
    replaceStatus?: number; replaceBody?: unknown;
    reminderStatus?: number; reminderBody?: unknown;
  } = {},
) {
  const {
    reminderStatus = 200,
    reminderBody = { lastRemindedAt: new Date().toISOString(), remindCount: 1, waUrl: "https://wa.me/6281234567890" },
  } = overrides;
  const { postStatus = 201, postBody = { id: "pay-1" }, replaceStatus = 200, replaceBody = { outcome: "REPLACED", url: "https://pay.example/new", created: true } } = overrides;
  const invoice = { ...baseInvoice, ...overrides.invoice };
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    if (input === "/api/invoices/inv-1/payments" && init?.method === "POST") {
      return Promise.resolve(jsonResponse(postBody, postStatus < 400, postStatus));
    }
    if (input.endsWith("/reverse") && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (input === "/api/invoices/inv-1/replace-payment-link" && init?.method === "POST") {
      return Promise.resolve(jsonResponse(replaceBody, replaceStatus < 400, replaceStatus));
    }
    if (input === "/api/invoices/inv-1/reminder" && init?.method === "POST") {
      return Promise.resolve(jsonResponse(reminderBody, reminderStatus < 400, reminderStatus));
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

  it("writes the reminder in the school's own template when it has one", async () => {
    fixture({ invoice: { status: "OVERDUE", reminderTemplate: "Pengingat {nomor} untuk {siswa}: {tautan}", ...withGuardian(ibu) } });
    render(<InvoiceDetailPage />);

    const wa = await screen.findByTestId("invoice-whatsapp-reminder");
    const text = decodeURIComponent(wa.getAttribute("href")!.split("?text=")[1]);
    expect(text).toMatch(/^Pengingat INV-2026-001 untuk Ahmad: /);
  });

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

  it("tapping Chat WhatsApp stamps the reminder (keepalive POST, no preventDefault) and the card says it was just reminded", async () => {
    const fetchMock = fixture({ invoice: { status: "OVERDUE", ...withGuardian(ibu) } });
    render(<InvoiceDetailPage />);

    const wa = await screen.findByTestId("invoice-whatsapp-reminder");
    expect(screen.getByTestId("invoice-last-reminded")).toHaveTextContent("Belum diingatkan");

    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.click(wa)).toBe(true);

    await waitFor(() =>
      expect(screen.getByTestId("invoice-last-reminded")).toHaveTextContent("Terakhir diingatkan baru saja · oleh Anda"),
    );
    const call = posts(fetchMock, "/reminder");
    expect(call).toHaveLength(1);
    expect(call[0]![1]).toMatchObject({ method: "POST", keepalive: true });
  });

  it("without payments.record the link still opens but a tap records nothing", async () => {
    const fetchMock = fixture({
      invoice: {
        status: "OVERDUE",
        capabilities: { create: true, recordPayment: false, void: true },
        ...withGuardian(ibu),
      },
    });
    render(<InvoiceDetailPage />);

    const wa = await screen.findByTestId("invoice-whatsapp-reminder");
    expect(wa).toHaveAttribute("href", expect.stringContaining("https://wa.me/"));
    expect(fireEvent.click(wa)).toBe(true);

    await Promise.resolve();
    expect(posts(fetchMock, "/reminder")).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a second tap while the stamp is in flight opens the link again but does not POST twice", async () => {
    const fetchMock = fixture({ invoice: { status: "OVERDUE", ...withGuardian(ibu) } });
    render(<InvoiceDetailPage />);

    const wa = await screen.findByTestId("invoice-whatsapp-reminder");
    expect(fireEvent.click(wa)).toBe(true);
    expect(fireEvent.click(wa)).toBe(true);

    await waitFor(() =>
      expect(screen.getByTestId("invoice-last-reminded")).toHaveTextContent("Terakhir diingatkan baru saja"),
    );
    expect(posts(fetchMock, "/reminder")).toHaveLength(1);
  });

  it("a refused stamp (429) toasts the server's words and leaves the line as it was", async () => {
    fixture({
      invoice: { status: "OVERDUE", ...withGuardian(ibu) },
      reminderStatus: 429,
      reminderBody: { error: "Terlalu banyak permintaan" },
    });
    render(<InvoiceDetailPage />);

    fireEvent.click(await screen.findByTestId("invoice-whatsapp-reminder"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Terlalu banyak permintaan"));
    expect(screen.getByTestId("invoice-last-reminded")).toHaveTextContent("Belum diingatkan");
  });

  it("shows when and by whom the invoice was last reminded", async () => {
    fixture({
      invoice: {
        status: "OVERDUE",
        lastRemindedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
        lastRemindedByName: "Bu Nur",
        ...withGuardian(ibu),
      },
    });
    render(<InvoiceDetailPage />);
    expect(await screen.findByTestId("invoice-last-reminded")).toHaveTextContent("Terakhir diingatkan 3 hari lalu · oleh Bu Nur");
  });

  it.each(["PAID", "CANCELLED", "DRAFT"])("a %s invoice has nothing to chase", async (status) => {
    fixture({ invoice: { status, totalPaid: status === "PAID" ? 1000000 : 0, ...withGuardian(ibu) } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Kontak Wali");
    expect(screen.queryByTestId("invoice-whatsapp-reminder")).not.toBeInTheDocument();
    expect(screen.queryByText(/Belum ada nomor WhatsApp wali/)).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailPage — Buat link baru (replace the payment link)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const withLink = { xenditPaymentUrl: "https://pay.example/old" };
  const replaceButton = () => screen.findByTestId("invoice-replace-link-btn");
  async function openMenu() {
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Catat Pembayaran" });
    await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));
    return user;
  }

  it("an unpaid invoice that owes money and holds a link offers it in the overflow menu", async () => {
    fixture({ invoice: withLink });
    render(<InvoiceDetailPage />);
    await openMenu();
    expect(await replaceButton()).toHaveTextContent("Buat link baru");
  });

  it.each([
    ["no link", { xenditPaymentUrl: null }],
    ["no create capability", { ...withLink, capabilities: { create: false, recordPayment: true, void: true } }],
    ["a PAID invoice", { ...withLink, status: "PAID", totalPaid: 1000000 }],
    ["a CANCELLED invoice", { ...withLink, status: "CANCELLED" }],
    ["nothing left to pay", { ...withLink, totalPaid: 1000000 }],
  ])("is not offered with %s", async (_name, invoice) => {
    fixture({ invoice });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    // The overflow menu may not exist at all; open it when it does.
    const more = screen.queryByRole("button", { name: "Aksi lainnya" });
    if (more) await userEvent.setup().click(more);
    expect(screen.queryByTestId("invoice-replace-link-btn")).not.toBeInTheDocument();
  });

  it("asks before doing anything: the confirmation explains the old link, Batal sends nothing", async () => {
    const fetchMock = fixture({ invoice: withLink });
    render(<InvoiceDetailPage />);
    const user = await openMenu();
    await user.click(await replaceButton());

    const dialog = await screen.findByRole("alertdialog", { name: "Ganti link pembayaran?" });
    expect(within(dialog).getByText("Link lama akan diganti. Jika orang tua sudah membayar lewat link lama, pembayarannya tetap tercatat.")).toBeInTheDocument();
    expect(posts(fetchMock, "/replace-payment-link")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(posts(fetchMock, "/replace-payment-link")).toHaveLength(0);
  });

  it("confirming posts once, toasts that the link is ready and reloads the invoice", async () => {
    const fetchMock = fixture({ invoice: withLink });
    render(<InvoiceDetailPage />);
    const user = await openMenu();
    await user.click(await replaceButton());
    const dialog = await screen.findByRole("alertdialog", { name: "Ganti link pembayaran?" });
    const loadsBefore = fetchMock.mock.calls.filter(([url]) => url === "/api/invoices/inv-1").length;

    await user.click(within(dialog).getByRole("button", { name: "Buat link baru" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link baru siap. Kirim ke wali lewat WhatsApp."));
    expect(posts(fetchMock, "/replace-payment-link")).toHaveLength(1);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/invoices/inv-1").length).toBe(loadsBefore + 1),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("when the gateway shows it was already paid, the server's message is toasted and the invoice reloads", async () => {
    const message = "Pembayaran sudah masuk dan dicatat. Link baru tidak dibuat.";
    const fetchMock = fixture({ invoice: withLink, replaceBody: { outcome: "PAID", message } });
    render(<InvoiceDetailPage />);
    const user = await openMenu();
    await user.click(await replaceButton());
    const dialog = await screen.findByRole("alertdialog", { name: "Ganti link pembayaran?" });
    const loadsBefore = fetchMock.mock.calls.filter(([url]) => url === "/api/invoices/inv-1").length;

    await user.click(within(dialog).getByRole("button", { name: "Buat link baru" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(message));
    expect(toast.success).not.toHaveBeenCalledWith("Link baru siap. Kirim ke wali lewat WhatsApp.");
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/invoices/inv-1").length).toBe(loadsBefore + 1),
    );
  });

  it("an API error is toasted in the server's words and the invoice still reloads", async () => {
    const error = "Link belum bisa diperiksa. Coba lagi sebentar lagi.";
    const fetchMock = fixture({ invoice: withLink, replaceStatus: 502, replaceBody: { error } });
    render(<InvoiceDetailPage />);
    const user = await openMenu();
    await user.click(await replaceButton());
    const dialog = await screen.findByRole("alertdialog", { name: "Ganti link pembayaran?" });
    const loadsBefore = fetchMock.mock.calls.filter(([url]) => url === "/api/invoices/inv-1").length;

    await user.click(within(dialog).getByRole("button", { name: "Buat link baru" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(error));
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/invoices/inv-1").length).toBe(loadsBefore + 1),
    );
  });

  it("a network failure toasts a calm message instead of the raw error", async () => {
    const fetchMock = fixture({ invoice: withLink });
    render(<InvoiceDetailPage />);
    const user = await openMenu();
    await user.click(await replaceButton());
    const dialog = await screen.findByRole("alertdialog", { name: "Ganti link pembayaran?" });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: string, init?: RequestInit) =>
      input.endsWith("/replace-payment-link") ? Promise.reject(new Error("socket hang up")) : original(input, init),
    );
    const loadsBefore = fetchMock.mock.calls.filter(([url]) => url === "/api/invoices/inv-1").length;

    await user.click(within(dialog).getByRole("button", { name: "Buat link baru" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Link baru belum berhasil dibuat. Periksa koneksi lalu coba lagi."));
    // The server may already have cleared the link before the connection dropped.
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/invoices/inv-1").length).toBe(loadsBefore + 1),
    );
  });
});

describe("InvoiceDetailPage — payment link expiry line (cycle payment-link-expiry-display)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const link = "https://pay.example/abc";
  const FUTURE = "2099-03-05T09:30:00.000Z"; // 16.30 WIB
  const PAST = "2020-01-01T03:00:00.000Z";

  it("shows 'Berlaku sampai <tanggal · jam> WIB' in Asia/Jakarta for a live link", async () => {
    fixture({ invoice: { status: "SENT", totalPaid: 0, xenditPaymentUrl: link, paymentLinkExpiresAt: FUTURE } });
    render(<InvoiceDetailPage />);
    expect(await screen.findByText("Berlaku sampai 5 Mar 2099 · 16.30 WIB")).toBeInTheDocument();
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salin Link" })).toBeInTheDocument();
  });

  it.each(["SENT", "PARTIALLY_PAID", "OVERDUE"])("shows red 'Kedaluwarsa' for an unpaid %s invoice past its date", async (status) => {
    fixture({ invoice: { status, xenditPaymentUrl: link, paymentLinkExpiresAt: PAST } });
    render(<InvoiceDetailPage />);
    const badge = await screen.findByText("Kedaluwarsa");
    expect(badge).toHaveClass("text-status-absent-text");
    expect(screen.queryByText(/Berlaku sampai/)).not.toBeInTheDocument();
  });

  it("shows no expiry line and no 'Kedaluwarsa' for a PAID invoice with a past stored date", async () => {
    fixture({ invoice: { status: "PAID", totalPaid: 1000000, xenditPaymentUrl: link, paymentLinkExpiresAt: PAST } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
    expect(screen.queryByText(/Berlaku sampai/)).not.toBeInTheDocument();
  });

  it("shows a muted 'Tanggal berlaku belum tercatat' for a link with no stored date", async () => {
    fixture({ invoice: { status: "SENT", xenditPaymentUrl: link, paymentLinkExpiresAt: null } });
    render(<InvoiceDetailPage />);
    const note = await screen.findByText("Tanggal berlaku belum tercatat");
    expect(note).toHaveClass("text-muted-foreground");
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
  });

  it("shows no date line at all when there is no link, even with a stale stored date", async () => {
    fixture({ invoice: { status: "SENT", xenditPaymentUrl: null, paymentLinkExpiresAt: FUTURE } });
    render(<InvoiceDetailPage />);
    await screen.findByText("Total Tagihan");
    expect(screen.queryByText(/Berlaku sampai/)).not.toBeInTheDocument();
    expect(screen.queryByText("Tanggal berlaku belum tercatat")).not.toBeInTheDocument();
    expect(screen.queryByText("Kedaluwarsa")).not.toBeInTheDocument();
  });
});

describe("InvoiceDetailPage — Perlu dicek alert for unrecorded gateway payments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows the red alert above the activity when the invoice has flagged payments", async () => {
    fixture({
      invoice: {
        status: "PAID",
        totalPaid: 1000000,
        paymentProblems: [
          {
            code: "DUPLICATE_PAYMENT_AFTER_PAID",
            message: "Ada pembayaran kedua di Xendit sebesar Rp 500.000 untuk tagihan yang sudah lunas.",
            createdAt: "2026-10-21T03:00:00.000Z",
          },
        ],
      },
    });
    render(<InvoiceDetailPage />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Perlu dicek")).toBeInTheDocument();
    expect(within(alert).getByText(/Ada pembayaran kedua di Xendit/)).toBeInTheDocument();
    expect(alert.textContent).not.toContain("DUPLICATE_PAYMENT_AFTER_PAID");
  });

  it("shows no alert when nothing is flagged", async () => {
    fixture({ invoice: { status: "PAID", totalPaid: 1000000 } });
    render(<InvoiceDetailPage />);
    await screen.findByText("INV-2026-001");
    expect(screen.queryByText("Perlu dicek")).not.toBeInTheDocument();
  });
});
