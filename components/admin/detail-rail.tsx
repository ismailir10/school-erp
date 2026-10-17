"use client";

import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { cn } from "@/lib/utils";

/**
 * Right-rail primitives for the Admin Detail recipe (`patterns.md` Recipe 2),
 * which calls for a metadata aside next to the main column. Until the student
 * dossier landed, no detail page actually had one.
 *
 * Deliberately entity-agnostic: the student page is the first consumer, and the
 * wali/household view is expected to reuse these verbatim rather than grow a
 * parallel set. Nothing here knows what a student is.
 *
 * Layout contract — the rail is a desktop affordance. Below `lg` it collapses
 * into normal document flow above the sections, because a sticky sidebar on a
 * 375px screen is just a block that steals the first viewport.
 */
export function DetailRail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <aside
      aria-label="Ringkasan"
      className={cn("flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start", className)}
    >
      {children}
    </aside>
  );
}

export function RailCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="p-0">
      <div className="border-b px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="px-4 py-3">{children}</div>
      {footer && <div className="border-t px-4 py-2.5">{footer}</div>}
    </Card>
  );
}

export type RailTone = "default" | "positive" | "warning" | "critical";

// The `-text` variants, not the raw fills: --status-present etc. are fill
// colours that fail contrast as small text on white (see the note in
// globals.css above --status-present-text).
const TONE_CLASS: Record<RailTone, string> = {
  default: "text-foreground",
  positive: "text-status-present-text",
  warning: "text-status-leave-text",
  critical: "text-destructive",
};

export type RailItem = {
  label: string;
  value: ReactNode;
  tone?: RailTone;
};

/**
 * Definition list of label → value. `<dl>` rather than a two-column grid of
 * <div>s so a screen reader announces the pairing.
 */
export function RailKV({ items }: { items: RailItem[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-small">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className={cn("text-right font-medium", TONE_CLASS[item.tone ?? "default"])}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type RailTile = {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: RailTone;
  /**
   * Span both columns. For the tile that carries a currency figure — it needs
   * the width, and it keeps an odd tile count from leaving a hole in the grid.
   */
  wide?: boolean;
};

/**
 * Compact numeric tiles. Two columns in the rail on desktop; the same component
 * renders the mobile stat grid, so the numbers a mobile admin sees first are
 * literally the same markup.
 */
export function RailStatTiles({ tiles }: { tiles: RailTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {tiles.map((tile) => (
        <StatTile
          key={tile.label}
          label={tile.label}
          value={tile.value}
          hint={tile.hint}
          tone={tile.tone}
          size="sm"
          className={cn("p-2.5", tile.wide && "col-span-2")}
        />
      ))}
    </div>
  );
}

/**
 * Presence checklist — a plain "is this file on record" list, not a formal
 * required-document policy. Ticks what exists, names what does not, and stops
 * there; deciding which documents are mandatory is a separate decision the
 * school has not made yet.
 */
export function RailChecklist({
  items,
}: {
  items: { label: string; present: boolean }[];
}) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2 text-small">
      {items.map((item) => (
        <li key={item.label} className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
          {item.present ? (
            <span className="shrink-0 font-medium text-status-present-text" aria-label="Sudah ada">
              ✓
            </span>
          ) : (
            <span className="shrink-0 text-xs font-medium text-muted-foreground">Belum</span>
          )}
        </li>
      ))}
    </ul>
  );
}
