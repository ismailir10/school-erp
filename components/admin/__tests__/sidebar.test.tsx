import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppSidebar } from "@/components/admin/sidebar";
import { useUnsavedChangesGuard, UnsavedChangesProvider } from "@/components/admin/unsaved-changes-provider";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

const navigation = vi.hoisted(() => ({ pathname: "/admin", mobile: false, push: vi.fn() }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => navigation.mobile }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

describe("AppSidebar — collapsible group chevron", () => {
  beforeEach(() => {
    navigation.pathname = "/admin";
    navigation.mobile = false;
    navigation.push.mockClear();
  });

  // Regression test for finding #6: the chevron's rotation class used to key
  // off `group-data-[state=open]/collapsible:rotate-90`, but no element in
  // the tree ever declared `group/collapsible` — a dead selector. On top of
  // that, Base UI's CollapsibleTrigger doesn't even emit `data-state`; per
  // node_modules/@base-ui/react/collapsible/trigger/CollapsibleTriggerDataAttributes.d.ts
  // it emits `data-panel-open` on itself while open. The fix scopes a named
  // group (`group/nav-group`) to the trigger and keys the chevron off
  // `group-data-[panel-open]/nav-group:rotate-90`.
  //
  // jsdom cannot evaluate Tailwind, so this test guards the wiring only. The
  // rule itself was verified in a real browser against the dev server: with
  // the group open the chevron computes `rotate: 90deg`. Note Tailwind v4
  // compiles `rotate-90` to the CSS `rotate` property, not `transform` —
  // reading `transform` reports "none" even when the rule is applied.
  it("scopes the chevron rotation to a named group declared on the trigger, keyed off data-panel-open", () => {
    render(
      <SidebarProvider>
        <AppSidebar permissions={["students.view"]} />
      </SidebarProvider>,
    );

    // The students group is visible through its student destination and
    // starts open per AppSidebar's initial `openGroups` state.
    const trigger = screen.getByRole("button", { name: "Kesiswaan" });

    // The trigger itself must declare the named group the chevron scopes
    // to. Old markup ("flex w-full items-center gap-2") declared no group
    // at all, so this assertion fails against it.
    expect(trigger.className).toContain("group/nav-group");

    const chevron = trigger.querySelector("svg.lucide-chevron-right");
    expect(chevron).not.toBeNull();
    // Old markup keyed the chevron off `group-data-[state=open]/collapsible:rotate-90`
    // — a different selector referencing a group name ("collapsible") that
    // no ancestor ever declared. This assertion fails against that string.
    expect(chevron?.getAttribute("class")).toContain(
      "group-data-[panel-open]/nav-group:rotate-90",
    );
    expect(chevron?.getAttribute("class")).toContain("transition-transform duration-200");

    // Base UI actually sets `data-panel-open` on the trigger while its
    // panel is open (confirmed in CollapsibleTrigger.js via
    // triggerOpenStateMapping) — not `data-state`. Verify the real
    // attribute is present while open...
    expect(trigger).toHaveAttribute("data-panel-open");
    expect(trigger).not.toHaveAttribute("data-state");

    return trigger;
  });

  it("removes data-panel-open from the trigger once the group is collapsed", async () => {
    const user = userEvent.setup();
    render(
      <SidebarProvider>
        <AppSidebar permissions={["students.view"]} />
      </SidebarProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Kesiswaan" });
    expect(trigger).toHaveAttribute("data-panel-open");

    await user.click(trigger);

    expect(trigger).not.toHaveAttribute("data-panel-open");
  });

  it("keeps the product tour link in the footer, above Keluar, whatever the permissions", () => {
    render(
      <SidebarProvider>
        <AppSidebar permissions={[]} />
      </SidebarProvider>,
    );

    const tour = screen.getByRole("link", { name: "Panduan Talib" });
    expect(tour).toHaveAttribute("href", "/panduan");
    const logout = screen.getByRole("button", { name: "Keluar" });
    expect(tour.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});


function MenuProbe({ dirty = false }: { dirty?: boolean }) {
  const { openMobile, setOpenMobile } = useSidebar();
  useUnsavedChangesGuard(dirty);
  return <><button onClick={() => setOpenMobile(true)}>Open menu</button><output data-testid="menu-open">{String(openMobile)}</output></>;
}

function MobileShell({ dirty = false }: { dirty?: boolean }) {
  return <UnsavedChangesProvider><SidebarProvider><MenuProbe dirty={dirty} /><AppSidebar permissions={["students.view"]} /></SidebarProvider></UnsavedChangesProvider>;
}

describe("mobile sidebar navigation", () => {
  beforeEach(() => {
    navigation.pathname = "/admin";
    navigation.mobile = true;
    navigation.push.mockClear();
  });

  it("closes after a successful pathname change, but not on query-only changes or rerenders", async () => {
    const user = userEvent.setup();
    const view = render(<MobileShell />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByTestId("menu-open")).toHaveTextContent("true");
    view.rerender(<MobileShell />);
    expect(screen.getByTestId("menu-open")).toHaveTextContent("true");
    navigation.pathname = "/admin/students";
    view.rerender(<MobileShell />);
    await waitFor(() => expect(screen.getByTestId("menu-open")).toHaveTextContent("false"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the mobile menu open when leaving dirty work is cancelled; closes when confirmed navigation commits", async () => {
    const user = userEvent.setup();
    const view = render(<MobileShell dirty />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByRole("link", { name: "Siswa" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Batal" }));
    expect(screen.getByTestId("menu-open")).toHaveTextContent("true");
    expect(navigation.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "Siswa" }));
    await user.click(screen.getByRole("button", { name: "Ya, Keluar" }));
    expect(navigation.push).toHaveBeenCalledWith("/admin/students");
    expect(screen.getByTestId("menu-open")).toHaveTextContent("true");
    navigation.pathname = "/admin/students";
    view.rerender(<MobileShell dirty />);
    await waitFor(() => expect(screen.getByTestId("menu-open")).toHaveTextContent("false"));
  });
});
