"use client";

// Pattern after React Bits' animated SVG path / check-draw micro-interactions (DavidHDev/react-bits @ e1bbb696,
// MIT + Commons Clause). Not a verbatim port: a small circle + tick drawn with framer-motion pathLength.
// See docs/cycles/2026-10-08-pendaftaran-photo-consent-motion.md.

import { motion } from "framer-motion";
import { useState, useSyncExternalStore } from "react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
import { EASE_EMPHASIZED } from "@/lib/motion";

const subscribeNoop = () => () => {};

const CIRCLE = { cx: 12, cy: 12, r: 10 } as const;
const TICK = "M7.5 12.5l3 3 6-6.5";
const EASE = EASE_EMPHASIZED;

/**
 * A circle with a check mark that draws itself in (circle ~0.45s, tick starting ~0.2s later).
 *
 * Decorative: `aria-hidden`, not focusable, stroked in `currentColor`. Pair it with visible text or an
 * sr-only label for the accessible name. Works at 16–20px for an inline "saved" state (raise `strokeWidth`
 * a little there if the line looks thin; units are in a 24-unit viewBox).
 *
 * Server output, hydration, reduced motion and browsers without `matchMedia` render the fully drawn
 * static icon. Only a fresh client mount animates (e.g. a "saved" state that appears after an action).
 */
export function DrawCheck({
  size = 44,
  className,
  strokeWidth = 2,
}: {
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  // true during SSR and hydration, false on a fresh client mount. Captured on first render only.
  const isHydrating = useSyncExternalStore(
    subscribeNoop,
    () => false,
    () => true,
  );
  const reduced = usePrefersReducedMotion();
  const [animating] = useState(() => !isHydrating && !reduced);

  const svgProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
    focusable: false,
  } as const;

  if (!animating) {
    return (
      <svg {...svgProps}>
        <circle {...CIRCLE} />
        <path d={TICK} />
      </svg>
    );
  }

  return (
    <svg {...svgProps}>
      <motion.circle
        {...CIRCLE}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: EASE }}
      />
      <motion.path
        d={TICK}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.25, delay: 0.2, ease: EASE }}
      />
    </svg>
  );
}
