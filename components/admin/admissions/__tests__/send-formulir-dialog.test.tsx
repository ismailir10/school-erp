/**
 * "Formulir siap dikirim" card: what the status line says per case, and that
 * each way of getting the link to the parent (WhatsApp, copy, fill together)
 * points at the right place.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SendFormulirDialog, type SendFormulirDialogProps } from "../send-formulir-dialog";

const FORM_URL = "https://talib.example/pendaftaran/tok-123";

function setup(over: Partial<SendFormulirDialogProps> = {}) {
  const onClose = vi.fn();
  render(
    <SendFormulirDialog
      result={{ formUrl: FORM_URL, emailed: false, hasEmail: false }}
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
      setup({ result: { formUrl: FORM_URL, emailed: true, hasEmail: true }, email: "siti@test.com" });
      expect(screen.getByText("Email terkirim ke siti@test.com")).toBeTruthy();
    });

    it("says the email failed and the link must be shared", () => {
      setup({ result: { formUrl: FORM_URL, emailed: false, hasEmail: true }, email: "siti@test.com" });
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
      expect(screen.getByRole("status").textContent).toContain("Tautan formulir disalin");
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

  it("Selesai closes the card", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Selesai" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
