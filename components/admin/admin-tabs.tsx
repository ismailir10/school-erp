"use client";

/**
 * Admin-namespaced wrapper over Shadcn `<Tabs>` primitives.
 *
 * `AdminTabs`/`AdminTabsTrigger`/`AdminTabsContent` are still a passthrough —
 * the admin portal is happy with Shadcn's default variant (pill on
 * `bg-muted`). `AdminTabsList` is not: it OWNS tab-strip layout (cycle
 * 2026-09-26, admin-ui-standard-c1 T1) so every admin tab strip behaves
 * identically on a phone — a single row that scrolls horizontally instead of
 * wrapping to two or three rows (which, on a strip like Komponen Biaya's,
 * dropped a tab onto its own centred row where it read as a heading, not a
 * tab). Pages must not re-fight this with their own `flex-wrap`/`w-full`
 * overrides — see `.claude/standards/ui.md` DataTable/AdminTabs section.
 *
 * The wrapper exists so future admin-wide tab styling changes land in one
 * place instead of across every detail page.
 */

import * as React from "react";
import {
  Tabs as AdminTabs,
  TabsList,
  TabsTrigger,
  TabsContent as AdminTabsContent,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export { AdminTabs, AdminTabsContent };

export function AdminTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      className={cn(
        "max-w-full flex-nowrap justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}

// `TabsTrigger`'s own `flex-1` (meant for a `TabsList` that never overflows)
// would fight `AdminTabsList`'s horizontal scroll by stretching triggers to
// fill it instead of letting them keep their natural width. `shrink-0` here,
// applied directly rather than via a parent selector, wins deterministically
// over `flex-1` (same specificity either way — this avoids the coin flip).
export function AdminTabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsTrigger>) {
  return <TabsTrigger className={cn("shrink-0", className)} {...props} />;
}
