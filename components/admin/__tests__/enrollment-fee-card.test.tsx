/**
 * "Pembayaran pendaftaran" card on the admin enrollment detail page: what the
 * parent owes, the permissions that gate each money action, and the request
 * each dialog sends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EnrollmentFeeCard, type EnrollmentFeeCardProps } from "../enrollment-fee-card";
import type { AdminFeeView } from "@/lib/enrollment/fee-admin-view";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const fetchMock = vi.fn();

const unpaid: AdminFeeView = {
  status: "UNPAID",
  method: null,
  baseAmount: 300_000,
  discountPercent: 0,
  discountReason: null,
  amount: 300_000,
  paidAt: null,
  note: null,
  linkError: null,
  lastCheckedAt: null,
  linkActive: false,
};

const ALL = { recordPayment: true, adjust: true };
const FORM_URL = "https://talib.example/pendaftaran/tok";

function setup(over: Partial<EnrollmentFeeCardProps> = {}) {
  const onChange = vi.fn();
  render(
    <EnrollmentFeeCard
      applicationId="app-1"
      childName="Aisyah"
      fee={unpaid}
      followUp={{ formUrl: FORM_URL, canRemind: true }}
      problems={[]}
      canEdit
      permissions={ALL}
      onChange={onChange}
      {...over}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
const fail = (status: number, error: string) =>
  Promise.resolve({ ok: false, status, json: async () => ({ error }) } as Response);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("EnrollmentFeeCard — what it shows", () => {
  it("an unpaid fee shows the status, the amount owed and the normal fee", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Pembayaran pendaftaran" })).toBeInTheDocument();
    expect(screen.getByText("Belum bayar")).toBeInTheDocument();
    expect(screen.getByText("Harus dibayar")).toBeInTheDocument();
    expect(screen.getAllByText(/300\.000/).length).toBeGreaterThanOrEqual(2);
  });

  it("a discount shows its percent, the amount taken off and the reason", () => {
    setup({ fee: { ...unpaid, discountPercent: 20, discountReason: "Early bird", amount: 240_000 } });
    expect(screen.getByText("Diskon 20%")).toBeInTheDocument();
    expect(screen.getByText(/60\.000/)).toBeInTheDocument();
    expect(screen.getByText("Early bird")).toBeInTheDocument();
    expect(screen.getByText(/240\.000/)).toBeInTheDocument();
  });

  it("a paid fee says how and when, and offers no action", () => {
    setup({
      fee: { ...unpaid, status: "PAID", method: "DOKU", paidAt: "2026-10-10T03:05:00.000Z" },
      followUp: null,
    });
    expect(screen.getByText("Lunas")).toBeInTheDocument();
    expect(screen.getByText("Dibayar")).toBeInTheDocument();
    expect(screen.getByText("Virtual Account (DOKU)")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("a waived fee reads as a decision, not a debt", () => {
    // A real waive keeps the old amount on the row; it must not read as owed.
    setup({ fee: { ...unpaid, status: "WAIVED", method: "WAIVED", amount: 300_000, note: "Anak guru" }, followUp: null });
    expect(screen.queryByText("Harus dibayar")).not.toBeInTheDocument();
    expect(screen.queryByText("Dibayar")).not.toBeInTheDocument();
    expect(screen.getByText("Dibebaskan")).toBeInTheDocument();
    expect(screen.getByText("Dibebaskan oleh admin")).toBeInTheDocument();
    expect(screen.getByText("Anak guru")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the last link failure and the last gateway check for triage", () => {
    setup({ fee: { ...unpaid, linkError: "DOKU: timeout", lastCheckedAt: "2026-10-10T03:00:00.000Z" } });
    expect(screen.getByText(/Tautan pembayaran gagal dibuat: DOKU: timeout/)).toBeInTheDocument();
    expect(screen.getByText(/Terakhir diperiksa ke gateway/)).toBeInTheDocument();
  });

  it("flags payments that need a person, each in its own alert", () => {
    setup({
      problems: [
        { code: "AMOUNT_MISMATCH", message: "Ada pembayaran yang jumlahnya berbeda." },
        { code: "DUPLICATE_PAYMENT_AFTER_PAID", message: "Ada pembayaran kedua." },
      ],
    });
    expect(screen.getAllByText("Perlu dicek")).toHaveLength(2);
    expect(screen.getByText("Ada pembayaran yang jumlahnya berbeda.")).toBeInTheDocument();
    expect(screen.getByText("Ada pembayaran kedua.")).toBeInTheDocument();
  });
});

describe("EnrollmentFeeCard — WhatsApp and the link", () => {
  it("opens the reminder endpoint in a new tab: no wa.me URL and no token in the page", () => {
    setup();
    // The accessible name starts with the visible label ("Chat WhatsApp"), so voice control matches it.
    const wa = screen.getByRole("link", { name: "Chat WhatsApp: ingatkan orang tua Aisyah" });
    expect(wa).toHaveTextContent("Chat WhatsApp");
    expect(wa).toHaveAttribute("href", "/api/enrollments/app-1/fee/reminder");
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa.getAttribute("rel")).toContain("noopener");
    expect(document.body.innerHTML).not.toContain("wa.me");
  });

  it("with no number the button is disabled and the way out is explained", () => {
    setup({ followUp: { formUrl: FORM_URL, canRemind: false } });
    expect(screen.queryByRole("link", { name: /Chat WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat WhatsApp" })).toBeDisabled();
    expect(screen.getByText(/Belum ada nomor WhatsApp orang tua\. Salin tautan/)).toBeInTheDocument();
  });

  it("copies the parent's payment link", async () => {
    // userEvent installs its own clipboard on setup(), so spy after it.
    const { user } = setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Salin tautan pembayaran" }));
    expect(writeText).toHaveBeenCalledWith(FORM_URL);
    expect(toast.success).toHaveBeenCalledWith("Tautan pembayaran disalin");
  });

  it("tells staff when the browser refuses to copy", async () => {
    const { user } = setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Salin tautan pembayaran" }));
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("EnrollmentFeeCard — permissions", () => {
  it("a viewer (canEdit false) gets the facts and no actions", () => {
    setup({ canEdit: false, followUp: null, permissions: { recordPayment: false, adjust: false } });
    expect(screen.getByText("Belum bayar")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("an admissions editor without finance keys can chase but not touch the money", () => {
    setup({ permissions: { recordPayment: false, adjust: false } });
    expect(screen.getByRole("link", { name: /Chat WhatsApp/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salin tautan pembayaran" })).toBeInTheDocument();
    for (const name of ["Perbarui pembayaran", "Tandai sudah bayar", "Atur diskon", "Bebaskan biaya"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("payments.record alone: refresh and mark paid, but no discount or waive", () => {
    setup({ permissions: { recordPayment: true, adjust: false } });
    expect(screen.getByRole("button", { name: "Perbarui pembayaran" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tandai sudah bayar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Atur diskon" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bebaskan biaya" })).not.toBeInTheDocument();
  });

  it("fees.edit alone: discount and waive, but no refresh or mark paid", () => {
    setup({ permissions: { recordPayment: false, adjust: true } });
    expect(screen.getByRole("button", { name: "Atur diskon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bebaskan biaya" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Perbarui pembayaran" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tandai sudah bayar" })).not.toBeInTheDocument();
  });
});

describe("EnrollmentFeeCard — Perbarui pembayaran", () => {
  it("POSTs the refresh, reports a credited payment, and reloads", async () => {
    fetchMock.mockReturnValue(ok({ code: "UPDATED", message: "Pembayaran ditemukan di gateway — biaya pendaftaran ditandai LUNAS." }));
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button", { name: "Perbarui pembayaran" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/enrollments/app-1/fee/refresh", expect.objectContaining({ method: "POST" }));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("LUNAS"));
  });

  it("a payment that needs review is a warning, not a quiet info", async () => {
    fetchMock.mockReturnValue(ok({ code: "NEEDS_REVIEW", message: "Ada pembayaran yang jumlahnya berbeda." }));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Perbarui pembayaran" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Ada pembayaran yang jumlahnya berbeda."));
  });

  it("no change is information; a gateway error is an error", async () => {
    fetchMock.mockReturnValueOnce(ok({ code: "NO_CHANGE", message: "Belum ada pembayaran masuk." }));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Perbarui pembayaran" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Belum ada pembayaran masuk."));

    fetchMock.mockReturnValueOnce(ok({ code: "GATEWAY_ERROR", message: "Gagal memeriksa status ke gateway." }));
    await user.click(screen.getByRole("button", { name: "Perbarui pembayaran" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gagal memeriksa status ke gateway."));
  });

  it("a failed request says so", async () => {
    fetchMock.mockReturnValue(fail(429, "Terlalu banyak permintaan"));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Perbarui pembayaran" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Terlalu banyak permintaan"));
  });
});

describe("EnrollmentFeeCard — Atur diskon", () => {
  async function openDiscount(over: Partial<EnrollmentFeeCardProps> = {}) {
    const ctx = setup(over);
    await ctx.user.click(screen.getByRole("button", { name: "Atur diskon" }));
    const dialog = await screen.findByRole("dialog", { name: "Atur diskon" });
    return { ...ctx, dialog };
  }

  it("previews what the parent will owe as the percent is typed", async () => {
    const { user, dialog } = await openDiscount();
    const percent = within(dialog).getByLabelText(/Diskon \(%\)/);
    await user.clear(percent);
    await user.type(percent, "20");
    expect(within(dialog).getByText(/240\.000/)).toBeInTheDocument();
    await user.clear(percent);
    await user.type(percent, "100");
    expect(within(dialog).getByText("Bebas biaya")).toBeInTheDocument();
  });

  it("will not save a discount without a reason, and sends nothing", async () => {
    const { user, dialog } = await openDiscount();
    const percent = within(dialog).getByLabelText(/Diskon \(%\)/);
    await user.clear(percent);
    await user.type(percent, "20");
    await user.click(within(dialog).getByRole("button", { name: "Simpan diskon" }));

    expect(await within(dialog).findByText("Isi alasan diskon")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a percent that is not a whole number up to 100", async () => {
    const { user, dialog } = await openDiscount();
    const percent = within(dialog).getByLabelText(/Diskon \(%\)/);
    await user.clear(percent);
    await user.type(percent, "150");
    await user.click(within(dialog).getByRole("button", { name: "Simpan diskon" }));
    expect(await within(dialog).findByText("Diskon maksimal 100%")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PATCHes the discount with its reason, then closes and reloads", async () => {
    fetchMock.mockReturnValue(ok({ fee: {}, hadLiveLink: false }));
    const { user, dialog, onChange } = await openDiscount();
    const percent = within(dialog).getByLabelText(/Diskon \(%\)/);
    await user.clear(percent);
    await user.type(percent, "20");
    await user.type(within(dialog).getByLabelText(/Alasan diskon/), "Early bird");
    await user.click(within(dialog).getByRole("button", { name: "Simpan diskon" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/enrollments/app-1/fee");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ action: "DISCOUNT", discountPercent: 20, reason: "Early bird" });
    expect(toast.success).toHaveBeenCalledWith("Diskon disimpan");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Atur diskon" })).not.toBeInTheDocument());
  });

  it("warns that a live payment link will be cancelled", async () => {
    const { dialog } = await openDiscount({ fee: { ...unpaid, linkActive: true } });
    expect(within(dialog).getByText("Orang tua sudah punya tautan pembayaran")).toBeInTheDocument();
  });

  it("shows no such warning when the parent holds no live link", async () => {
    const { dialog } = await openDiscount();
    expect(within(dialog).queryByText("Orang tua sudah punya tautan pembayaran")).not.toBeInTheDocument();
  });

  it("a 409 (someone settled it first) tells why, closes the dialog and reloads what is true now", async () => {
    fetchMock.mockReturnValue(fail(409, "Biaya ini sudah selesai dan tidak bisa diubah lagi."));
    const { user, dialog, onChange } = await openDiscount();
    const percent = within(dialog).getByLabelText(/Diskon \(%\)/);
    await user.clear(percent);
    await user.type(percent, "0");
    await user.click(within(dialog).getByRole("button", { name: "Simpan diskon" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalled();
    // Its submit would only 409 again.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Atur diskon" })).not.toBeInTheDocument());
  });
});

describe("EnrollmentFeeCard — Tandai sudah bayar", () => {
  async function openPaid() {
    const ctx = setup();
    await ctx.user.click(screen.getByRole("button", { name: "Tandai sudah bayar" }));
    const dialog = await screen.findByRole("dialog", { name: "Tandai sudah bayar" });
    return { ...ctx, dialog };
  }

  it("names the amount being recorded", async () => {
    const { dialog } = await openPaid();
    expect(within(dialog).getByText(/Catat bahwa orang tua sudah membayar Rp\s?300\.000/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Catat Rp\s?300\.000/ })).toBeInTheDocument();
  });

  it("makes staff choose the method: nothing is sent until they do", async () => {
    const { user, dialog } = await openPaid();
    await user.click(within(dialog).getByRole("button", { name: /Catat Rp/ }));
    // The same words are the select's placeholder, so look for the field error.
    await waitFor(() => expect(within(dialog).getAllByText("Pilih cara pembayaran").length).toBeGreaterThan(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PATCHes MARK_PAID with the chosen method and note", async () => {
    fetchMock.mockReturnValue(ok({ fee: {}, hadLiveLink: false }));
    const { user, dialog, onChange } = await openPaid();
    await user.click(within(dialog).getByRole("combobox", { name: /Cara pembayaran/ }));
    await user.click(await screen.findByRole("option", { name: "Transfer bank" }));
    await user.type(within(dialog).getByLabelText(/Catatan/), "Bukti 123");
    await user.click(within(dialog).getByRole("button", { name: /Catat Rp/ }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: "MARK_PAID",
      method: "BANK_TRANSFER",
      note: "Bukti 123",
    });
    expect(toast.success).toHaveBeenCalledWith("Pembayaran dicatat");
  });
});

describe("EnrollmentFeeCard — Bebaskan biaya", () => {
  it("asks first, names the child, and only then sends WAIVE", async () => {
    fetchMock.mockReturnValue(ok({ fee: {}, hadLiveLink: false }));
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button", { name: "Bebaskan biaya" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Bebaskan biaya pendaftaran Aisyah?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Bebaskan biaya" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "WAIVE" });
    expect(toast.success).toHaveBeenCalledWith("Biaya pendaftaran dibebaskan");
  });

  it("cancelling sends nothing", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Bebaskan biaya" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Batal" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failure keeps the dialog open and says why", async () => {
    fetchMock.mockReturnValue(fail(409, "Biaya ini sudah selesai dan tidak bisa diubah lagi."));
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button", { name: "Bebaskan biaya" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Bebaskan biaya" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Biaya ini sudah selesai dan tidak bisa diubah lagi."));
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
