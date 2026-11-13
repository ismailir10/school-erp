import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BottomNav } from "../bottom-nav";
import { TEACHER_MORE_ITEMS } from "../more-sheet";

const navigation = vi.hoisted(() => ({ pathname: "/teacher" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("BottomNav", () => {
  beforeEach(() => {
    navigation.pathname = "/teacher";
  });

  function bar() {
    return screen.getByRole("navigation", { name: "Navigasi utama guru" });
  }

  it("renders five slots: four direct teaching destinations and overflow", () => {
    render(<BottomNav />);

    const links = within(bar()).getAllByRole("link");
    const buttons = within(bar()).getAllByRole("button");
    expect(links.map((link) => link.textContent)).toEqual([
      "Beranda",
      "Absensi",
      "Jurnal",
      "Penilaian",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/teacher",
      "/teacher/class-attendance",
      "/teacher/student-journal",
      "/teacher/assessments",
    ]);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Lainnya");
    expect(links.length + buttons.length).toBe(5);
    expect(within(bar()).queryByRole("link", { name: /^Kehadiran/ })).toBeNull();
  });

  it("opens the teacher overflow sheet with every personal destination", async () => {
    const user = userEvent.setup();
    render(<BottomNav />);

    const trigger = within(bar()).getByRole("button", { name: "Lainnya" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    const menu = await screen.findByRole("navigation", { name: "Menu lainnya guru" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const item of TEACHER_MORE_ITEMS) {
      expect(within(menu).getByRole("link", { name: new RegExp(`^${item.label}`) })).toHaveAttribute(
        "href",
        item.href,
      );
    }
  });

  it("keeps direct nested assessment routes active", () => {
    navigation.pathname = "/teacher/assessments/weekly";
    render(<BottomNav />);

    expect(within(bar()).getByRole("link", { name: "Penilaian" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(bar()).getByRole("link", { name: "Beranda" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it.each(["/teacher/gate", "/teacher/sessions", "/teacher/sessions/session_123"])(
    "marks only Beranda current for %s",
    (pathname) => {
      navigation.pathname = pathname;
      render(<BottomNav />);

      const current = bar().querySelectorAll('[aria-current="page"]');
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAccessibleName("Beranda");
    },
  );

  it.each([
    "/teacher/attendance",
    "/teacher/slips/slip_123",
    "/teacher/profile",
  ])("keeps Lainnya active for %s", (pathname) => {
    navigation.pathname = pathname;
    render(<BottomNav />);

    expect(within(bar()).getByText("Lainnya").className).toContain("text-primary");
    expect(within(bar()).getAllByRole("link")).not.toContainEqual(
      expect.objectContaining({ "aria-current": "page" }),
    );
  });

  it("moves focus into Lainnya on keyboard entry and restores it on Escape", async () => {
    const user = userEvent.setup();
    render(<BottomNav />);

    const trigger = within(bar()).getByRole("button", { name: "Lainnya" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("navigation", { name: "Menu lainnya guru" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(within(menu).getAllByRole("link")[0]).toHaveFocus());

    const dialog = screen.getByRole("dialog", { name: "Lainnya" });
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Vaul's CSS drives the exit. jsdom does not dispatch CSS animation events.
    const animationEnd = new Event("animationend", { bubbles: true });
    Object.defineProperty(animationEnd, "animationName", { value: "slideToBottom" });
    fireEvent(dialog, animationEnd);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps every slot equal-width and focus-visible", () => {
    render(<BottomNav />);

    for (const slot of [...within(bar()).getAllByRole("link"), ...within(bar()).getAllByRole("button")]) {
      expect(slot.className).toContain("basis-0");
      expect(slot.className).toContain("focus-visible:focus-outline");
    }
  });
});
