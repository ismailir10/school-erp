import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stagger, StaggerItem } from "../stagger";
import { stubMatchMedia } from "./motion-test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

function List({ n = 4 }: { n?: number }) {
  return (
    <Stagger as="ol" count={n} className="list">
      {Array.from({ length: n }, (_, i) => (
        <StaggerItem key={i} as="li" className="row">
          Butir {i + 1}
        </StaggerItem>
      ))}
    </Stagger>
  );
}

describe("Stagger", () => {
  it("keeps ol > li structure and className under reduced motion, with no motion styles", () => {
    stubMatchMedia(true);
    const { container } = render(<List />);
    const ol = container.querySelector("ol") as HTMLElement;
    expect(ol).toHaveClass("list");
    expect(ol.getAttribute("style")).toBeNull();
    const items = ol.querySelectorAll(":scope > li");
    expect(items).toHaveLength(4);
    items.forEach((li) => {
      expect(li).toHaveClass("row");
      expect(li.getAttribute("style")).toBeNull();
    });
  });

  it("renders plain elements when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { container } = render(<List />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(4);
    expect(container.querySelector("li")?.getAttribute("style")).toBeNull();
  });

  it("server output is fully visible plain markup", () => {
    stubMatchMedia(false);
    const html = renderToString(<List n={3} />);
    expect(html).toMatch(/^<ol class="list">/);
    expect(html).not.toContain("opacity");
    expect(html.match(/<li /g)).toHaveLength(3);
  });

  it("on a fresh client mount keeps ol > li, forwards className and has every item in the DOM at once", () => {
    stubMatchMedia(false);
    const { container } = render(<List n={17} />);
    const ol = container.querySelector("ol") as HTMLElement;
    expect(ol).toHaveClass("list");
    const items = ol.querySelectorAll(":scope > li");
    expect(items).toHaveLength(17);
    expect(screen.getByText("Butir 17")).toBeInTheDocument();
    items.forEach((li) => expect(li).toHaveClass("row"));
    // Starts hidden, ready to reveal (JS is running, so this cannot strand content).
    expect((items[0] as HTMLElement).style.opacity).toBe("0");
  });

  it("a StaggerItem outside a Stagger is a plain element", () => {
    const { container } = render(<StaggerItem className="solo">x</StaggerItem>);
    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.firstElementChild?.getAttribute("style")).toBeNull();
  });
});
