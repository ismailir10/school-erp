import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataTableToolbar } from "@/components/ui/data-table-toolbar";

describe("DataTableToolbar", () => {
  it("uses parent-controlled search state", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    const { rerender } = render(
      <DataTableToolbar
        value=""
        onValueChange={onValueChange}
        searchPlaceholder="Cari siswa..."
      />,
    );

    await user.type(screen.getByPlaceholderText("Cari siswa..."), "A");
    expect(onValueChange).toHaveBeenCalledWith("A");

    rerender(
      <DataTableToolbar
        value="Aisyah"
        onValueChange={onValueChange}
        searchPlaceholder="Cari siswa..."
      />,
    );

    expect(screen.getByPlaceholderText("Cari siswa...")).toHaveValue("Aisyah");
  });

  it("keeps controlled value compatible with the legacy onSearchChange callback", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();

    render(
      <DataTableToolbar
        value=""
        onSearchChange={onSearchChange}
        searchPlaceholder="Cari siswa..."
      />,
    );

    await user.type(screen.getByPlaceholderText("Cari siswa..."), "A");

    expect(onSearchChange).toHaveBeenCalledWith("A");
  });

  it("resets search and filters from the toolbar", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const onStatusChange = vi.fn();

    render(
      <DataTableToolbar
        value="Aisyah"
        onValueChange={onValueChange}
        filters={[
          {
            key: "status",
            label: "Status",
            value: "ACTIVE",
            onChange: onStatusChange,
            options: [
              { value: "all", label: "Semua Status" },
              { value: "ACTIVE", label: "Aktif" },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Atur Ulang" }));

    expect(onValueChange).toHaveBeenCalledWith("");
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith("all");
    });
  });

  // T1 (cycle 2026-09-26, admin-ui-standard-c1) — "Atur Ulang" used to render
  // permanently as a disabled grey word. It now renders only while something
  // is active, so an empty list page doesn't show a button that never does
  // anything.
  it("does not render Reset when nothing is active", () => {
    render(<DataTableToolbar value="" onValueChange={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Atur Ulang" })).not.toBeInTheDocument();
  });

  it("does not render Reset while a filter sits at its own reset value", () => {
    render(
      <DataTableToolbar
        value=""
        onValueChange={vi.fn()}
        filters={[
          {
            key: "status",
            label: "Status",
            value: "all",
            onChange: vi.fn(),
            options: [
              { value: "all", label: "Semua Status" },
              { value: "ACTIVE", label: "Aktif" },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Atur Ulang" })).not.toBeInTheDocument();
  });

  it("renders Reset once the search is non-empty", () => {
    render(<DataTableToolbar value="Aisyah" onValueChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Atur Ulang" })).toBeInTheDocument();
  });

  it("renders Reset while hasExternalFilter is active even with no owned filter", () => {
    render(<DataTableToolbar value="" onValueChange={vi.fn()} hasExternalFilter />);

    expect(screen.getByRole("button", { name: "Atur Ulang" })).toBeInTheDocument();
  });

  // Review fix — the render guard used to be `(hasSearch || hasFilters) &&
  // canReset`, which hid Reset for a toolbar with only `hasExternalFilter`
  // active and no `value`/`onValueChange`/`onSearchChange`/`filters` prop at
  // all (e.g. a toolbar that owns no search box, only a grouped Select the
  // page renders itself — see the prop's own doc comment). It must render
  // whenever `canReset` is true, full stop.
  it("renders Reset from hasExternalFilter alone, with no search or filters props at all", () => {
    render(<DataTableToolbar hasExternalFilter />);

    expect(screen.getByRole("button", { name: "Atur Ulang" })).toBeInTheDocument();
  });
});

describe("DataTableToolbar phone layout", () => {
  const options = [{ value: "all", label: "Semua" }, { value: "a", label: "A" }];
  const filter = (key: string) => ({ key, label: key, options, value: "all", onChange: () => {} });

  it("pairs dropdowns two per row and lets an odd last one span both", () => {
    render(<DataTableToolbar filters={[filter("Status"), filter("Kampus"), filter("Program")]} />);
    const [status, kampus, program] = screen.getAllByRole("combobox");
    expect(status.className).not.toContain("col-span-2");
    expect(kampus.className).not.toContain("col-span-2");
    expect(program.className).toContain("col-span-2");
  });

  it("keeps a lone dropdown full width", () => {
    render(<DataTableToolbar filters={[filter("Status")]} />);
    expect(screen.getByRole("combobox").className).toContain("col-span-2");
  });
});
