import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StatFilter } from "@/components/admin/stat-filter";

describe("StatFilter", () => {
  it("reflects `pressed` in aria-pressed", () => {
    const { rerender } = render(
      <StatFilter label="Aktif" value={12} pressed={false} onPress={() => {}}><span>tile</span></StatFilter>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<StatFilter label="Aktif" value={12} pressed onPress={() => {}}><span>tile</span></StatFilter>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onPress when clicked", async () => {
    const onPress = vi.fn();
    render(<StatFilter label="Aktif" value={12} pressed={false} onPress={onPress}><span>tile</span></StatFilter>);
    await userEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("is named `label: value`", () => {
    render(<StatFilter label="Lulus" value="0" pressed={false} onPress={() => {}}><span>tile</span></StatFilter>);
    expect(screen.getByRole("button", { name: "Lulus: 0" })).toBeInTheDocument();
  });
});
