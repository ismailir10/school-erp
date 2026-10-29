import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Wallet } from "lucide-react";
import { StatCard } from "../stat-card";
import { StatsCardsRow } from "../stats-cards-row";

describe("<StatCard> fluid figure (FIN-21)", () => {
  it("sizes a long Rupiah figure from the card width and never breaks inside it", () => {
    render(<StatCard label="Total Penerimaan" value="Rp 1.234.567.890" icon={Wallet} />);
    const figure = screen.getByText("Rp 1.234.567.890");
    expect(figure).toHaveClass("whitespace-nowrap", "tabular-nums");
    expect(figure.className).toContain("text-[length:clamp(0.75rem,9cqi,var(--type-display))]");
    expect(figure).not.toHaveClass("text-h2");
  });

  it("picks the bucket from the string length", () => {
    const { rerender } = render(<StatCard label="Total" value="Rp 1.000" icon={Wallet} />);
    expect(screen.getByText("Rp 1.000").className).toContain("15cqi");
    rerender(<StatCard label="Total" value="12.345" icon={Wallet} />);
    expect(screen.getByText("12.345").className).toContain("24cqi");
    rerender(<StatCard label="Total" value="Rp 12.345.678" icon={Wallet} />);
    expect(screen.getByText("Rp 12.345.678").className).toContain("9cqi");
  });

  it("measures a count by what it renders", () => {
    render(<StatCard label="Total" value={101} icon={Wallet} />);
    expect(screen.getByText("101").className).toContain("38cqi");
    render(<StatCard label="Siswa" value={12345} icon={Wallet} />);
    expect(screen.getByText("12345").className).toContain("24cqi");
  });

  it("makes the card content a size container, with the icon in the label row", () => {
    const { container } = render(<StatCard label="Total Penerimaan" value={5} icon={Wallet} />);
    const box = container.querySelector(".\\@container");
    expect(box).not.toBeNull();
    const labelRow = screen.getByText("Total Penerimaan").parentElement as HTMLElement;
    expect(labelRow.querySelector("svg")).not.toBeNull();
    // The figure sits below the label row, not beside the icon.
    expect(labelRow.contains(screen.getByText("5"))).toBe(false);
  });
});

describe("<StatsCardsRow> phone grid", () => {
  it("spans an odd last card across both columns below lg", () => {
    const { container } = render(
      <StatsCardsRow cols={4}>
        <div />
        <div />
        <div />
      </StatsCardsRow>,
    );
    expect(container.firstElementChild).toHaveClass("grid-cols-2", "max-lg:[&>*:last-child:nth-child(odd)]:col-span-2");
  });
});
