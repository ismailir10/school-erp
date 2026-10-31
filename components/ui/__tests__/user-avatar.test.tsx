import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserAvatar, getInitials } from "../user-avatar";

describe("getInitials", () => {
  it("takes the first letters of the first and last words, uppercased", () => {
    expect(getInitials("abdullah faris siregar")).toBe("AS");
    expect(getInitials("Siti Aisyah")).toBe("SA");
  });

  it("gives one letter for a single word", () => {
    expect(getInitials("Faris")).toBe("F");
  });

  it("gives ? for empty, whitespace-only, null and undefined", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
    expect(getInitials(null)).toBe("?");
    expect(getInitials(undefined)).toBe("?");
  });

  it("ignores extra spaces between and around words", () => {
    expect(getInitials("  Siti    Aisyah  ")).toBe("SA");
  });
});

describe("UserAvatar", () => {
  it("renders initials in the fallback", () => {
    render(<UserAvatar name="Siti Aisyah" />);
    expect(screen.getByText("SA")).toBeInTheDocument();
  });

  it("maps size to the avatar dimension class", () => {
    const { container, rerender } = render(<UserAvatar name="Siti" size="sm" />);
    expect(container.querySelector('[data-slot="avatar"]')?.className).toContain("size-8");
    rerender(<UserAvatar name="Siti" size="md" />);
    expect(container.querySelector('[data-slot="avatar"]')?.className).toContain("size-10");
    rerender(<UserAvatar name="Siti" size="lg" />);
    expect(container.querySelector('[data-slot="avatar"]')?.className).toContain("size-16");
  });

  it("shows ? for an empty name and applies the primary tone", () => {
    render(<UserAvatar name="" tone="primary" />);
    const fallback = screen.getByText("?");
    expect(fallback.className).toContain("bg-primary/10");
  });
});
