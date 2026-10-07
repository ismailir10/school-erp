import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ClassSectionCombobox,
  type ClassSection,
} from "@/components/admin/class-section-picker";

function section(id: string, name: string, enrolled: number, capacity: number): ClassSection {
  return {
    id,
    name,
    capacity,
    program: { name: "TK" },
    academicYear: { name: "2026/2027" },
    campus: { name: "Taman Aster" },
    _count: { enrollments: enrolled },
  };
}

const sections = [
  section("open", "TK A 1", 3, 10),
  section("full", "TK A 2", 1, 1),
];

describe("ClassSectionCombobox — full classes (CORE-20)", () => {
  it("keeps a full class visible with a Penuh badge but does not let it be chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ClassSectionCombobox sections={sections} value="" onChange={onChange} placeholder="Pilih kelas..." />,
    );

    await user.click(screen.getByRole("combobox"));

    const fullRow = (await screen.findByText(/TK A 2/)).closest("[data-slot='command-item']")!;
    expect(fullRow).toHaveAttribute("data-disabled", "true");
    expect(fullRow).toHaveTextContent("Penuh");

    await user.click(fullRow);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still lets a class with free seats be chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ClassSectionCombobox sections={sections} value="" onChange={onChange} placeholder="Pilih kelas..." />,
    );

    await user.click(screen.getByRole("combobox"));
    const openRow = (await screen.findByText(/TK A 1/)).closest("[data-slot='command-item']")!;
    expect(openRow).not.toHaveAttribute("data-disabled", "true");
    expect(openRow).not.toHaveTextContent("Penuh");

    await user.click(openRow);
    expect(onChange).toHaveBeenCalledWith("open");
  });
});
