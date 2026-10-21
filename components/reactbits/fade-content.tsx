"use client";

// Adapted from React Bits — src/ts-tailwind/Animations/FadeContent (DavidHDev/react-bits @ e1bbb696,
// MIT + Commons Clause). Upstream drives a GSAP ScrollTrigger and starts hidden; this is a
// dependency-free port: IntersectionObserver plus inline CSS transitions, and it is only ever hidden
// on the client, after hydration, while the element is still below the viewport.
// See docs/cycles/2026-10-21-dashboard-analytics.md.

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const RISE_PX = 16;
const BLUR_PX = 8;
/** Largest share of the viewport an element must show before it counts as revealed (tall sections). */
const MAX_VIEWPORT_SHARE = 0.9;
/** Slack after the transition ends before the inline styles are dropped. */
const SETTLE_SLACK_MS = 100;

type Phase = "static" | "armed" | "revealing" | "done";

/** Extra attributes forwarded onto the element (`data-*`, `aria-*`, `id`, ...). `style` is owned here. */
type ForwardedProps = Omit<HTMLAttributes<HTMLElement>, "className" | "children" | "style">;

/**
 * Scroll-reveal wrapper: a section that starts below the fold fades in, rises 16px and de-blurs when it
 * scrolls into view, and its children remount at that moment so their own entrance animations (CountUp,
 * Stagger, chart draw-in) play when the user can actually see them. Those only animate on a fresh
 * client mount, which is why a plain scroll-reveal is not enough.
 *
 * Server output, hydration and first client render are the plain element with its children, fully
 * visible (no inline style), so no-JS shows everything. After hydration the decision is made ONCE:
 *   - reduced motion, no IntersectionObserver / matchMedia, zero height, or the element's top is already
 *     inside the viewport: stay static forever (nothing hidden, nothing remounted);
 *   - otherwise the element is below the fold, so it is "armed": opacity 0, translateY(16px) and
 *     blur(8px) are applied (off-screen, so the flip is invisible) and an IntersectionObserver waits.
 *     On the first intersection it transitions to opacity 1 / y 0 / blur 0 over `duration`, disconnects,
 *     and bumps a key around the children (a Fragment, no extra DOM) so they remount exactly once.
 *     The inline styles are dropped when the transition ends, leaving no transform or filter behind.
 *
 * Content cannot be stranded invisible: the armed path is only entered after the observer was created
 * and attached without throwing, and the observer's threshold is capped so an element taller than the
 * viewport can still reach it. Only transform / opacity / filter change, so there is no layout shift;
 * `will-change` is set only while the transition runs. `aria-hidden` is never set.
 */
export function FadeContent({
  as = "div",
  className,
  blur = true,
  duration = 0.6,
  threshold = 0.15,
  children,
  ...rest
}: {
  as?: "div" | "section";
  className?: string;
  /** Default true. Adds a blur(8px) to the hidden state. */
  blur?: boolean;
  /** Seconds. Default 0.6. */
  duration?: number;
  /** Visible share of the element that triggers the reveal. Default 0.15. */
  threshold?: number;
  children: ReactNode;
} & ForwardedProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<Phase>("static");
  const [mountKey, setMountKey] = useState(0);

  // Decide once, on the client, after hydration.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0 || rect.top < window.innerHeight) return;

    // A section taller than ~1.1 viewports can never show `threshold` of itself; cap it.
    const effective = Math.min(threshold, (window.innerHeight * MAX_VIEWPORT_SHARE) / rect.height);
    let observer: IntersectionObserver | undefined;
    let revealed = false;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          if (revealed || !entries.some((entry) => entry.isIntersecting)) return;
          revealed = true; // remount exactly once, even if a queued callback arrives after disconnect
          observer?.disconnect();
          setPhase("revealing");
          setMountKey((key) => key + 1);
        },
        { threshold: effective },
      );
      observer.observe(el);
    } catch {
      observer?.disconnect();
      return; // never armed, so never hidden
    }
    setPhase("armed");
    return () => observer?.disconnect();
    // threshold is read once, like the other gates: changing it later does not re-arm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop the inline styles once the transition has finished.
  useEffect(() => {
    if (phase !== "revealing") return;
    const timer = setTimeout(() => setPhase("done"), duration * 1000 + SETTLE_SLACK_MS);
    return () => clearTimeout(timer);
  }, [phase, duration]);

  let style: CSSProperties | undefined;
  if (phase === "armed") {
    style = {
      opacity: 0,
      transform: `translateY(${RISE_PX}px)`,
      ...(blur ? { filter: `blur(${BLUR_PX}px)` } : null),
    };
  } else if (phase === "revealing") {
    style = {
      opacity: 1,
      transform: "translateY(0)",
      ...(blur ? { filter: "blur(0px)" } : null),
      transition: [
        `opacity ${duration}s ${EASE}`,
        `transform ${duration}s ${EASE}`,
        ...(blur ? [`filter ${duration}s ${EASE}`] : []),
      ].join(", "),
      willChange: blur ? "opacity, transform, filter" : "opacity, transform",
    };
  }

  const Tag = as as ElementType<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;
  return (
    <Tag ref={ref} className={className} style={style} {...rest}>
      <Fragment key={mountKey}>{children}</Fragment>
    </Tag>
  );
}
