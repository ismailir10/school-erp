import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  return <span>{String(usePrefersReducedMotion())}</span>;
}

describe("usePrefersReducedMotion", () => {
  it("is true when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("is true on the server regardless of the media query", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(renderToString(<Probe />)).toContain("true");
  });

  it("reads the real value on the client and follows changes", () => {
    let matches = false;
    let listener: (() => void) | undefined;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => {
        listener = cb;
      },
      removeEventListener: vi.fn(),
    }));
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listener?.();
    });
    expect(result.current).toBe(true);
  });
});
