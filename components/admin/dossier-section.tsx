"use client";

import { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Anchored, collapsible section for the Admin Detail "dossier" layout — one
 * long scroll of sections instead of tabs, so nothing about the entity is
 * hidden behind a click the admin has to know to make.
 *
 * Open state is **controlled by the page**, not held here. The anchor nav needs
 * to expand a collapsed section before scrolling to it; that is only possible
 * if one owner holds the map of section id → open.
 *
 * Entity-agnostic on purpose — the wali/household view is expected to reuse it.
 */

export type DossierSectionDef = { id: string; label: string };

export function DossierSection({
  id,
  label,
  badge,
  actions,
  open,
  onOpenChange,
  keepMounted,
  children,
}: {
  id: string;
  label: string;
  /** Glanceable summary shown in the collapsed header, e.g. "2 wali". */
  badge?: ReactNode;
  /** Rendered outside the trigger — must not be a nested interactive element. */
  actions?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Keep the panel's children mounted while collapsed.
   *
   * Off by default: most sections render eagerly and unmounting a closed one
   * is what keeps the mobile accordion cheap. Turn it on for a section whose
   * content holds state worth surviving a collapse — a fetch already paid for,
   * or the week an admin navigated to. Without it, collapsing and re-expanding
   * silently re-requests and resets.
   */
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const contentId = `${id}-content`;
  return (
    // scroll-mt clears the sticky anchor nav so a jumped-to heading is not
    // parked underneath it.
    <Card id={id} className="mb-3 scroll-mt-28 p-0">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex items-center justify-between gap-2 px-card">
          <CollapsibleTrigger
            aria-controls={contentId}
            className="group flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ChevronDown
              size={15}
              aria-hidden="true"
              className={cn(
                "shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                !open && "-rotate-90",
              )}
            />
            <h2 className="truncate text-sm font-semibold text-foreground">{label}</h2>
            {badge}
          </CollapsibleTrigger>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        <CollapsibleContent id={contentId} keepMounted={keepMounted}>
          <div className="border-t px-card py-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/**
 * Sticky in-page nav over the sections. Clicking expands the target (a
 * collapsed section cannot be scrolled to meaningfully) and then scrolls.
 *
 * `lg`+ only (T1, cycle 2026-09-26, admin-ui-standard-c1). Below `lg`,
 * `DossierSection`'s own collapsible headers already list every section as
 * you scroll past them — showing this jump strip too was the same list
 * twice. From `lg` it still wraps rather than scrolls: increment 2 took the
 * dossier from 8 sections to 11, and a single scrolling row at 1440 pushed
 * the last two off the right edge with no scrollbar to hint they were there
 * — the nav silently stopped listing every section, which is the one job it
 * has.
 */
export function DossierNav({
  sections,
  onJump,
}: {
  sections: DossierSectionDef[];
  onJump: (id: string) => void;
}) {
  return (
    <nav
      aria-label="Bagian halaman"
      className="sticky top-0 z-10 mb-3 hidden overflow-x-visible rounded-lg border bg-card/95 p-1.5 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:block"
    >
      <ul className="flex min-w-0 items-center gap-1 flex-wrap">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onJump(s.id)}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-small text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
