"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Keeps a slide on one screen when the deck is presented (desktop widths).
 *
 * A slide is laid out at its natural size, measured, then scaled with CSS `zoom` so the whole thing,
 * type and drawing together, fits the room between the header and the progress rail. It shrinks on a
 * 1280×720 projector and grows a touch on a large display. `zoom` (unlike `transform`) takes part in
 * layout, so nothing overflows and nothing needs a spacer. Below 1024px (phones, tablets held upright)
 * it does nothing: those screens scroll inside the slide instead, with the type at its real size.
 */
const MIN_ZOOM = 0.72;
const MAX_ZOOM = 1.12;

export function FitHeight({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content || typeof window.matchMedia !== "function") return;
    const scroller = box.closest<HTMLElement>("[data-deck-scroll]");

    function fit() {
      if (!box || !content) return;
      if (!window.matchMedia("(min-width: 1024px)").matches || !scroller) {
        content.style.zoom = "";
        return;
      }
      content.style.zoom = "1";
      const natural = content.getBoundingClientRect().height;
      const room = scroller.clientHeight;
      if (natural <= 0 || room <= 0) return;
      const wide = window.innerWidth >= 1600;
      const z = Math.min(wide ? MAX_ZOOM : 1, Math.max(MIN_ZOOM, (room * 0.94) / natural));
      content.style.zoom = String(Math.round(z * 100) / 100);
    }

    fit();
    if (typeof ResizeObserver === "undefined") return;
    // Observe the scroller, not the content: zooming resizes the content, and watching it would loop.
    const ro = new ResizeObserver(fit);
    if (scroller) ro.observe(scroller);
    // The headline serif swaps in after first paint and changes line breaks; measure again then.
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outer} className="flex min-h-full w-full items-center">
      <div ref={inner} className="w-full">
        {children}
      </div>
    </div>
  );
}
