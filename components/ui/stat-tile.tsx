import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CountUp } from "@/components/reactbits/count-up";
import { fluidFigureClass, type FluidCap } from "@/lib/fluid-figure";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "muted" | "positive" | "warning" | "critical";

// The `-text` variants, not the raw fills: --status-present etc. are fill
// colours that fail contrast as small text on white (see the note in
// globals.css above --status-present-text).
const TONE_CLASS: Record<StatTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  positive: "text-status-present-text",
  warning: "text-warning-text",
  critical: "text-destructive",
};

// Routine icons stay quiet; explicit semantic tones carry meaningful states.
const CHIP_CLASS: Record<StatTone, string> = {
  default: "bg-muted text-muted-foreground",
  muted: "bg-muted text-muted-foreground",
  positive: "bg-success-subtle text-success-text",
  warning: "bg-warning-subtle text-warning-text",
  critical: "bg-destructive-subtle text-destructive-text",
};

const VALUE_SIZE = {
  sm: "text-base",
  md: "text-h2",
  lg: "text-display",
} as const;

// The cap a `mono` (currency/count) figure scales up to; matches VALUE_SIZE.
const FLUID_CAP: Record<keyof typeof VALUE_SIZE, FluidCap> = { sm: "base", md: "h2", lg: "display" };

const TILE_CLASS = "relative isolate flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card p-3 text-left";
const LINK_TILE_CLASS =
  "focus-visible:focus-outline motion-safe:transition-shadow hover:shadow-raised";

/**
 * The compact "label above a number" tile every dashboard, summary rail and
 * trend strip and list-page KPI row shares. Pass `icon` for a tinted chip at the
 * top right; a numeric `value` counts up (reduced motion: static).
 *
 * Pass `href` and the whole tile is the link (put the screen-reader sentence in
 * `ariaLabel`). `mono` sets the figure in the admin KPI face — leave it off for
 * text values like "5 thn 3 bln".
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  size = "md",
  mono = false,
  valueClassName,
  href,
  ariaLabel,
  className,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Tinted chip at the tile's top right. */
  icon?: LucideIcon;
  tone?: StatTone;
  size?: keyof typeof VALUE_SIZE;
  mono?: boolean;
  /** For a status colour that isn't one of the tones (e.g. `text-status-late-text`). */
  valueClassName?: string;
  href?: string;
  ariaLabel?: string;
  className?: string;
  /** Extra content under the hint (a retry button, a hover effect). */
  children?: ReactNode;
}) {
  const fluid = mono && (typeof value === "string" || typeof value === "number");
  const figureClass = fluid
    ? `font-currency whitespace-nowrap ${fluidFigureClass(String(value).length, FLUID_CAP[size])}`
    : `wrap-anywhere ${VALUE_SIZE[size]} ${mono ? "font-currency" : ""}`;
  // `@container`: the tile's content box is the width a fluid figure is sized from.
  const containerClass = fluid ? "@container" : "";
  const tileClass = cn(TILE_CLASS, containerClass, className);
  const labelP = (
    <p className="min-w-0 text-caption font-semibold uppercase tracking-wider text-muted-foreground @max-[7rem]:tracking-normal @max-[7rem]:text-[0.625rem]">{label}</p>
  );
  const labelEl = Icon ? (
    <div className="flex items-start justify-between gap-2">
      {labelP}
      <span
        data-testid="stat-tile-icon"
        aria-hidden="true"
        className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", CHIP_CLASS[tone])}
      >
        <Icon className="size-4" />
      </span>
    </div>
  ) : (
    labelP
  );
  const body = (
    <>
      {labelEl}
      <p
        // A `mono` figure (money, counts) never wraps: it is sized from the tile's width
        // with container-query units (lib/fluid-figure.ts), so "Rp 10.000.000.000" in a
        // half-width tile shrinks to fit instead of breaking mid-number or being clipped.
        // Other values (text like "5 thn 3 bln") keep the fixed size and `wrap-anywhere`,
        // because the tile clips overflow (Spotlight glow).
        // Size is a plain string, not an argument to `cn`: tailwind-merge doesn't know
        // our `text-display` / `text-h2` size tokens and would drop them as a
        // conflicting text *colour* next to `text-foreground`. Only the colour merges.
        className={`mt-auto pt-1 font-bold leading-tight tabular-nums ${figureClass} ${cn(TONE_CLASS[tone], valueClassName)}`}
      >
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </p>
      {hint && <p className="mt-0.5 text-small text-muted-foreground">{hint}</p>}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={cn(TILE_CLASS, LINK_TILE_CLASS, containerClass, className)}>
        {body}
      </Link>
    );
  }
  return (
    <div aria-label={ariaLabel} className={tileClass}>
      {body}
    </div>
  );
}
