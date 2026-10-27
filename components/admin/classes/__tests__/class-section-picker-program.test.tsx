import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ClassSectionMultiPicker,
  classProgramLine,
  type ClassSection,
} from "@/components/admin/class-section-picker";

const section = (over: Partial<ClassSection> & { id: string; name: string }): ClassSection => ({
  program: { name: "TK A" },
  academicYear: { name: "2026/2027" },
  campus: { name: "Taman Aster" },
  _count: { enrollments: 5 },
  capacity: 20,
  ...over,
});

describe("classProgramLine", () => {
  it("shows the program and its per-period fee", () => {
    expect(classProgramLine(section({ id: "a", name: "TK A 1", recurringFeeTotal: 499000 }))).toBe(
      "TK A · Rp 499.000 / periode",
    );
  });

  it("says so when the program has no fee line", () => {
    expect(classProgramLine(section({ id: "a", name: "TK A 1", recurringFeeTotal: null }))).toBe(
      "TK A · belum ada tarif",
    );
  });

  it("shows only the program when the fee is not known", () => {
    expect(classProgramLine(section({ id: "a", name: "TK A 1" }))).toBe("TK A");
  });
});

describe("ClassSectionMultiPicker — showProgram", () => {
  const sections = [
    section({ id: "a", name: "TK A 1", recurringFeeTotal: 504000, program: { name: "TK B" } }),
    section({ id: "b", name: "TK B 1", recurringFeeTotal: 504000, program: { name: "TK B" } }),
  ];

  async function open(showProgram: boolean) {
    const user = userEvent.setup();
    render(
      <ClassSectionMultiPicker
        sections={sections}
        value={[]}
        onChange={vi.fn()}
        placeholder="Pilih kelas..."
        showProgram={showProgram}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    return user;
  }

  it("puts each class's program and rate on a second line", async () => {
    await open(true);

    expect(await screen.findAllByText("TK B · Rp 504.000 / periode")).toHaveLength(2);
  });

  it("matches a search on the program name", async () => {
    const user = await open(true);

    await user.type(await screen.findByPlaceholderText("Cari kelas..."), "TK B");

    expect(await screen.findAllByRole("option")).toHaveLength(2);
  });

  it("is unchanged for other callers that do not ask for it", async () => {
    await open(false);

    await screen.findAllByRole("option");
    expect(screen.queryByText(/Rp 504\.000/)).not.toBeInTheDocument();
  });
});
