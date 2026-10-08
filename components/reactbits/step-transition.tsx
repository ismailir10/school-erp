"use client";

// Pattern after React Bits' AnimatedContent / Stepper content transitions (DavidHDev/react-bits @ e1bbb696,
// MIT + Commons Clause) — a keyed fade + directional slide. Not a verbatim port: rewritten on framer-motion
// as an enter-only transition with no AnimatePresence. See docs/cycles/2026-10-08-pendaftaran-photo-consent-motion.md.

import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const OFFSET_PX = 12;

/**
 * Enter-only step transition: when `stepKey` changes, the new content fades in and slides 12px from the
 * direction of travel (`1` = forward, from the right; `-1` = back, from the left) over ~200ms.
 *
 * - **No exit animation, no AnimatePresence.** The old step unmounts and the new one mounts in the same
 *   commit, so the DOM swap is immediate and focus / scroll / test queries see the new step synchronously.
 * - **Re-keys the subtree.** Content under a changed `stepKey` remounts (its local state resets).
 * - **First render never animates** (`initial={false}` until the key first changes), so server HTML and
 *   hydration are never hidden. Only opacity and transform are animated.
 * - `data-direction` ("1" / "-1") is always rendered so tests and styling can read the direction of travel
 *   without sampling a mid-flight transform.
 * - **Reduced motion** (and server / hydration, see `usePrefersReducedMotion`) passes no motion props, so
 *   the `motion.div` renders a plain `<div>` with no inline styles. The element type is the same in every
 *   mode on purpose: swapping a plain div for a motion div after hydration would remount the children.
 */
export function StepTransition({
  stepKey,
  direction,
  className,
  children,
}: {
  stepKey: string | number;
  direction: 1 | -1;
  className?: string;
  children: ReactNode;
}) {
  const reduced = usePrefersReducedMotion();

  // Flips to true the first time stepKey differs from the one we mounted with, in the same render, so the
  // new keyed div already mounts hidden. Stays true afterwards (returning to the first step animates too).
  const [mountKey] = useState(stepKey);
  const [navigated, setNavigated] = useState(false);
  if (!navigated && stepKey !== mountKey) setNavigated(true);

  if (reduced) {
    return (
      <motion.div key={stepKey} className={className} data-direction={direction}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      key={stepKey}
      className={className}
      data-direction={direction}
      initial={navigated ? { opacity: 0, x: OFFSET_PX * direction } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
