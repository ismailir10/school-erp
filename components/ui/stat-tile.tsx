import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatTone = "default" | "muted" | "positive" | "warning" | "critical";

// The `-text` variants, not the raw fills: --status-present etc. are fill
// colours that fail contrast as small text on white (see the note in
// globals.css above --status-present-text).
const TONE_CLASS: Record<StatTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  positive: "text-status-present-text",
  warning: "text-status-leave-text",
  critical: "text-destructive",
};

const VALUE_SIZE = {
  sm: "text-base",
  md: "text-h2",
  lg: "text-display",
} as const;

const TILE_CLASS = "relative isolate block min-w-0 overflow-hidden rounded-lg border bg-card p-3 text-left";
const LINK_TILE_CLASS =
  "outline-none transition-shadow hover:shadow-sm hover:ring-1 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The compact "label above a number" tile every dashboard, summary rail and
 * trend strip shares. `StatCard` (icon, count-up, spotlight) stays the card for
 * a list page's KPI row; this is the quieter tile for everything smaller.
 *
 * Pass `href` and the whole tile is the link (put the screen-reader sentence in
 * `ariaLabel`). `mono` sets the figure in the admin KPI face — leave it off for
 * text values like "5 thn 3 bln".
 */
export function StatTile({
  label,
  value,
  hint,
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
  const body = (
    <>
      <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        // Size is a plain string, not an argument to `cn`: tailwind-merge doesn't know
        // our `text-display` / `text-h2` size tokens and would drop them as a
        // conflicting text *colour* next to `text-foreground`. Only the colour merges.
        className={`mt-1 font-bold leading-tight tabular-nums ${VALUE_SIZE[size]} ${mono ? "font-currency" : ""} ${cn(TONE_CLASS[tone], valueClassName)}`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-small text-muted-foreground">{hint}</p>}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={cn(TILE_CLASS, LINK_TILE_CLASS, className)}>
        {body}
      </Link>
    );
  }
  return (
    <div aria-label={ariaLabel} className={cn(TILE_CLASS, className)}>
      {body}
    </div>
  );
}
