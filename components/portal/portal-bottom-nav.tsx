"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { DrawerTrigger } from "@/components/ui/drawer";
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
 * "Lainnya" overflow sheet. Rendered as a `<button>` so
 * assistive tech announces it as a control, not a destination, and so it can
 * carry `aria-haspopup` / `aria-expanded`.
 */
export type PortalBottomNavActionItem = {
  kind: "action";
  label: string;
  icon: LucideIcon;
  /** Reflects the open state of the surface this button controls. */
  expanded?: boolean;
  /** Marks the tab active while its surface is open. */
  active?: boolean;
} & (
  | { onSelect: () => void; drawerTrigger?: never }
  | { onSelect?: never; drawerTrigger: true }
);

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

// Equal-width slots leave 60 px for a label at 320 px. Keep the padding
// small so “Kehadiran” fits at 12 px without truncating or shrinking the type.
const SLOT_CLASS =
  "relative flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 py-1 " +
  "focus-visible:focus-outline [--focus-outline-offset:-2px]";

const LABEL_CLASS = "max-w-full whitespace-nowrap text-xs leading-4 font-medium";

export function PortalBottomNav({ items, layoutId, ariaLabel }: PortalBottomNavProps) {
  const pathname = usePathname();
  const layout = layoutId ?? "portal-bottom-nav-active";
  // The sliding indicator is decorative. Respect the OS reduced-motion
  // setting and snap instead of spring.
  const reduceMotion = useReducedMotion();
  const isDrawerOpen = items.some((item) => item.kind === "action" && item.expanded);

  // The bar is full-bleed on a phone, which is right, but on a 1280px desktop
  // it painted a white strip the whole width with five tabs marooned in the
  // middle while the content column stayed at max-w-md. From `md:` up it now
  // matches the column it belongs to.
  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-card border-t border-border z-nav safe-area-bottom md:inset-x-auto md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-t-xl md:border-x"
      aria-label={ariaLabel}
    >
      <div className="mx-auto flex h-16 max-w-md items-stretch">
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

          const highlighted = isActive && (item.kind === "action" || !isDrawerOpen);
          const inner = (
            <>
              {highlighted && (
                <motion.div
                  layoutId={layout}
                  className="absolute top-0 h-0.5 w-8 rounded-full bg-primary-text"
                  aria-hidden="true"
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 350, damping: 30 }
                  }
                />
              )}
              <Icon
                strokeWidth={highlighted ? 2 : 1.5}
                className={cn(
                  "size-5 shrink-0",
                  highlighted ? "text-primary-text" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  LABEL_CLASS,
                  highlighted ? "text-primary-text" : "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            </>
          );

          if (item.kind === "action") {
            const trigger = (
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
            return item.drawerTrigger ? <DrawerTrigger key={item.label} asChild>{trigger}</DrawerTrigger> : trigger;
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
