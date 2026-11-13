"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, type LucideIcon } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export type PortalMoreItem = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

export function isPortalMoreRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalMoreSheet({
  open,
  onOpenChange,
  items,
  description,
  ariaLabel,
  resolveHref,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PortalMoreItem[];
  description: string;
  ariaLabel: string;
  resolveHref?: (href: string) => string;
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {children}
      <DrawerContent
        className="mx-auto max-w-md safe-area-bottom"
        onOpenAutoFocus={(event) => {
          // Radix's default autofocus skips anchors.
          if (firstLinkRef.current) {
            event.preventDefault();
            firstLinkRef.current.focus();
          }
        }}
      >
        <DrawerHeader className="shrink-0 pb-2 text-left">
          <DrawerTitle>Lainnya</DrawerTitle>
          <DrawerDescription className="text-small">{description}</DrawerDescription>
        </DrawerHeader>

        <nav aria-label={ariaLabel} className="min-h-0 overflow-y-auto px-4 pb-6">
          <ul className="space-y-2">
            {items.map(({ href, icon: Icon, label, description }, index) => {
              const isActive = isPortalMoreRoute(pathname, href);

              return (
                <li key={href}>
                  <Link
                    href={resolveHref?.(href) ?? href}
                    ref={index === 0 ? firstLinkRef : undefined}
                    onNavigate={() => onOpenChange(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl border bg-card p-4 transition-colors",
                      "focus-visible:focus-outline",
                      isActive
                        ? "border-primary/40"
                        : "border-border hover:border-primary/30 active:border-primary/40",
                    )}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary-text" aria-hidden="true">
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold text-foreground">{label}</span>
                      <span className="mt-0.5 block text-small text-muted-foreground">{description}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </DrawerContent>
    </Drawer>
  );
}
