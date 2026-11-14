import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntityLink } from "@/components/entity-link";

describe("EntityLink", () => {
  it("renders a link when href is given", () => {
    render(<EntityLink href="/admin/students/s1">Aisyah</EntityLink>);
    expect(screen.getByRole("link", { name: "Aisyah" }).getAttribute("href")).toBe("/admin/students/s1");
  });

  it("renders plain text when href is missing", () => {
    render(<EntityLink href={null}>Aisyah</EntityLink>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Aisyah")).toBeTruthy();
  });

  it("muted tone inherits colour; touch is opt-in", () => {
    const { rerender } = render(
      <EntityLink href="/x" tone="muted">A</EntityLink>,
    );
    const link = screen.getByRole("link");
    expect(link.className).toContain("text-inherit");
    expect(link.className).not.toContain("text-foreground");
    expect(link.className).not.toContain("min-h-11");
    rerender(<EntityLink href="/x" touch>A</EntityLink>);
    expect(screen.getByRole("link").className).toContain("min-h-11");
  });
});
