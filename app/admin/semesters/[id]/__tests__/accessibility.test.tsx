import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { FilterGroup } from "../objectives/client";
import { SubThemeCard, ThemeCard } from "../themes/client";

describe("academic admin accessibility", () => {
  beforeAll(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("exposes the selected objective filter with aria-pressed", () => {
    render(
      <FilterGroup
        label="Kelompok"
        value="A"
        onChange={vi.fn()}
        options={[
          { value: "A", label: "Kelompok A" },
          { value: "B", label: "Kelompok B" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Kelompok A" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Kelompok A" })).toHaveClass("bg-primary", "text-primary-foreground", "hover:bg-primary");
    expect(screen.getByRole("button", { name: "Kelompok A" })).not.toHaveClass("bg-action");
    expect(screen.getByRole("button", { name: "Kelompok B" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("uses sibling theme selection and edit buttons with independent keyboard paths", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ThemeCard
        themes={[
          {
            id: "theme-1",
            semesterId: "semester-1",
            name: "Aku dan Lingkunganku",
            order: 1,
            status: "ACTIVE",
            _count: { subThemes: 2 },
          },
        ]}
        loading={false}
        canWrite
        selectedId={null}
        onSelect={onSelect}
        semesterId="semester-1"
        refresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const row = screen.getByTestId("theme-row");
    expect(row.tagName).toBe("DIV");
    expect(row).not.toHaveAttribute("role");

    const selectButton = within(row).getByRole("button", { pressed: false });
    const editButton = within(row).getByRole("button", { name: "Ubah tema" });
    expect(selectButton.parentElement).toBe(row);
    expect(editButton.parentElement).toBe(row);
    expect(selectButton.contains(editButton)).toBe(false);
    expect(selectButton).toHaveAttribute("aria-pressed", "false");

    selectButton.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("theme-1");

    await user.click(editButton);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Ubah Tema" })).toBeInTheDocument();
  });

  it("uses sibling subtheme controls and supports Space selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SubThemeCard
        subThemes={[
          {
            id: "subtheme-1",
            themeId: "theme-1",
            name: "Rumahku",
            order: 1,
            status: "ACTIVE",
            _count: { weeks: 2 },
          },
        ]}
        loading={false}
        canWrite
        parentTheme={{
          id: "theme-1",
          semesterId: "semester-1",
          name: "Aku dan Lingkunganku",
          order: 1,
          status: "ACTIVE",
          _count: { subThemes: 1 },
        }}
        selectedId="subtheme-1"
        onSelect={onSelect}
        refresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const row = screen.getByTestId("subtheme-row");
    const selectButton = within(row).getByRole("button", { pressed: true });
    const editButton = within(row).getByRole("button", {
      name: "Ubah subtema",
    });
    expect(selectButton.parentElement).toBe(row);
    expect(editButton.parentElement).toBe(row);
    expect(selectButton.contains(editButton)).toBe(false);
    expect(selectButton).toHaveAttribute("aria-pressed", "true");

    selectButton.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("subtheme-1");

    await user.click(editButton);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: "Ubah Subtema" }),
    ).toBeInTheDocument();
  });
});
