import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Users } from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";

describe("StatTile", () => {
  it("shows label above the value, with an optional hint", () => {
    render(<StatTile label="Hadir" value={12} hint="bulan ini" />);
    expect(screen.getByText("Hadir")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("bulan ini")).toBeInTheDocument();
  });

  it("makes the whole tile a link when given an href, named by ariaLabel", () => {
    render(<StatTile label="Tagihan lewat tempo" value={16} href="/admin/invoices" ariaLabel="16 tagihan lewat tempo" />);
    expect(screen.getByRole("link", { name: "16 tagihan lewat tempo" })).toHaveAttribute("href", "/admin/invoices");
  });

  it("keeps the size token next to the tone colour (tailwind-merge would drop it)", () => {
    render(<StatTile label="Hadir" value={7} size="lg" />);
    const cls = screen.getByText("7").className;
    expect(cls).toContain("text-display");
    expect(cls).toContain("text-foreground");
  });

  it("sizes a long amount from the tile and never wraps it", () => {
    render(<StatTile label="Piutang" value="Rp 10.000.000.000" size="sm" mono />);
    const cls = screen.getByText("Rp 10.000.000.000").className;
    expect(cls).toContain("whitespace-nowrap");
    expect(cls).toContain("text-[length:clamp(0.75rem,9cqi,1rem)]");
    expect(cls).not.toContain("wrap-anywhere");
  });

  it("makes a fluid tile a size container, and leaves text values wrapping", () => {
    const { container, rerender } = render(<StatTile label="Piutang" value="Rp 1.000" mono />);
    expect(container.firstElementChild).toHaveClass("@container");
    rerender(<StatTile label="Masa kerja" value="5 thn 3 bln" />);
    expect(container.firstElementChild).not.toHaveClass("@container");
    expect(screen.getByText("5 thn 3 bln").className).toContain("wrap-anywhere");
  });

  it("lets a caller override the tone colour", () => {
    render(<StatTile label="Terlambat" value={3} valueClassName="text-status-late-text" />);
    expect(screen.getByText("3").className).toContain("text-status-late-text");
    expect(screen.getByText("3").className).not.toContain("text-foreground");
  });

  it("renders an icon chip tinted by tone", () => {
    render(<StatTile label="Aktif" value={3} icon={Users} tone="positive" />);
    const chip = screen.getByTestId("stat-tile-icon");
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(chip).toHaveClass("size-8", "rounded-lg", "bg-success-subtle", "text-success-text");
  });

  it("matches the warning figure and chip and keeps routine icons neutral", () => {
    const { rerender } = render(<StatTile label="Terlambat" value={3} icon={Users} tone="warning" />);
    expect(screen.getByText("3")).toHaveClass("text-warning-text");
    expect(screen.getByTestId("stat-tile-icon")).toHaveClass("bg-warning-subtle", "text-warning-text");

    rerender(<StatTile label="Aktif" value={3} icon={Users} />);
    expect(screen.getByTestId("stat-tile-icon")).toHaveClass("bg-muted", "text-muted-foreground");
  });

  it("shows no chip without an icon", () => {
    render(<StatTile label="Aktif" value={3} />);
    expect(screen.queryByTestId("stat-tile-icon")).toBeNull();
  });

  it("lands a numeric value on its final number (count-up)", () => {
    render(<StatTile label="Siswa" value={12345} icon={Users} />);
    expect(screen.getByText("12345")).toBeInTheDocument();
  });

  it("passes a string value through untouched", () => {
    render(<StatTile label="Total" value="Rp 1.000" icon={Users} />);
    expect(screen.getByText("Rp 1.000")).toBeInTheDocument();
  });
});
