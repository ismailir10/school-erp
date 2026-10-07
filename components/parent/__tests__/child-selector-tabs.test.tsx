import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { rejectedChildParam } from "../child-param-notice";

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/parent/attendance",
  useSearchParams: () => nav.params,
}));

import { ChildSelectorTabs } from "../child-selector-tabs";

const items = [
  { studentId: "c1", studentName: "Ahmad Zafran Hakim", studentNickname: "Zafran", className: "TK A" },
  { studentId: "c2", studentName: "Aisyah Nur Hakim", studentNickname: null, className: "TK B" },
];

beforeEach(() => {
  vi.clearAllMocks();
  nav.params = new URLSearchParams();
});

describe("ChildSelectorTabs names (PAR-10)", () => {
  it("labels a tab with the nickname, else the first word of the legal name", () => {
    render(<ChildSelectorTabs items={items} selectedChildId="c1" />);
    expect(screen.getByRole("tab", { name: "Zafran" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Ahmad" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Aisyah" })).toBeInTheDocument();
  });
});

describe("rejectedChildParam", () => {
  it("only flags an id that is not one of the known children", () => {
    expect(rejectedChildParam(["c1", "c2"], "c2")).toBeNull();
    expect(rejectedChildParam(["c1", "c2"], "foreign")).toBe("foreign");
    expect(rejectedChildParam(["c1"], null)).toBeNull();
    expect(rejectedChildParam([], "foreign")).toBeNull();
  });
});

describe("ChildSelectorTabs foreign ?child= (PAR-11)", () => {
  it("shows no notice for a valid child", () => {
    nav.params = new URLSearchParams("child=c2");
    render(<ChildSelectorTabs items={items} selectedChildId="c2" />);
    expect(screen.queryByTestId("child-param-notice")).not.toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("names the child being shown and drops the foreign id from the URL", async () => {
    nav.params = new URLSearchParams("child=someone-elses&week=2026-10-05");
    render(<ChildSelectorTabs items={items} selectedChildId="c1" sticky />);
    expect(screen.getByTestId("child-param-notice")).toHaveTextContent(
      "Anak yang dipilih tidak ditemukan di akun Anda. Menampilkan Zafran.",
    );
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith("/parent/attendance?child=c1&week=2026-10-05", { scroll: false }),
    );
  });

  it("still shows the notice for a single-child family (no tabs rendered)", () => {
    nav.params = new URLSearchParams("child=nope");
    render(<ChildSelectorTabs items={[items[0]!]} selectedChildId="c1" />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTestId("child-param-notice")).toHaveTextContent("Menampilkan Zafran.");
  });
});
