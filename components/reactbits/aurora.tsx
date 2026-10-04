// Adapted from React Bits — src/ts-tailwind/Backgrounds/Aurora (DavidHDev/react-bits @ e1bbb696,
// MIT + Commons Clause). Upstream is a WebGL (ogl) shader; this is a dependency-free CSS port:
// three soft radial-gradient bands drifting on transform-only keyframes. Server-rendered, static under
// prefers-reduced-motion, brand-token colours only. See docs/cycles/2026-10-04-login-aurora-background.md.
import { cn } from "@/lib/utils"

// Elliptical bands (wider than tall) read as aurora; round blobs read as bokeh. Colour is mixed from
// brand tokens at 28/10/10% peak. Worst case, all three overlapping at peak on the login panel's
// --secondary, still measures 4.76:1 for --muted-foreground text and 3.12:1 for the --primary-text
// icons (AA text / non-text floors), so the bands can drift anywhere without hurting legibility.
// Raising a peak means re-running that maths.
const BANDS = [
  {
    key: "a",
    className:
      "-top-[18%] -left-[22%] h-[62%] w-[95%] motion-safe:animate-aurora-a",
    colour: "var(--primary)",
    peak: 28,
  },
  {
    key: "b",
    className:
      "top-[28%] -right-[28%] h-[58%] w-[90%] motion-safe:animate-aurora-b",
    colour: "var(--primary-text)",
    peak: 10,
  },
  {
    key: "c",
    className:
      "-bottom-[22%] left-[6%] h-[52%] w-[85%] motion-safe:animate-aurora-c",
    colour: "var(--celebration-gold)",
    peak: 10,
  },
] as const

/**
 * Decorative aurora backdrop, dropped inside any surface.
 *
 * The PARENT element must be `relative isolate overflow-hidden` (callers add those classes).
 * `isolate` makes the `-z-10` layer paint above the parent's background but beneath its content,
 * so text contrast is decided by the peak tint above, not by this layer's stacking.
 *
 * Only `transform` animates (compositor-only, no layout or paint per frame). Smooth curves only:
 * no polygons, stars or tiled shapes.
 */
export function Aurora({
  className,
  paused = false,
}: {
  className?: string
  /**
   * Freezes the bands in place. The drift runs for as long as the page is open, which WCAG 2.2.2
   * (Pause, Stop, Hide) requires the user to be able to stop; the host screen supplies the control.
   */
  paused?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="aurora"
      data-paused={paused}
      className={cn(
        "group/aurora pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      {BANDS.map(({ key, className: band, colour, peak }) => (
        <span
          key={key}
          data-band={key}
          className={cn(
            "absolute block rounded-[50%] will-change-transform group-data-[paused=true]/aurora:[animation-play-state:paused]",
            band,
          )}
          style={{
            background: `radial-gradient(closest-side, color-mix(in oklch, ${colour} ${peak}%, transparent), transparent)`,
          }}
        />
      ))}
    </span>
  )
}
