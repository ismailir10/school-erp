"use client";

// Adapted from React Bits — src/ts-tailwind/TextAnimations/CountUp (DavidHDev/react-bits @ e1bbb696,
// MIT + Commons Clause). Rewritten for SSR-correct output, reduced motion and screen readers.
// See docs/cycles/2026-09-30-reactbits-motion.md.

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EASE_EMPHASIZED } from "@/lib/motion";

const subscribeNoop = () => () => {};

/** Decimal places of `value` as written by String(value); 0 for integers and exponent forms. */
function decimalPlaces(value: number): number {
  const text = String(value);
  if (text.includes("e")) return 0;
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(text.length - dot - 1, 20);
}

/**
 * Counts up from 0 to `value` the first time it scrolls into view.
 *
 * Server output, hydration, reduced motion and browsers without IntersectionObserver all render
 * the bare final number (no wrapper element), so the text matches `{value}` exactly. Only a fresh
 * client mount animates; screen readers get the final value from an sr-only span while it runs.
 */
export function CountUp({
  value,
  duration = 0.9,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  // true during SSR and hydration, false on a fresh client mount. Captured on first render only.
  const isHydrating = useSyncExternalStore(
    subscribeNoop,
    () => false,
    () => true,
  );
  // Decided once per mount. framer-motion's useReducedMotion caches its answer per module load,
  // so read the media query directly: a user who toggles the setting gets it on the next mount.
  const [animating] = useState(
    () =>
      !isHydrating &&
      typeof IntersectionObserver !== "undefined" &&
      typeof window.matchMedia === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const ref = useRef<HTMLSpanElement>(null);
  const decimals = decimalPlaces(value);
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => v.toFixed(decimals));
  const inView = useInView(ref, { once: true });

  // The value the last count landed on. While it equals `value`, render the bare text node so
  // textContent and copy-paste read "12", not the ticking span plus its sr-only twin. A new value
  // (e.g. a 0 placeholder replaced by fetched data) re-enters the animated path and counts from
  // the previous number to the new one.
  const [settled, setSettled] = useState<number | null>(null);

  useEffect(() => {
    if (!animating || !inView || settled === value) return;
    const controls = animate(mv, value, {
      duration,
      ease: EASE_EMPHASIZED,
      onComplete: () => setSettled(value),
    });
    return () => controls.stop();
  }, [animating, inView, settled, value, duration, mv]);

  if (!animating || settled === value) return <>{String(value)}</>;

  return (
    <>
      <motion.span aria-hidden="true" ref={ref} className={className}>
        {rounded}
      </motion.span>
      <span className="sr-only">{String(value)}</span>
    </>
  );
}
