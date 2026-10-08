import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ElementProgressRow } from "../element-progress-row";
import { LevelLegend } from "../level-legend";

describe("ElementProgressRow level labels (PARX-10)", () => {
  it("prints the full level names, never the bare 'Perlu' / 'Belum' fragments", () => {
    const { container } = render(
      <ul>
        <ElementProgressRow
          element="NILAI_AGAMA_BUDI_PEKERTI"
          counts={{ CONSISTENT: 3, EMERGING: 1, NEEDS_REINFORCEMENT: 2, total: 6 }}
        />
      </ul>,
    );
    expect(screen.getByText("3 Mampu dan Konsisten")).toBeInTheDocument();
    expect(screen.getByText("1 Mampu Belum Konsisten")).toBeInTheDocument();
    expect(screen.getByText("2 Perlu Penguatan")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d Perlu(?! Penguatan)/);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Perlu Penguatan");
  });
});

describe("LevelLegend", () => {
  it("explains the colours and the bar, keeping the 'bukan nilai' framing", () => {
    render(<LevelLegend />);
    expect(screen.getByText("Mampu dan Konsisten")).toBeInTheDocument();
    expect(screen.getByText("Mampu Belum Konsisten")).toBeInTheDocument();
    expect(screen.getByText("Perlu Penguatan")).toBeInTheDocument();
    expect(screen.getByText(/bukan nilai/)).toBeInTheDocument();
  });
});
