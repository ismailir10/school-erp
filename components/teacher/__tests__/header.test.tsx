import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { signOut, toastError } = vi.hoisted(() => ({ signOut: vi.fn(), toastError: vi.fn() }));

vi.mock("@/lib/sign-out", () => ({ signOut }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/teacher", useRouter: () => ({ push: vi.fn() }) }));

import { TeacherHeader } from "../header";

beforeEach(() => vi.clearAllMocks());

describe("TeacherHeader sign-out (PAR-1)", () => {
  it("confirming Keluar calls the shared full-navigation sign-out", async () => {
    signOut.mockResolvedValue(undefined);
    render(<TeacherHeader userName="Bu Ani" />);
    await userEvent.click(screen.getByRole("button", { name: "Keluar" }));
    await userEvent.click(screen.getByRole("button", { name: "Keluar" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed sign-out instead of pretending it worked", async () => {
    signOut.mockRejectedValue(new Error("nope"));
    render(<TeacherHeader userName="Bu Ani" />);
    await userEvent.click(screen.getByRole("button", { name: "Keluar" }));
    await userEvent.click(screen.getByRole("button", { name: "Keluar" }));
    expect(toastError).toHaveBeenCalled();
  });
});
