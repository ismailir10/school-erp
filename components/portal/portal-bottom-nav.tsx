"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A tab that navigates to a route. */
export type PortalBottomNavLinkItem = {
  kind?: "link";
  label: string;
  href: string;
  icon: LucideIcon;
  matcher?: (pathname: string) => boolean;
};

/**
 * A tab that runs an in-page action instead of navigating — used for the
 * parent portal's "Lainnya" overflow sheet. Rendered as a `<button>` so
 * assistive tech announces it as a control, not a destination, and so it can
 * carry `aria-haspopup` / `aria-expanded`.
 */
export type PortalBottomNavActionItem = {
  kind: "action";
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Reflects the open state of the surface this button controls. */
  expanded?: boolean;
  /** Marks the tab active while its surface is open. */
  active?: boolean;
};

export type PortalBottomNavItem =
  | PortalBottomNavLinkItem
  | PortalBottomNavActionItem;

export type PortalBottomNavProps = {
  /**
   * 4-5 items. More than 5 overflows the 375 px design target: at 6 the last
   * slot renders past the viewport edge and is unreachable (measured 27.4 px
   * past the edge at 375 px, entirely absent at 360 px). Put anything beyond
   * 5 behind an `action` item that opens an overflow sheet.
   */
  items: PortalBottomNavItem[];
  layoutId?: string;
  ariaLabel: string;
};

/**
 * `basis-0` is load-bearing. Plain `flex-1` leaves `flex-basis: auto`, so each
 * slot is sized by its own label and the row's total width becomes the sum of
 * the label widths — which is what let the 6-tab parent bar overflow. With
 * `basis-0` every slot resolves to an identical `container / n`, so the row can
 * never exceed its container and tap targets stay uniform.
 */
/**
 * Horizontal padding is pure label budget — the 20 px icon never needs it and
 * the slot's tap width is set by `flex-1 basis-0` regardless. `px-0.5`: at
 * 320 px (iPhone SE 1st gen, small Android) a slot is 64 px, and "Kehadiran"
 * (57.8 px at 12 px) used to truncate to "Kehadi…" inside `px-1`'s 56 px.
 * The label is also fluid (see LABEL_CLASS) so the five labels fit at every
 * width from 320 up; tap targets stay the full slot (64 px x 64 px bar).
 */
const SLOT_CLASS =
  "flex flex-col items-center justify-center gap-1 relative py-1 px-0.5 flex-1 basis-0 min-w-0 " +
  "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-card";

/**
 * Fluid size, 10 px floor: 3.4vw is 10.9 px at 320, 11.7 px at 344 and reaches
 * the old 12 px (`text-xs`) from 353 px up, so 360+ renders exactly as before.
 * `whitespace-nowrap`, no `truncate`: a nav label must never be cut.
 */
const LABEL_CLASS =
  "max-w-full whitespace-nowrap text-[length:clamp(0.625rem,3.4vw,0.75rem)] leading-4 font-medium";

export function PortalBottomNav({ items, layoutId, ariaLabel }: PortalBottomNavProps) {
  const pathname = usePathname();
  const layout = layoutId ?? "portal-bottom-nav-active";
  // The sliding indicator is decorative. Respect the OS reduced-motion
  // setting and snap instead of spring.
  const reduceMotion = useReducedMotion();

  // The bar is full-bleed on a phone, which is right, but on a 1280px desktop
  // it painted a white strip the whole width with five tabs marooned in the
  // middle while the content column stayed at max-w-md. From `md:` up it now
  // matches the column it belongs to.
  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-card border-t border-border z-nav safe-area-bottom md:inset-x-auto md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-t-xl md:border-x"
      aria-label={ariaLabel}
    >
      <div className="flex items-center justify-around h-16 max-w-md mx-auto">
        {items.map((item, index) => {
          const Icon = item.icon;

          const isActive =
            item.kind === "action"
              ? !!item.active
              : item.matcher
                ? item.matcher(pathname)
                : index === 0
                  ? pathname === item.href.split("?")[0]
                  : pathname.startsWith(item.href.split("?")[0]);

          const inner = (
            <>
              {isActive && (
                <motion.div
                  layoutId={layout}
                  className="absolute -top-0 w-8 h-0.5 bg-primary rounded-full"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 350, damping: 30 }
                  }
                />
              )}
              <Icon
                size={20}
                strokeWidth={isActive ? 2 : 1.5}
                className={cn(
                  "shrink-0",
                  isActive ? "text-primary-text" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  LABEL_CLASS,
                  isActive ? "text-primary-text" : "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            </>
          );

          if (item.kind === "action") {
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.onSelect}
                className={SLOT_CLASS}
                aria-haspopup="dialog"
                aria-expanded={item.expanded ?? false}
              >
                {inner}
              </button>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={SLOT_CLASS}
              aria-current={isActive ? "page" : undefined}
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
