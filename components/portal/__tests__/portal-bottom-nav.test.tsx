import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home, Settings, User, MoreHorizontal } from "lucide-react";
import { PortalBottomNav, type PortalBottomNavItem } from "../portal-bottom-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/foo/settings",
}));

describe("PortalBottomNav", () => {
  const items = [
    { label: "Home", href: "/foo", icon: Home },
    { label: "Settings", href: "/foo/settings", icon: Settings },
    { label: "Profile", href: "/foo/profile", icon: User },
  ];

  it("renders nav with aria-label and all items as links", () => {
    render(<PortalBottomNav items={items} ariaLabel="Test nav" />);
    const nav = screen.getByRole("navigation", { name: "Test nav" });
    expect(nav).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
  });

  it("marks the active item with aria-current=page", () => {
    render(<PortalBottomNav items={items} ariaLabel="Test nav" />);
    const active = screen.getByRole("link", { name: "Settings" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current");
  });

  it("honours a custom matcher instead of prefix matching", () => {
    render(
      <PortalBottomNav
        ariaLabel="Test nav"
        items={[
          { label: "Home", href: "/foo", icon: Home, matcher: (p) => p === "/foo" },
        ]}
      />,
    );
    // pathname is /foo/settings — prefix matching would wrongly light this up.
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  // ── Layout contract ───────────────────────────────────────────────
  // Regression guard for the 6-tab overflow fixed 2026-08-01: bare `flex-1`
  // leaves `flex-basis: auto`, so each slot is sized by its own label and the
  // row's width becomes the sum of the labels. That pushed the parent portal's
  // last tab 27.4px past a 375px viewport, and off-screen entirely at 360px.
  it("sizes every slot with flex-1 basis-0 so the row cannot exceed its container", () => {
    render(<PortalBottomNav items={items} ariaLabel="Test nav" />);
    for (const slot of screen.getAllByRole("link")) {
      expect(slot.className).toContain("flex-1");
      expect(slot.className).toContain("basis-0");
    }
  });

  // 320 px phones: a 64 px slot truncated "Kehadiran" to "Kehadi…". Labels shrink
  // fluidly (10 px floor) and never truncate.
  it("never truncates a label and sizes it fluidly with a 10px floor", () => {
    render(<PortalBottomNav items={items} ariaLabel="Test nav" />);
    for (const item of items) {
      const label = screen.getByText(item.label);
      expect(label.className).not.toContain("truncate");
      expect(label.className).toContain("whitespace-nowrap");
      expect(label.className).toContain("clamp(0.625rem");
    }
    for (const slot of screen.getAllByRole("link")) expect(slot.className).toContain("px-0.5");
  });

  it("gives every slot a visible focus ring", () => {
    render(<PortalBottomNav items={items} ariaLabel="Test nav" />);
    for (const slot of screen.getAllByRole("link")) {
      expect(slot.className).toContain("focus-visible:ring-2");
    }
  });

  // ── Action items (overflow trigger) ───────────────────────────────
  describe("action item", () => {
    const withAction = (
      onSelect: () => void,
      expanded = false,
    ): PortalBottomNavItem[] => [
      { kind: "link", label: "Home", href: "/foo", icon: Home },
      {
        kind: "action",
        label: "Lainnya",
        icon: MoreHorizontal,
        onSelect,
        expanded,
        active: expanded,
      },
    ];

    it("renders as a button with dialog semantics, never as a link", () => {
      render(<PortalBottomNav items={withAction(() => {})} ariaLabel="Test nav" />);

      const trigger = screen.getByRole("button", { name: "Lainnya" });
      expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      // An overflow trigger is not a destination — it must never claim to be
      // the current page.
      expect(trigger).not.toHaveAttribute("aria-current");
      expect(screen.queryByRole("link", { name: "Lainnya" })).toBeNull();
    });

    it("reflects the open state through aria-expanded", () => {
      render(<PortalBottomNav items={withAction(() => {}, true)} ariaLabel="Test nav" />);
      expect(screen.getByRole("button", { name: "Lainnya" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    it("fires onSelect on click", async () => {
      const onSelect = vi.fn();
      render(<PortalBottomNav items={withAction(onSelect)} ariaLabel="Test nav" />);

      await userEvent.click(screen.getByRole("button", { name: "Lainnya" }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("is keyboard reachable and activates on Enter", async () => {
      const onSelect = vi.fn();
      render(<PortalBottomNav items={withAction(onSelect)} ariaLabel="Test nav" />);

      const nav = screen.getByRole("navigation", { name: "Test nav" });
      await userEvent.tab();
      await userEvent.tab();
      const trigger = within(nav).getByRole("button", { name: "Lainnya" });
      expect(trigger).toHaveFocus();

      await userEvent.keyboard("{Enter}");
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("carries the same slot sizing and focus ring as a link slot", () => {
      render(<PortalBottomNav items={withAction(() => {})} ariaLabel="Test nav" />);
      const trigger = screen.getByRole("button", { name: "Lainnya" });
      expect(trigger.className).toContain("basis-0");
      expect(trigger.className).toContain("focus-visible:ring-2");
    });
  });
});
