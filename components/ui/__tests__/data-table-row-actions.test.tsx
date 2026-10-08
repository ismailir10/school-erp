import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DataTableRowActions } from "../data-table-row-actions";

describe("DataTableRowActions menu", () => {
  it("sizes to its content instead of the 32px trigger, so long labels do not wrap word by word", async () => {
    const user = userEvent.setup();
    render(
      <DataTableRowActions
        rowLabel="Aisyah"
        extraActions={[{ label: "Lanjutkan ke Jadwalkan Kunjungan", onClick: vi.fn() }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Aksi untuk Aisyah" }));
    const menu = await screen.findByRole("menu");

    expect(menu).toHaveClass("w-auto", "min-w-40");
    expect(menu).not.toHaveClass("w-(--anchor-width)");
    expect(menu).not.toHaveClass("min-w-32");
    expect(screen.getByText("Lanjutkan ke Jadwalkan Kunjungan")).toBeInTheDocument();
  });
});
