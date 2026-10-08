"use client";

// Helper for the motion primitives next to it (StepTransition, Stagger, DrawCheck). Not a React Bits
// port. Reads the media query directly instead of framer-motion's useReducedMotion, which caches its
// answer per module load (learned in docs/cycles/2026-09-30-reactbits-motion.md, same approach as
// CountUp). See docs/cycles/2026-10-08-pendaftaran-photo-consent-motion.md.

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(QUERY);
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  // Safari < 14
  mql.addListener?.(onChange);
  return () => mql.removeListener?.(onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(QUERY).matches;
}

// Server and hydration render the static (reduced) variant, so there is no mismatch and nothing is
// ever hidden in the server HTML. A fresh client mount reads the real value.
const getServerSnapshot = () => true;

/**
 * Whether the user prefers reduced motion. `true` on the server, during hydration, and when
 * `matchMedia` is unavailable (jsdom, very old browsers) — treat `true` as "render static".
 * Live: re-renders when the OS setting changes.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
