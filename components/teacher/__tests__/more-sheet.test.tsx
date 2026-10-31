import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TEACHER_MORE_ITEMS, TeacherMoreSheet } from "../more-sheet";

const navigation = vi.hoisted(() => ({ pathname: "/teacher" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("TeacherMoreSheet", () => {
  it("exposes the four lower-frequency teacher destinations", () => {
    navigation.pathname = "/teacher";
    render(<TeacherMoreSheet open onOpenChange={() => {}} />);

    const menu = screen.getByRole("navigation", { name: "Menu lainnya guru" });
    expect(screen.getByRole("heading", { name: "Lainnya" })).toBeVisible();

    for (const item of TEACHER_MORE_ITEMS) {
      expect(within(menu).getByRole("link", { name: new RegExp(`^${item.label}`) })).toHaveAttribute(
        "href",
        item.href,
      );
    }
  });

  it("lists the product tour, which lives outside the teacher portal", () => {
    navigation.pathname = "/teacher";
    render(<TeacherMoreSheet open onOpenChange={() => {}} />);

    const menu = screen.getByRole("navigation", { name: "Menu lainnya guru" });
    const tour = within(menu).getByRole("link", { name: /^Panduan Talib/ });
    expect(tour).toHaveAttribute("href", "/guide");
    // /guide is not under /teacher, so it never reads as the current page from a teacher route.
    expect(tour).not.toHaveAttribute("aria-current");
  });

  it("marks the salary row current for a nested salary-slip route", () => {
    navigation.pathname = "/teacher/slips/slip_123";
    render(<TeacherMoreSheet open onOpenChange={() => {}} />);

    const menu = screen.getByRole("navigation", { name: "Menu lainnya guru" });
    expect(within(menu).getByRole("link", { name: /^Slip gaji/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(menu).getByRole("link", { name: /^Kehadiran saya/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps overflow rows touch- and keyboard-focusable, and closes on selection", () => {
    navigation.pathname = "/teacher";
    const onOpenChange = vi.fn();
    render(<TeacherMoreSheet open onOpenChange={onOpenChange} />);

    const menu = screen.getByRole("navigation", { name: "Menu lainnya guru" });
    const profile = within(menu).getByRole("link", { name: /^Profil saya/ });
    expect(profile.className).toContain("min-h-14");
    expect(profile.className).toContain("focus-visible:ring-2");

    profile.focus();
    expect(profile).toHaveFocus();
    profile.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(profile);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
