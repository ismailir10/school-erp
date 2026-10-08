import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// DOM-only setup — loaded by the `jsdom` project only. Anything safe in a bare
// node process belongs in vitest.setup.ts instead.

// testing-library's default asyncUtilTimeout is 1000ms, and it is wall-clock:
// if the runner deschedules the worker mid-`waitFor`, the timeout fires on
// resume before the pending work does. On a contended 4-vCPU CI runner that is
// a coin flip, not a bug — it produced the false `role="alert"` failures on
// the AGE_OUT_OF_RANGE tests. 5s keeps the same semantics with real headroom;
// a condition that never becomes true still fails, just 4s later.
// See docs/cycles/2026-08-22-vitest-flake-fix.md.
configure({ asyncUtilTimeout: 5_000 });

// jsdom does not implement scrollIntoView — stub it globally so components that
// call it on mount (e.g. PortalTabs) don't throw in the test environment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).scrollIntoView = vi.fn();

// jsdom has no Web Animations. Base UI ScrollArea queries subtree animations
// before measuring its thumb; an empty list represents this environment.
// Preserve a native implementation if the environment gains one.
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

// jsdom does not implement matchMedia. framer-motion's `useReducedMotion`
// (PortalBottomNav) subscribes to `(prefers-reduced-motion: reduce)` on mount.
// Default to "no preference" so animated code paths are the ones under test;
// override per-test to assert reduced-motion behaviour.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// jsdom does not implement ResizeObserver. cmdk (<Command>, behind every
// async combobox — StudentPicker, ParentPicker, ClassSectionPicker) constructs
// one on mount and throws without it. Guarded so a real implementation, if one
// ever lands in the environment, wins.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Cleanup after each test
afterEach(() => {
  cleanup();
});
