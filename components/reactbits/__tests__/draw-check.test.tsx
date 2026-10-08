import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawCheck } from "../draw-check";
import { stubMatchMedia } from "./motion-test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DrawCheck", () => {
  it("is decorative: aria-hidden, not focusable, currentColor stroke", () => {
    stubMatchMedia(false);
    const { container } = render(<DrawCheck className="text-success" />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("width", "44");
    expect(svg).toHaveClass("text-success");
    expect(svg.querySelector("circle")).not.toBeNull();
    expect(svg.querySelector("path")).not.toBeNull();
  });

  it("honours size and strokeWidth for small inline use", () => {
    const { container } = render(<DrawCheck size={16} strokeWidth={2.5} />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
    expect(svg).toHaveAttribute("stroke-width", "2.5");
  });

  it("is fully drawn and static under reduced motion", () => {
    stubMatchMedia(true);
    const { container } = render(<DrawCheck />);
    const parts = container.querySelectorAll("circle, path");
    expect(parts).toHaveLength(2);
    parts.forEach((p) => {
      expect(p.getAttribute("style")).toBeNull();
      expect(p.getAttribute("pathLength")).toBeNull();
    });
  });

  it("is fully drawn and static on the server", () => {
    stubMatchMedia(false);
    const html = renderToString(<DrawCheck />);
    expect(html).not.toContain("pathLength");
    expect(html).not.toContain("stroke-dasharray");
    expect(html).toContain("aria-hidden");
  });

  it("animates the paths on a fresh client mount", () => {
    stubMatchMedia(false);
    const { container } = render(<DrawCheck />);
    const circle = container.querySelector("circle") as SVGElement;
    expect(circle.getAttribute("pathLength")).toBe("1");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
