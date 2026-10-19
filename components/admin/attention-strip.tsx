"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Perlu perhatian" — the answer-first strip at the top of an Admin Detail
 * page. It lists only what needs action (money owed, a missing document, no
 * linked record) with one button per row, and renders nothing at all when
 * nothing applies, so a healthy record shows no empty chrome.
 *
 * Entity-agnostic: the page decides which items exist; this only lays them out.
 *
 * Tone is the warm `status-late` family. The message text is `text-foreground`
 * rather than `text-status-late-text`: that token measures 4.35:1 on
 * `status-late-subtle`, under the 4.5:1 AA floor for body text. The warmth comes
 * from the tinted surface, the border and the count badge instead.
 */

export type AttentionAction = {
  label: string;
  /** Navigates; takes precedence over `onClick`. */
  href?: string;
  onClick?: () => void;
  testId?: string;
};

export type AttentionItem = {
  id: string;
  message: ReactNode;
  action?: AttentionAction;
  /**
   * A second button on the same row (e.g. "Ingatkan via WhatsApp" beside
   * "Lihat tagihan"). Same shape as `action`; rendered after it.
   */
  secondaryAction?: AttentionAction;
};

export function AttentionStrip({
  items,
  className,
}: {
  items: AttentionItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Perlu perhatian"
      className={cn(
        "rounded-lg border border-status-late/40 bg-status-late-subtle p-3 sm:px-card",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {/* Decorative: the list below already carries every item, and a
            "3 Perlu perhatian" heading name reads oddly. */}
        <span
          aria-hidden="true"
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-status-late-text px-1.5 text-caption font-semibold leading-5 text-white"
        >
          {items.length}
        </span>
        <h2 className="text-small font-semibold text-foreground">Perlu perhatian</h2>
      </div>
      <ul className="divide-y divide-status-late/25">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="min-w-0 text-small text-foreground">{item.message}</div>
            {item.secondaryAction ? (
              <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
                {item.action && <AttentionButton action={item.action} />}
                <AttentionButton action={item.secondaryAction} />
              </div>
            ) : (
              item.action && <AttentionButton action={item.action} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AttentionButton({ action }: { action: AttentionAction }) {
  const common = {
    size: "sm" as const,
    variant: "outline" as const,
    className: "w-full shrink-0 sm:w-auto",
    "data-testid": action.testId,
  };
  if (action.href) {
    return (
      <Button {...common} nativeButton={false} role="link" render={<Link href={action.href} />}>
        {action.label}
      </Button>
    );
  }
  return (
    <Button {...common} type="button" onClick={action.onClick}>
      {action.label}
    </Button>
  );
}
