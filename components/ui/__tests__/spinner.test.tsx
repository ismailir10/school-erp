import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "../spinner";

describe("Spinner", () => {
  it("is a status with the default Indonesian label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Memuat" })).toBeInTheDocument();
  });

  it("accepts a custom label and className", () => {
    render(<Spinner aria-label="Menyimpan" className="size-6 text-primary" />);
    const el = screen.getByRole("status", { name: "Menyimpan" });
    expect(el).toHaveClass("size-6", "text-primary");
    expect(el).not.toHaveClass("size-4");
  });

  it("aria-hidden variant drops role and label", () => {
    const { container } = render(<Spinner aria-hidden />);
    expect(screen.queryByRole("status")).toBeNull();
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("aria-label");
    expect(svg).not.toHaveAttribute("role");
  });

  it("spins but stops under prefers-reduced-motion", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveClass("animate-spin", "motion-reduce:animate-none");
  });
});
