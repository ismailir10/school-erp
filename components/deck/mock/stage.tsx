"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * A fixed-size design canvas for the deck's mock screens, zoomed to the width it is given.
 *
 * The mocks are laid out in real CSS pixels with the app's own classes (text-sm, rounded-xl, the status tokens) so
 * they read as Talib, then scaled as one piece. `zoom` rather than `transform`, for the same reason as FitHeight:
 * it takes part in layout, so the stage's box is exactly the scaled picture. The 0.72 starting zoom is a guess for
 * the server render; the layout effect corrects it before the first paint.
 *
 * Decorative: the slide text carries the meaning, so the whole stage is hidden from assistive tech and inert.
 */
export function Stage({
  width = 680,
  height = 500,
  label,
  children,
}: {
  width?: number;
  height?: number;
  /** Names the mock in the DOM, for tests and for finding it in devtools. */
  label?: string;
  children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = outer.current;
    const canvas = inner.current;
    if (!box || !canvas) return;
    function fit() {
      if (!box || !canvas || box.clientWidth <= 0) return;
      canvas.style.zoom = String(box.clientWidth / width);
    }
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={outer}
      aria-hidden="true"
      inert
      data-art={label}
      className="pointer-events-none relative w-full select-none"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <div
        ref={inner}
        className="absolute left-0 top-0 overflow-hidden font-sans text-foreground"
        style={{ width, height, zoom: 0.72 }}
      >
        {children}
      </div>
    </div>
  );
}
