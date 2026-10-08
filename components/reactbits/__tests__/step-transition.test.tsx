import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepTransition } from "../step-transition";
import { stubMatchMedia } from "./motion-test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StepTransition", () => {
  it("renders children with no motion styles under reduced motion", () => {
    stubMatchMedia(true);
    const { container } = render(
      <StepTransition stepKey={0} direction={1} className="step">
        <p>Isi langkah</p>
      </StepTransition>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(screen.getByText("Isi langkah")).toBeInTheDocument();
    expect(el).toHaveClass("step");
    expect(el.getAttribute("style")).toBeNull();
  });

  it("renders children without matchMedia and never starts hidden", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { container } = render(
      <StepTransition stepKey="a" direction={1}>
        <p>Isi</p>
      </StepTransition>,
    );
    expect(screen.getByText("Isi")).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).style.opacity).not.toBe("0");
  });

  it("does not start hidden on the first render in the normal path", () => {
    stubMatchMedia(false);
    const { container } = render(
      <StepTransition stepKey={0} direction={1}>
        <p>Isi pertama</p>
      </StepTransition>,
    );
    expect(screen.getByText("Isi pertama")).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).style.opacity).not.toBe("0");
  });

  it("re-keys on stepKey change and renders the new child synchronously, with no exit phase", () => {
    stubMatchMedia(false);
    const { rerender, container } = render(
      <StepTransition stepKey={0} direction={1}>
        <p>Langkah satu</p>
      </StepTransition>,
    );
    const first = container.firstElementChild;
    rerender(
      <StepTransition stepKey={1} direction={1}>
        <p>Langkah dua</p>
      </StepTransition>,
    );
    // Immediate swap: the old step is gone and the new one is present in the same commit.
    expect(screen.queryByText("Langkah satu")).toBeNull();
    expect(screen.getByText("Langkah dua")).toBeInTheDocument();
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).not.toBe(first);
    // The entering step mounts hidden, ready to fade in.
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe("0");
  });

  it("slides in from the left when going back", () => {
    stubMatchMedia(false);
    const { rerender, container } = render(
      <StepTransition stepKey={1} direction={1}>
        <p>Dua</p>
      </StepTransition>,
    );
    rerender(
      <StepTransition stepKey={0} direction={-1}>
        <p>Satu</p>
      </StepTransition>,
    );
    expect(screen.getByText("Satu")).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).style.transform).toContain("-12px");
  });

  it("swaps content synchronously under reduced motion too", () => {
    stubMatchMedia(true);
    const { rerender, container } = render(
      <StepTransition stepKey={0} direction={1}>
        <p>Satu</p>
      </StepTransition>,
    );
    rerender(
      <StepTransition stepKey={1} direction={1}>
        <p>Dua</p>
      </StepTransition>,
    );
    expect(screen.queryByText("Satu")).toBeNull();
    expect(screen.getByText("Dua")).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).getAttribute("style")).toBeNull();
  });
});
