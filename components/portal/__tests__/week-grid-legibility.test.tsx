import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WeekGrid } from "@/components/portal/week-grid";

const categories = [
  {
    id: "cat-1",
    name: "Ibadah",
    scope: "SCHOOL",
    indicators: [{ id: "ind-1", label: "Mengikuti doa pembuka", order: 1 }],
  },
];

const dates = ["2026-08-24", "2026-08-25"];

describe("WeekGrid — legibility", () => {
  it("draws a filled read-only cell as an icon, not a grey glyph the same weight as empty", () => {
    const { container } = render(
      <WeekGrid
        categories={categories}
        entries={[{ indicatorId: "ind-1", date: "2026-08-24", checked: true }]}
        dates={dates}
      />,
    );

    // The checked cell carries an svg; the unchecked one does not.
    const checkedCell = screen.getByLabelText(
      "Mengikuti doa pembuka 2026-08-24 — diisi (hanya bisa dilihat)",
    );
    const emptyCell = screen.getByLabelText(
      "Mengikuti doa pembuka 2026-08-25 — belum diisi (hanya bisa dilihat)",
    );
    expect(checkedCell.querySelector("svg")).not.toBeNull();
    expect(emptyCell.querySelector("svg")).toBeNull();
    // Was literal "✓"/"—" text.
    expect(container.textContent).not.toContain("✓");
  });

  it("keeps a locked cell's reason in its accessible name", () => {
    render(
      <WeekGrid
        categories={categories}
        entries={[]}
        dates={["2100-01-04", "2100-01-05"]}
        editable
        onToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByLabelText(
        "Mengikuti doa pembuka 2100-01-04 — belum diisi — tanggal akan datang belum bisa diubah",
      ),
    ).toBeDisabled();
  });

  it("says the week is empty rather than rendering a silent wall of dashes", () => {
    render(
      <WeekGrid
        categories={categories}
        entries={[]}
        dates={dates}
        emptyWeekMessage="Sekolah belum mengisi jurnal untuk pekan ini."
      />,
    );

    expect(screen.getByTestId("empty-week-note")).toHaveTextContent(
      "Sekolah belum mengisi jurnal untuk pekan ini.",
    );
  });

  it("stays quiet as soon as the week holds one tick", () => {
    render(
      <WeekGrid
        categories={categories}
        entries={[{ indicatorId: "ind-1", date: "2026-08-24", checked: true }]}
        dates={dates}
        emptyWeekMessage="Sekolah belum mengisi jurnal untuk pekan ini."
      />,
    );

    expect(screen.queryByTestId("empty-week-note")).toBeNull();
  });

  it("does not claim emptiness when a row exists but is unchecked", () => {
    render(
      <WeekGrid
        categories={categories}
        entries={[{ indicatorId: "ind-1", date: "2026-08-24", checked: false }]}
        dates={dates}
        emptyWeekMessage="Sekolah belum mengisi jurnal untuk pekan ini."
      />,
    );

    // An unchecked entry row is not a tick — the week is still empty to a reader.
    expect(screen.getByTestId("empty-week-note")).toBeInTheDocument();
  });

  it("gives the 16px admin-edit badge a 44px hit area and keeps it openable", async () => {
    render(
      <WeekGrid
        categories={categories}
        entries={[
          {
            indicatorId: "ind-1",
            date: "2026-08-24",
            checked: true,
            lastAdminEdit: { changedByName: "Bu Admin", changedAt: "2026-08-25T03:00:00.000Z" },
          },
        ]}
        dates={dates}
      />,
    );

    const badge = screen.getByRole("button", { name: /Entri ini diedit oleh admin pada/ });
    // 16px look (w-4 h-4) + after:-inset-3.5 (14px each side) = 44px square.
    expect(badge.className).toContain("w-4");
    expect(badge.className).toContain("h-4");
    expect(badge.className).toContain("after:absolute");
    expect(badge.className).toContain("after:-inset-3.5");

    fireEvent.click(badge);
    expect(await screen.findByText("Diedit admin")).toBeInTheDocument();
  });
});
