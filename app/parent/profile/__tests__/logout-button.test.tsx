import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { signOut, toastError, push } = vi.hoisted(() => ({
  signOut: vi.fn(),
  toastError: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/sign-out", () => ({ signOut }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { LogoutButton } from "../logout-button";

beforeEach(() => vi.clearAllMocks());

async function openAndConfirm() {
  await userEvent.click(screen.getByRole("button", { name: "Keluar" }));
  const dialog = await screen.findByRole("alertdialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Keluar" }));
}

describe("parent profile LogoutButton (PAR-1, PARX-7)", () => {
  it("asks for confirmation first and does not sign out on the first tap", async () => {
    render(<LogoutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Keluar" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Keluar dari Talib?")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("Batal closes the dialog without signing out", async () => {
    render(<LogoutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Keluar" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out through the full-navigation helper, never router.push", async () => {
    signOut.mockResolvedValue(undefined);
    render(<LogoutButton />);
    await openAndConfirm();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows an error and re-enables the button when sign-out fails", async () => {
    signOut.mockRejectedValue(new Error("nope"));
    render(<LogoutButton />);
    await openAndConfirm();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Tidak bisa keluar"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Keluar" })).toBeEnabled();
  });
});
