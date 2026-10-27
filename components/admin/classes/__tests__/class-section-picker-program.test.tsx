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
  it("names the one recurring fee by its own label, never as a bare total", () => {
    expect(
      classProgramLine(
        section({ id: "a", name: "TK A 1", recurringFeeTotal: 499000, recurringFeeLines: 1, recurringFeeLabel: "SPP Bulanan" }),
      ),
    ).toBe("TK A · SPP Bulanan Rp 499.000");
  });

  it("says how many components make up a total of several", () => {
    expect(
      classProgramLine(
        section({ id: "a", name: "TK A 1", recurringFeeTotal: 604000, recurringFeeLines: 2, recurringFeeLabel: null }),
      ),
    ).toBe("TK A · Rp 604.000 / periode (2 komponen)");
  });

  it("says so when the program has no fee line", () => {
    expect(classProgramLine(section({ id: "a", name: "TK A 1", recurringFeeTotal: null }))).toBe(
      "TK A · belum ada tarif rutin",
    );
  });

  it("shows only the program when the fee is not known", () => {
    expect(classProgramLine(section({ id: "a", name: "TK A 1" }))).toBe("TK A");
  });
});

describe("ClassSectionMultiPicker — showProgram", () => {
  const fees = { recurringFeeTotal: 504000, recurringFeeLines: 1, recurringFeeLabel: "SPP Bulanan" };
  const sections = [
    section({ id: "sec-1", name: "TK A 1", program: { name: "TK B" }, ...fees }),
    section({ id: "sec-2", name: "Sakura", program: { name: "Day Care" }, ...fees, recurringFeeTotal: 750000 }),
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

    expect(await screen.findByText("· SPP Bulanan Rp 504.000")).toBeInTheDocument();
    expect(screen.getByText("· SPP Bulanan Rp 750.000")).toBeInTheDocument();
    expect(screen.getByText("Day Care")).toBeInTheDocument();
  });

  it("keeps the rate untruncated: only the program name is allowed to clip", async () => {
    await open(true);

    expect((await screen.findByText("· SPP Bulanan Rp 504.000")).className).toContain("shrink-0");
    expect(screen.getByText("Day Care").className).toContain("truncate");
  });

  it("matches a search on the program name", async () => {
    const user = await open(true);

    await user.type(await screen.findByPlaceholderText("Cari kelas..."), "Day Care");

    expect(await screen.findAllByRole("option")).toHaveLength(1);
  });

  it("is unchanged for other callers that do not ask for it", async () => {
    await open(false);

    await screen.findAllByRole("option");
    expect(screen.queryByText(/Rp 504\.000/)).not.toBeInTheDocument();
    expect(screen.queryByText("Day Care")).not.toBeInTheDocument();
  });
});
