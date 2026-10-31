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


type DisclosureTriggerProps = {
  contentId: string;
  open: boolean;
  heading: "h2" | "h3";
  label: string;
  badge?: ReactNode;
  summary?: ReactNode;
};

/**
 * The collapsible header every dossier disclosure shares: chevron, label,
 * badge and (only while closed) the one-line summary, all inside one 44px
 * trigger so the summary is part of the trigger's accessible name.
 */
function DisclosureTrigger({ contentId, open, heading: Heading, label, badge, summary }: DisclosureTriggerProps) {
  return (
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
      {/* Wraps instead of truncating: with a count badge and an action beside it,
          a 390px header cut "Daftar Siswa" to "Daftar Si…". The summary joins the
          same wrapping row, so on a phone it drops under the label when it does
          not fit beside it. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <Heading className="min-w-0 text-sm font-semibold text-foreground">{label}</Heading>
        {badge && <span className="shrink-0 whitespace-nowrap">{badge}</span>}
        {!open && summary != null && summary !== false && (
          <span data-slot="dossier-summary" className="min-w-0 text-small font-normal text-muted-foreground">
            {summary}
          </span>
        )}
      </div>
    </CollapsibleTrigger>
  );
}

export function DossierSection({
  id,
  label,
  badge,
  summary,
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
  /**
   * One-line answer shown after the label **only while the section is
   * collapsed**, so a closed section still says what is inside it (e.g.
   * "KTP ada · KK belum ada"). Wraps rather than truncates, and disappears on
   * open because the content itself is then on screen. It sits inside the
   * trigger, so it is part of the trigger's accessible name; nothing extra is
   * announced.
   */
  summary?: ReactNode;
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
          <DisclosureTrigger
            contentId={contentId}
            open={open}
            heading="h2"
            label={label}
            badge={badge}
            summary={summary}
          />
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
 * A group of sub-sections: the five-card dossier the student page uses so an
 * admin scans five headings, not thirteen. Looks like a `DossierSection` (same
 * collapsible header, h2 label) and, like it, shows `summary` **only while
 * closed**. Its body is a stack of `DossierSubsection`s separated by a divider.
 *
 * Open state is controlled by the page for the same reason as `DossierSection`:
 * a jump to a sub-section inside a closed group has to open the group first.
 */
export function DossierGroup({
  id,
  label,
  summary,
  open,
  onOpenChange,
  keepMounted,
  children,
}: {
  id: string;
  label: string;
  /** One line shown after the label only while the group is closed. */
  summary?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Keep the sub-sections mounted while the group is closed — for a group that
   * holds a lazy section whose fetched data should survive a collapse.
   */
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const contentId = `${id}-content`;
  return (
    <Card id={id} className="mb-3 scroll-mt-28 p-0">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex items-center justify-between gap-2 px-card">
          <DisclosureTrigger contentId={contentId} open={open} heading="h2" label={label} summary={summary} />
        </div>
        <CollapsibleContent id={contentId} keepMounted={keepMounted}>
          <div className="divide-y border-t">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/**
 * One concern inside a `DossierGroup`, keeping its own anchor id.
 *
 * Without `onOpenChange` it is a plain headed block (`<section>` + h3, badge,
 * actions on the right) that is never collapsible: use it for content that is
 * already loaded. With `onOpenChange` it becomes a collapsible row with a 44px
 * trigger, for content that costs a request to show; `keepMounted` keeps what
 * was fetched when it is collapsed again.
 *
 * `actions` sit outside the trigger and must not be nested interactive
 * elements of it.
 */
export function DossierSubsection({
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
  badge?: ReactNode;
  actions?: ReactNode;
  /** Only read when `onOpenChange` is given. */
  open?: boolean;
  /** Present = collapsible. Omitted = flat block. */
  onOpenChange?: (open: boolean) => void;
  keepMounted?: boolean;
  children: ReactNode;
}) {
  if (!onOpenChange) {
    const headingId = `${id}-heading`;
    return (
      <section id={id} aria-labelledby={headingId} className="scroll-mt-28 px-card py-4">
        <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 id={headingId} className="min-w-0 text-sm font-semibold text-foreground">
              {label}
            </h3>
            {badge && <span className="shrink-0 whitespace-nowrap">{badge}</span>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-1">{actions}</div>}
        </div>
        {children}
      </section>
    );
  }

  const isOpen = open ?? false;
  const contentId = `${id}-content`;
  return (
    <section id={id} className="scroll-mt-28">
      <Collapsible open={isOpen} onOpenChange={onOpenChange}>
        <div className="flex items-center justify-between gap-2 px-card">
          <DisclosureTrigger contentId={contentId} open={isOpen} heading="h3" label={label} badge={badge} />
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        <CollapsibleContent id={contentId} keepMounted={keepMounted}>
          <div className="px-card pb-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </section>
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
      className="sticky top-0 z-sticky mb-3 hidden overflow-x-visible rounded-lg border bg-card/95 p-1.5 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:block"
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
