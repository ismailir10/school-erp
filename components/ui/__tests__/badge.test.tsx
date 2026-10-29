import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "../badge";

describe("Badge", () => {
  it("keeps the default variant on the primary tone", () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText("Default");
    expect(badge).toHaveClass("bg-primary", "text-primary-foreground");
    expect(badge).toHaveAttribute("data-slot", "badge");
  });

  it.each([
    ["success", "bg-success-subtle", "text-success-text"],
    ["warning", "bg-warning-subtle", "text-warning-text"],
    ["info", "bg-info-subtle", "text-info-text"],
    ["danger", "bg-destructive-subtle", "text-destructive-text"],
    ["destructive", "bg-destructive-subtle", "text-destructive-text"],
    ["neutral", "bg-muted", "text-muted-foreground"],
  ] as const)("renders the %s variant with its subtle surface and text token", (variant, bg, text) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    const badge = screen.getByText(variant);
    expect(badge).toHaveClass(bg, text, "border-transparent");
  });

  it("does not leave opacity tints on semantic variants", () => {
    render(<Badge variant="danger">Tint</Badge>);
    expect(screen.getByText("Tint").className).not.toMatch(/bg-destructive\/\d+/);
  });

  it("merges a caller className", () => {
    render(<Badge variant="neutral" className="ml-2">Extra</Badge>);
    expect(screen.getByText("Extra")).toHaveClass("ml-2", "bg-muted");
  });
});
