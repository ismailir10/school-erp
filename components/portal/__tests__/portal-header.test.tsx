import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortalHeader } from "../portal-header";

describe("PortalHeader", () => {
  it("renders brand label + logo + first name + fallback initial", () => {
    render(
      <PortalHeader
        userName="Siti Nurhaliza Hidayat"
        avatarFallback="SN"
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("Talib")).toBeInTheDocument();
    expect(screen.getByText("Siti")).toBeInTheDocument();
    expect(screen.getByText("SN")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(
      <PortalHeader
        userName="Budi"
        userSubtitle="2 anak"
        avatarFallback="B"
        onLogout={() => {}}
      />,
    );
    expect(screen.getByText("2 anak")).toBeInTheDocument();
  });

  it.each(["/teacher/profile", "/parent/profile"])("gives the shared %s account link a 44px focus target", (profileHref) => {
    render(<PortalHeader userName="Bu Sari" avatarFallback="BS" profileHref={profileHref} onLogout={() => {}} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", profileHref);
    expect(link).toContainElement(screen.getByText("Bu"));
    expect(link).toHaveClass("min-h-11");
    expect(link).toHaveClass("focus-visible:ring-2");
  });

  it("has no profile link when profileHref is absent", () => {
    render(
      <PortalHeader userName="Budi" avatarFallback="B" onLogout={() => {}} />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens confirm dialog then fires onLogout on Konfirmasi", async () => {
    const onLogout = vi.fn();
    const user = userEvent.setup();
    render(
      <PortalHeader userName="Budi" avatarFallback="B" onLogout={onLogout} />,
    );

    // First click opens the dialog without firing onLogout.
    const logout = screen.getByRole("button", { name: "Keluar" });
    expect(logout).toHaveClass("min-h-11");
    expect(logout).toHaveClass("min-w-11");
    expect(logout).toHaveClass("focus-visible:ring-2");
    await user.click(logout);
    expect(onLogout).not.toHaveBeenCalled();
    expect(screen.getByText("Keluar dari Talib?")).toBeInTheDocument();

    // Clicking the dialog's explicit logout action fires onLogout.
    await user.click(screen.getByRole("button", { name: "Keluar" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("does not fire onLogout when the confirm dialog is cancelled", async () => {
    const onLogout = vi.fn();
    const user = userEvent.setup();
    render(
      <PortalHeader userName="Budi" avatarFallback="B" onLogout={onLogout} />,
    );

    await user.click(screen.getByRole("button", { name: "Keluar" }));
    expect(screen.getByText("Keluar dari Talib?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Batal" }));
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("prefers avatarUrl over fallback initials when provided", () => {
    const { container } = render(
      <PortalHeader
        userName="Budi"
        avatarUrl="/avatars/budi.jpg"
        avatarFallback="B"
        onLogout={() => {}}
      />,
    );
    const avatarImg = container.querySelector('img[alt=""]') as HTMLImageElement | null;
    expect(avatarImg).not.toBeNull();
    expect(avatarImg!.src).toContain("/avatars/budi.jpg");
    expect(screen.queryByText("B")).not.toBeInTheDocument();
  });
});
