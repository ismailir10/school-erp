import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

describe("ConfirmDialog", () => {
  it("closes on successful onConfirm resolution", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Hapus siswa?"
        description="Tidak dapat dibatalkan."
        confirmLabel="Hapus"
        onConfirm={onConfirm}
        destructive
      />,
    );

    await user.click(screen.getByRole("button", { name: "Hapus" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open when onConfirm rejects", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error("server exploded"));

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Luluskan siswa"
        confirmLabel="Luluskan"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Luluskan" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    // onOpenChange(false) must NOT have been called — the dialog stays open so
    // the caller can toast and the user can retry.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Button must re-enable after rejection settles — otherwise the dialog is
    // open but frozen and the user can't retry.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Luluskan" })).not.toBeDisabled();
    });
  });

  it("closes when Cancel is clicked (AlertDialogCancel auto-close)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Batalkan tagihan"
        cancelLabel="Jangan"
        confirmLabel="Batalkan"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Jangan" }));

    // Base UI's AlertDialog.Close calls onOpenChange(false, details) — check
    // the first positional arg instead of a strict whole-args match.
    await waitFor(() => {
      expect(onOpenChange.mock.calls.some((args) => args[0] === false)).toBe(
        true,
      );
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables both buttons while onConfirm is pending", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    let resolve: (() => void) | undefined;
    const onConfirm = vi.fn(
      () => new Promise<void>((r) => { resolve = r; }),
    );

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Proses pembayaran"
        confirmLabel="Proses"
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Proses" });
    await user.click(confirm);

    // Label flips to "Memproses..." while pending; both buttons disabled.
    const busyBtn = await screen.findByRole("button", { name: "Memproses..." });
    expect(busyBtn).toBeDisabled();
    const cancelBtn = screen.getByRole("button", { name: "Batal" });
    expect(cancelBtn).toBeDisabled();

    resolve?.();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("uses the solid destructive style only when destructive", () => {
    const { rerender } = render(
      <ConfirmDialog open onOpenChange={vi.fn()} title="T" confirmLabel="Ya" onConfirm={vi.fn()} destructive />,
    );
    expect(screen.getByRole("button", { name: "Ya" }).className).toContain("bg-destructive text-white");
    rerender(<ConfirmDialog open onOpenChange={vi.fn()} title="T" confirmLabel="Ya" onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ya" }).className).not.toContain("text-white");
  });
});
