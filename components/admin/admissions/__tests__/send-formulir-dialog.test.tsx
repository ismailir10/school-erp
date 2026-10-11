/**
 * "Formulir siap dikirim" card: what the status line says per case, that each
 * way of getting the link to the parent (WhatsApp, copy, fill together) points at
 * the right place, and the pay-first part: the fee line, and settling an unpaid
 * fee (cash / waive) in place for staff who may.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SendFormulirDialog, type SendFormulirDialogProps, type SendFormulirResult } from "../send-formulir-dialog";
import type { AdminFeeView } from "@/lib/enrollment/fee-admin-view";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FORM_URL = "https://talib.example/pendaftaran/tok-123";

const fee = (over: Partial<AdminFeeView> = {}): AdminFeeView => ({
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
  ...over,
});

const result = (over: Partial<SendFormulirResult> = {}): SendFormulirResult => ({
  id: "app-1",
  formUrl: FORM_URL,
  emailed: false,
  hasEmail: false,
  created: true,
  fee: null,
  ...over,
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  // Nothing to settle unless a test says so: the detail read fails quietly.
  fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function setup(over: Partial<SendFormulirDialogProps> = {}) {
  const onClose = vi.fn();
  render(
    <SendFormulirDialog
      result={result()}
      email={null}
      parentName="Siti"
      childName="Aisyah"
      phone="0812-3456-7890"
      onClose={onClose}
      {...over}
    />,
  );
  return { onClose };
}

describe("SendFormulirDialog", () => {
  it("renders nothing while there is no result", () => {
    setup({ result: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the link in a read-only field", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Formulir siap dikirim" })).toBeTruthy();
    const field = screen.getByLabelText("Tautan formulir") as HTMLInputElement;
    expect(field.value).toBe(FORM_URL);
    expect(field.readOnly).toBe(true);
  });

  describe("status line", () => {
    it("names the address when the email went out", () => {
      setup({ result: result({ emailed: true, hasEmail: true }), email: "siti@test.com" });
      expect(screen.getByText("Email terkirim ke siti@test.com")).toBeTruthy();
    });

    it("says the email failed and the link must be shared", () => {
      setup({ result: result({ hasEmail: true }), email: "siti@test.com" });
      expect(screen.getByText("Email gagal terkirim — bagikan tautan")).toBeTruthy();
    });

    it("points to WhatsApp when there is no email but a phone", () => {
      setup();
      expect(screen.getByText("Tidak ada email — bagikan lewat WhatsApp")).toBeTruthy();
    });

    it("points to copy / fill together when there is neither email nor phone", () => {
      setup({ phone: null });
      expect(screen.getByText("Tidak ada email — salin tautan atau isi bersama orang tua")).toBeTruthy();
    });
  });

  describe("Kirim lewat WhatsApp", () => {
    it("opens wa.me on the parent's normalised number in a new tab, with the link in the message", () => {
      setup();
      const link = screen.getByRole("link", { name: "Kirim lewat WhatsApp (tab baru)" }) as HTMLAnchorElement;
      expect(link.href.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
      expect(link.href).toContain(encodeURIComponent(FORM_URL));
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noopener");
    });

    it("is unavailable, with a hint, when there is no usable number", () => {
      setup({ phone: null });
      expect(screen.queryByRole("link", { name: /Kirim lewat WhatsApp/ })).toBeNull();
      const button = screen.getByRole("button", { name: "Kirim lewat WhatsApp" });
      // aria-disabled keeps it focusable, so the hint is reachable by keyboard.
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      button.focus();
      expect(button).toHaveFocus();
      const hint = screen.getByText("Belum ada nomor HP atau WhatsApp orang tua yang bisa dipakai.");
      expect(button.getAttribute("aria-describedby")).toBe(hint.id);
    });

    it("treats a number WhatsApp cannot open as no number", () => {
      setup({ phone: "123" });
      expect(screen.getByRole("button", { name: "Kirim lewat WhatsApp" })).toHaveAttribute("aria-disabled", "true");
      expect(screen.queryByRole("link", { name: /Kirim lewat WhatsApp/ })).toBeNull();
    });
  });

  describe("Salin tautan", () => {
    it("copies the link and confirms with Tersalin, announced politely", async () => {
      const user = userEvent.setup();
      // userEvent installs its own clipboard on setup(), so spy after it.
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      setup();
      await user.click(screen.getByRole("button", { name: "Salin tautan" }));
      expect(writeText).toHaveBeenCalledWith(FORM_URL);
      expect(await screen.findByRole("button", { name: "Tersalin" })).toBeTruthy();
      expect(screen.getByText("Tautan formulir disalin.").closest("[role=status]")).not.toBeNull();
    });

    it("tells staff to copy by hand when the clipboard is blocked", async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
      setup();
      await user.click(screen.getByRole("button", { name: "Salin tautan" }));
      expect(await screen.findByText(/tidak bisa disalin otomatis/i)).toBeTruthy();
      // The label never lies: nothing was copied.
      expect(screen.queryByRole("button", { name: "Tersalin" })).toBeNull();
    });
  });

  it("Isi bersama orang tua opens the real parent form in a new tab, with the on-screen-signing hint", () => {
    setup();
    const link = screen.getByRole("link", { name: "Isi bersama orang tua (tab baru)" }) as HTMLAnchorElement;
    expect(link.href).toBe(FORM_URL);
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    const hint = screen.getByText(
      "Buka di perangkat ini supaya orang tua bisa mengisi dan tanda tangan di layar.",
    );
    expect(link.getAttribute("aria-describedby")).toBe(hint.id);
  });

  describe("Biaya formulir", () => {
    const FEE_LINE = () => screen.getByTestId("formulir-fee");

    it.each([
      ["UNPAID", "Belum bayar"],
      ["PAID", "Lunas"],
      ["WAIVED", "Dibebaskan"],
    ] as const)("a %s fee shows the amount with a '%s' badge", (status, label) => {
      setup({ result: result({ fee: fee({ status }) }) });
      expect(FEE_LINE().textContent).toContain("Biaya formulir:");
      expect(FEE_LINE().textContent).toContain("Rp 300.000");
      expect(within(FEE_LINE()).getByText(label)).toBeTruthy();
    });

    it("a first send with no fee row is a free program: Tanpa biaya", () => {
      setup({ result: result({ created: true, fee: null }) });
      expect(FEE_LINE().textContent).toContain("Biaya formulir: Tanpa biaya");
      expect(FEE_LINE().textContent).not.toContain("alur lama");
    });

    it("a resend with no fee row is a formulir from before pay-first, said in one short line", () => {
      setup({ result: result({ created: false, fee: null }) });
      expect(FEE_LINE().textContent).toContain(
        "Tautan baru dikirim. Formulir ini memakai alur lama (isi dulu, bayar di akhir).",
      );
      expect(FEE_LINE().textContent).not.toContain("Tanpa biaya");
    });

    it("a resend with a fee shows its status and no legacy note", () => {
      setup({ result: result({ created: false, fee: fee() }) });
      expect(within(FEE_LINE()).getByText("Belum bayar")).toBeTruthy();
      expect(FEE_LINE().textContent).not.toContain("alur lama");
    });

    it.each([
      ["repriced", "Biaya dihitung ulang sesuai pilihan baru."],
      ["unchanged_paid", "Biaya sudah lunas, jadi tidak diubah."],
      ["unchanged_waived", "Biaya sudah dibebaskan, jadi tidak diubah."],
    ])("a resend that %s adds one status line", (feeNote, text) => {
      setup({ result: result({ created: false, fee: fee({ status: feeNote === "repriced" ? "UNPAID" : "PAID" }), feeNote }) });
      expect(within(FEE_LINE()).getByText(text)).toBeTruthy();
    });

    it("keeps the normal fill-together hint for a paid fee", () => {
      setup({ result: result({ fee: fee({ status: "PAID" }) }) });
      expect(screen.getByText("Buka di perangkat ini supaya orang tua bisa mengisi dan tanda tangan di layar.")).toBeTruthy();
      expect(screen.queryByText(/Tandai lunas dulu/)).toBeNull();
    });
  });

  describe("settling an unpaid fee", () => {
    const BOTH = { recordPayment: true, adjust: true };
    const detail = (feePermissions: { recordPayment: boolean; adjust: boolean }, extra: Record<string, unknown> = {}) =>
      ({ ok: true, status: 200, json: async () => ({ feePermissions, ...extra }) }) as Response;

    function serve(perms: { recordPayment: boolean; adjust: boolean }, patch?: () => Response) {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return patch ? patch() : ({ ok: true, status: 200, json: async () => ({}) } as Response);
        if (url === "/api/enrollments/app-1") return detail(perms);
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      });
    }
    const patchCall = () => fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    const patchBody = () => JSON.parse((patchCall()![1] as RequestInit).body as string);
    const confirmRow = () => screen.getByRole("alert");

    it("asks the enrollment detail for the permissions, only while the fee is unpaid", async () => {
      serve(BOTH);
      setup({ result: result({ fee: fee() }) });
      await screen.findByRole("button", { name: "Tandai lunas (tunai)" });
      expect(fetchMock).toHaveBeenCalledWith("/api/enrollments/app-1");
    });

    it("does not ask, and shows no settle buttons, for a paid fee or no fee", async () => {
      serve(BOTH);
      setup({ result: result({ fee: fee({ status: "PAID" }) }) });
      expect(screen.queryByRole("button", { name: /Tandai lunas/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Bebaskan biaya" })).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("offers cash and transfer, and a quieter Bebaskan biaya, to staff with both permissions", async () => {
      serve(BOTH);
      setup({ result: result({ fee: fee() }) });
      expect(await screen.findByRole("button", { name: "Tandai lunas (tunai)" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Tandai lunas (transfer)" })).toBeTruthy();
      // Not a peer of "lunas": it is the money given up.
      const waive = screen.getByRole("button", { name: "Bebaskan biaya" });
      expect(waive.className).toContain("text-destructive");
      expect(waive.className).toContain("mt-2");
    });

    it("shows only what the staff member may do", async () => {
      serve({ recordPayment: true, adjust: false });
      setup({ result: result({ fee: fee() }) });
      await screen.findByRole("button", { name: "Tandai lunas (tunai)" });
      expect(screen.queryByRole("button", { name: "Bebaskan biaya" })).toBeNull();
    });

    it("shows nothing to staff without either permission, and the hint no longer says to settle", async () => {
      serve({ recordPayment: false, adjust: false });
      setup({ result: result({ fee: fee() }) });
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: /Tandai lunas/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Bebaskan biaya" })).toBeNull();
      expect(screen.queryByText(/Tandai lunas dulu/)).toBeNull();
      expect(screen.getByText("Formulir terbuka setelah orang tua membayar lewat tautan.")).toBeTruthy();
    });

    it("keeps the dead-end hint away when the permissions could not be read", async () => {
      setup({ result: result({ fee: fee() }) });
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByText(/Tandai lunas dulu/)).toBeNull();
      expect(screen.getByText("Formulir terbuka setelah orang tua membayar lewat tautan.")).toBeTruthy();
    });

    it("tells staff who can settle to do that first, on the Isi bersama orang tua hint", async () => {
      serve(BOTH);
      setup({ result: result({ fee: fee() }) });
      const hint = await screen.findByText(
        "Tandai lunas dulu supaya formulir terbuka, atau minta orang tua membayar lewat tautan.",
      );
      expect(screen.getByRole("link", { name: "Isi bersama orang tua (tab baru)" }).getAttribute("aria-describedby")).toBe(hint.id);
    });

    it.each([
      ["Tandai lunas (tunai)", "CASH", /Rp 300\.000 sudah dibayar tunai/],
      ["Tandai lunas (transfer)", "BANK_TRANSFER", /Rp 300\.000 sudah dibayar lewat transfer bank/],
    ] as const)("%s asks inline first, then records %s and updates the card in place", async (button, method, consequence) => {
      const user = userEvent.setup();
      serve(BOTH, () =>
        ({ ok: true, status: 200, json: async () => ({ fee: fee({ status: "PAID", method }) }) }) as Response,
      );
      setup({ result: result({ fee: fee() }) });
      await user.click(await screen.findByRole("button", { name: button }));

      // No dialog is stacked: the confirm is a row inside the card, focus on the safe choice.
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(confirmRow()).toHaveTextContent(consequence);
      expect(confirmRow()).toHaveTextContent("tidak bisa dibatalkan");
      expect(screen.getByRole("button", { name: "Batal" })).toHaveFocus();
      expect(patchCall()).toBeUndefined();
      // The button group gives way to the confirm.
      expect(screen.queryByRole("button", { name: "Bebaskan biaya" })).toBeNull();

      await user.click(within(confirmRow()).getByRole("button", { name: "Tandai lunas" }));
      await waitFor(() => expect(within(screen.getByTestId("formulir-fee")).getByText("Lunas")).toBeTruthy());
      const [url] = patchCall()!;
      expect(url).toBe("/api/enrollments/app-1/fee");
      expect(patchBody()).toEqual({ action: "MARK_PAID", method });
      expect(screen.getByTestId("formulir-fee").textContent).toContain("Sudah lunas.");
      expect(toast.success).toHaveBeenCalledWith("Pembayaran dicatat");
      // Settled: nothing left to offer, the normal hint is back, and focus moved to the status.
      expect(screen.queryByRole("button", { name: /Tandai lunas/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Bebaskan biaya" })).toBeNull();
      expect(screen.getByText("Buka di perangkat ini supaya orang tua bisa mengisi dan tanda tangan di layar.")).toBeTruthy();
      expect(screen.getByTestId("formulir-fee")).toHaveFocus();
      expect(screen.getByRole("link", { name: "Isi bersama orang tua (tab baru)" })).toBeTruthy();
    });

    it("Batal sends nothing and puts focus back on the button that was pressed", async () => {
      const user = userEvent.setup();
      serve(BOTH);
      setup({ result: result({ fee: fee() }) });
      await user.click(await screen.findByRole("button", { name: "Tandai lunas (transfer)" }));
      await user.click(screen.getByRole("button", { name: "Batal" }));
      expect(patchCall()).toBeUndefined();
      await waitFor(() => expect(screen.getByRole("button", { name: "Tandai lunas (transfer)" })).toHaveFocus());
    });

    it("waives the fee with a bare WAIVE after an inline confirm, and shows Dibebaskan", async () => {
      const user = userEvent.setup();
      serve(BOTH, () =>
        ({ ok: true, status: 200, json: async () => ({ fee: fee({ status: "WAIVED" }) }) }) as Response,
      );
      setup({ result: result({ fee: fee() }) });
      await user.click(await screen.findByRole("button", { name: "Bebaskan biaya" }));
      expect(confirmRow()).toHaveTextContent("Tautan pembayaran yang sudah mereka pegang tidak berlaku");
      await user.click(within(confirmRow()).getByRole("button", { name: "Bebaskan biaya" }));

      await waitFor(() => expect(within(screen.getByTestId("formulir-fee")).getByText("Dibebaskan")).toBeTruthy());
      expect(patchBody()).toEqual({ action: "WAIVE" });
      expect(toast.success).toHaveBeenCalledWith("Biaya pendaftaran dibebaskan");
    });

    it("toasts the server's text and keeps the confirm open for a retry when the fee route refuses", async () => {
      const user = userEvent.setup();
      serve(BOTH, () =>
        ({ ok: false, status: 403, json: async () => ({ error: "Anda tidak memiliki izin untuk tindakan ini." }) }) as Response,
      );
      setup({ result: result({ fee: fee() }) });
      await user.click(await screen.findByRole("button", { name: "Tandai lunas (tunai)" }));
      await user.click(within(confirmRow()).getByRole("button", { name: "Tandai lunas" }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Anda tidak memiliki izin untuk tindakan ini."));
      expect(within(screen.getByTestId("formulir-fee")).getByText("Belum bayar")).toBeTruthy();
      expect(toast.success).not.toHaveBeenCalled();
      expect(within(confirmRow()).getByRole("button", { name: "Tandai lunas" })).toBeEnabled();
    });

    it("when someone settled it first, toasts why, shows what is true now and drops the confirm", async () => {
      const user = userEvent.setup();
      let detailReads = 0;
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return { ok: false, status: 409, json: async () => ({ error: "Biaya pendaftaran ini sudah selesai dan tidak bisa diubah lagi." }) } as Response;
        }
        detailReads += 1;
        return detail(BOTH, detailReads > 1 ? { fee: fee({ status: "PAID" }) } : {});
      });
      setup({ result: result({ fee: fee() }) });
      await user.click(await screen.findByRole("button", { name: "Tandai lunas (tunai)" }));
      await user.click(within(confirmRow()).getByRole("button", { name: "Tandai lunas" }));

      await waitFor(() => expect(within(screen.getByTestId("formulir-fee")).getByText("Lunas")).toBeTruthy());
      expect(toast.error).toHaveBeenCalledWith("Biaya pendaftaran ini sudah selesai dan tidak bisa diubah lagi.");
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
  });

  it("Selesai closes the card", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Selesai" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
