"use client";

// Pattern after React Bits' AnimatedContent / AnimatedList staggered reveals (DavidHDev/react-bits @ e1bbb696,
// MIT + Commons Clause). Not a verbatim port: rewritten on framer-motion variants with a capped total delay.
// See docs/cycles/2026-10-08-pendaftaran-photo-consent-motion.md.

import { motion } from "framer-motion";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const subscribeNoop = () => () => {};

/** Set by <Stagger>; a <StaggerItem> outside one (or in a static Stagger) renders a plain element. */
const StaggerContext = createContext(false);

const EASE = [0.22, 1, 0.36, 1] as const;
const MAX_TOTAL_S = 0.5;
const MAX_STEP_S = 0.04;

const MOTION_LIST = { ol: motion.ol, ul: motion.ul, div: motion.div } as const;
const MOTION_ITEM = { li: motion.li, div: motion.div } as const;

/**
 * Extra attributes forwarded onto the rendered element (`data-*`, `aria-*`, `id`, `role`, ...). Anything
 * that framer-motion also owns (style, drag/animation handlers) is left out on purpose.
 */
type ForwardedProps = Omit<
  HTMLAttributes<HTMLElement>,
  "className" | "children" | "style" | "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragStart" | "onDragEnd"
>;

const listVariants = (step: number) => ({
  hidden: {},
  show: { transition: { staggerChildren: step } },
});
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE } },
};

/**
 * Container for a staggered reveal. Each <StaggerItem> child fades in and rises 8px; the per-item delay is
 * `min(0.04, 0.5 / count)` seconds, so the item delays total at most ~0.5s however long the list is (each item then takes 0.25s to settle).
 * `count` must match the number of items, or the cap is exceeded.
 * Plays once, on mount.
 *
 * Content can never be left invisible: the decision to animate is made once per mount, and it is *off* on
 * the server, during hydration, under reduced motion and when `matchMedia` is missing. In those cases plain
 * elements are rendered (same tag, same className, normal list semantics) with no motion props. Only a
 * fresh client mount, where JS is by definition running, starts hidden and reveals. A hard load straight
 * onto a page that contains a Stagger therefore shows its content immediately instead of animating.
 *
 * `count` should be the number of <StaggerItem>s. Keep `as="ol"|"ul"` paired with `StaggerItem as="li"`.
 * `enabled={false}` renders the plain static element, so a parent can play the reveal only once. The
 * decision is captured on mount, like the other gates: flipping `enabled` later does not replay or cancel.
 * Extra props (`data-*`, `aria-*`, `id`) are forwarded onto the element.
 */
export function Stagger({
  as = "div",
  count,
  className,
  enabled = true,
  children,
  ...rest
}: {
  as?: "ol" | "ul" | "div";
  count: number;
  className?: string;
  /** Default true. When false the list renders as plain elements (no motion props). */
  enabled?: boolean;
  children: ReactNode;
} & ForwardedProps) {
  // true during SSR and hydration, false on a fresh client mount. Captured on first render only.
  const isHydrating = useSyncExternalStore(
    subscribeNoop,
    () => false,
    () => true,
  );
  const reduced = usePrefersReducedMotion();
  const [animating] = useState(() => enabled && !isHydrating && !reduced);

  if (!animating) {
    const Tag = as;
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  const step = Math.min(MAX_STEP_S, MAX_TOTAL_S / Math.max(count, 1));
  const MotionTag = MOTION_LIST[as];
  return (
    <StaggerContext.Provider value={true}>
      <MotionTag className={className} variants={listVariants(step)} initial="hidden" animate="show" {...rest}>
        {children}
      </MotionTag>
    </StaggerContext.Provider>
  );
}

/** One revealed child of <Stagger>. Plain element when the parent is static. Extra props are forwarded. */
export function StaggerItem({
  as = "div",
  className,
  children,
  ...rest
}: {
  as?: "li" | "div";
  className?: string;
  children: ReactNode;
} & ForwardedProps) {
  const animating = useContext(StaggerContext);

  if (!animating) {
    const Tag = as;
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  const MotionTag = MOTION_ITEM[as];
  return (
    <MotionTag className={className} variants={itemVariants} {...rest}>
      {children}
    </MotionTag>
  );
}
