import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FadeContent } from "../fade-content";
import { stubMatchMedia } from "./motion-test-utils";

/** Records every observer so a test can fire its callback by hand. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  constructor(
    public cb: (entries: Array<Partial<IntersectionObserverEntry>>) => void,
    public options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  fire(isIntersecting: boolean) {
    this.cb([{ isIntersecting }]);
  }
}

/** Stubs the element geometry: `top` relative to the 768px jsdom viewport. */
function stubRect(top: number, height = 200) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + height,
    height,
    width: 300,
    left: 0,
    right: 300,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
}

let mounts = 0;
function MountCounter() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <span data-testid="child">Isi</span>;
}

beforeEach(() => {
  FakeObserver.instances = [];
  mounts = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const BELOW_FOLD = 2000;

describe("FadeContent static paths", () => {
  it("server output is the plain, fully visible element", () => {
    stubMatchMedia(false);
    const html = renderToString(
      <FadeContent as="section" className="box" data-reveal="x">
        <p>Isi</p>
      </FadeContent>,
    );
    expect(html).toMatch(/^<section class="box" data-reveal="x">/);
    expect(html).toContain("<p>Isi</p>");
    expect(html).not.toContain("opacity");
    expect(html).not.toContain("style=");
  });

  it("stays static under reduced motion and creates no observer", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stubMatchMedia(true);
    stubRect(BELOW_FOLD);
    const { container } = render(
      <FadeContent>
        <MountCounter />
      </FadeContent>,
    );
    expect(FakeObserver.instances).toHaveLength(0);
    expect(container.firstElementChild?.getAttribute("style")).toBeNull();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("stays static when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    stubMatchMedia(false);
    stubRect(BELOW_FOLD);
    const { container } = render(
      <FadeContent>
        <MountCounter />
      </FadeContent>,
    );
    expect(container.firstElementChild?.getAttribute("style")).toBeNull();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("stays static when matchMedia is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    vi.stubGlobal("matchMedia", undefined);
    stubRect(BELOW_FOLD);
    const { container } = render(
      <FadeContent>
        <MountCounter />
      </FadeContent>,
    );
    expect(FakeObserver.instances).toHaveLength(0);
    expect(container.firstElementChild?.getAttribute("style")).toBeNull();
  });

  it("stays static when the element is already in the viewport", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stubMatchMedia(false);
    stubRect(100);
    const { container } = render(
      <FadeContent>
        <MountCounter />
      </FadeContent>,
    );
    expect(FakeObserver.instances).toHaveLength(0);
    expect(container.firstElementChild?.getAttribute("style")).toBeNull();
    expect(mounts).toBe(1);
  });

  it("stays static when the element has no height", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stubMatchMedia(false);
    stubRect(BELOW_FOLD, 0);
    const { container } = render(
      <FadeContent>
        <MountCounter />
      </FadeContent>,
    );
    expect(FakeObserver.instances).toHaveLength(0);
    expect(container.firstElementChild?.getAttribute("style")).toBeNull();
  });

  it("stays visible if the observer cannot be attached", () => {
    class Throwing extends FakeObserver {
      observe = vi.fn(() => {
        throw new Error("nope");
      });
    }
    vi.stubGlobal("IntersectionObserver", Throwing);
    stubMatchMedia(false);
    stubRect(BELOW_FOLD);
    const { container } = render(
      <FadeContent>
        <MountCounter />
      </FadeContent>,
    );
    expect(container.firstElementChild?.getAttribute("style")).toBeNull();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});

describe("FadeContent below the fold", () => {
  function setup(props: { blur?: boolean; duration?: number; threshold?: number } = {}) {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stubMatchMedia(false);
    stubRect(BELOW_FOLD);
    const utils = render(
      <FadeContent className="box" data-testid="fade" {...props}>
        <MountCounter />
      </FadeContent>,
    );
    return { ...utils, el: screen.getByTestId("fade") };
  }

  it("arms: hidden, shifted and blurred, with an observer on the element", () => {
    const { el } = setup({ threshold: 0.3 });
    expect(FakeObserver.instances).toHaveLength(1);
    const observer = FakeObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(el);
    expect(observer.options?.threshold).toBe(0.3);
    expect(el.style.opacity).toBe("0");
    expect(el.style.transform).toBe("translateY(16px)");
    expect(el.style.filter).toBe("blur(8px)");
    expect(el).toHaveClass("box");
    expect(el).not.toHaveAttribute("aria-hidden");
    // Children are present in the DOM while armed (off-screen, not removed).
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  it("omits the blur when blur={false}", () => {
    const { el } = setup({ blur: false });
    expect(el.style.opacity).toBe("0");
    expect(el.style.filter).toBe("");
  });

  it("caps the threshold for a section taller than the viewport", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stubMatchMedia(false);
    stubRect(BELOW_FOLD, 10000);
    render(
      <FadeContent>
        <MountCounter />
      </FadeContent>,
    );
    expect(FakeObserver.instances[0].options?.threshold).toBeLessThan(0.15);
  });

  it("ignores a non-intersecting callback", () => {
    const { el } = setup();
    act(() => FakeObserver.instances[0].fire(false));
    expect(el.style.opacity).toBe("0");
    expect(FakeObserver.instances[0].disconnect).not.toHaveBeenCalled();
    expect(mounts).toBe(1);
  });

  it("on intersect: disconnects, remounts children once, transitions to visible, then drops its styles", () => {
    vi.useFakeTimers();
    const { el } = setup({ duration: 0.4 });
    const observer = FakeObserver.instances[0];

    act(() => observer.fire(true));
    expect(observer.disconnect).toHaveBeenCalled();
    expect(mounts).toBe(2); // fresh client mount of the children
    expect(el.style.opacity).toBe("1");
    expect(el.style.transform).toBe("translateY(0)");
    expect(el.style.filter).toBe("blur(0px)");
    expect(el.style.transition).toContain("opacity 0.4s");
    expect(el.style.willChange).toContain("opacity");

    // A second callback (stale observer) does not remount again.
    act(() => observer.fire(true));
    expect(mounts).toBe(2);

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(el.style.cssText).toBe(""); // no residual transform, filter or will-change
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(mounts).toBe(2);
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = setup();
    unmount();
    expect(FakeObserver.instances[0].disconnect).toHaveBeenCalled();
  });
});

describe("FadeContent hydration", () => {
  it("hydrates the server markup untouched, then arms once it knows it is below the fold", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stubMatchMedia(false);
    stubRect(BELOW_FOLD);
    const tree = (
      <FadeContent as="section" data-testid="fade">
        <MountCounter />
      </FadeContent>
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(tree);
    const section = container.firstElementChild as HTMLElement;
    expect(section.getAttribute("style")).toBeNull();

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, tree);
    });
    expect(errors).not.toHaveBeenCalled();
    expect(container.firstElementChild).toBe(section); // adopted, not replaced
    expect(section.style.opacity).toBe("0");
    expect(FakeObserver.instances).toHaveLength(1);

    act(() => FakeObserver.instances[0].fire(true));
    expect(mounts).toBe(2); // hydration mount + the reveal remount
    expect(section.style.opacity).toBe("1");

    act(() => root.unmount());
    container.remove();
  });
});
