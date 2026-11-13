"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Home,
  Receipt,
  CalendarDays,
  BookHeart,
  MoreHorizontal,
} from "lucide-react";
import { PortalBottomNav, type PortalBottomNavItem } from "@/components/portal/portal-bottom-nav";
import { isPortalMoreRoute } from "@/components/portal/more-sheet";
import { ParentMoreSheet, PARENT_MORE_ITEMS } from "@/components/parent/more-sheet";
import { parentHref, resolveParentChildId } from "@/lib/parent/navigation";

// Frequency-of-use ordering: daily/financial actions first. The bar holds four
// destinations plus an overflow trigger; weekly (Perkembangan), semester (Rapor)
// and account (Profil) surfaces live in the "Lainnya" sheet.
//
// Put additional destinations in the overflow so the five tabs and their
// labels fit at 320 px. Jurnal is the parent-facing name for the journal.
const baseTabs = [
  { label: "Beranda", href: "/parent", icon: Home },
  { label: "Tagihan", href: "/parent/invoices", icon: Receipt },
  { label: "Kehadiran", href: "/parent/attendance", icon: CalendarDays },
  { label: "Jurnal", href: "/parent/student-journal", icon: BookHeart },
] as const;

// Only `child` is meaningful across parent tabs (selected student). Other
// filters (invoice month, attendance range, etc.) are local to their own
// tab and must not leak when switching tabs.
export function ParentBottomNav({ childIds = [] }: { childIds?: string[] }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const detailChildId = pathname.match(/^\/parent\/perkembangan\/([^/]+)$/)?.[1];
  const childId = resolveParentChildId(childIds, detailChildId ?? searchParams.get("child"));

  // Keep the "Lainnya" tab lit while the user is on one of its destinations,
  // so the bar never shows zero active tabs.
  const onMoreRoute = PARENT_MORE_ITEMS.some((item) =>
    isPortalMoreRoute(pathname, item.href),
  );

  const links: PortalBottomNavItem[] = baseTabs.map((tab) => ({
    kind: "link",
    label: tab.label,
    href: parentHref(tab.href, childId),
    icon: tab.icon,
    matcher: (path) => tab.href === "/parent" ? path === "/parent" : isPortalMoreRoute(path, tab.href),
  }));
  const items: PortalBottomNavItem[] = [
    ...links,
    {
      kind: "action",
      label: "Lainnya",
      icon: MoreHorizontal,
      drawerTrigger: true,
      expanded: moreOpen,
      active: moreOpen || onMoreRoute,
    },
  ];

  return (
    <ParentMoreSheet open={moreOpen} onOpenChange={setMoreOpen} childId={childId}>
      <PortalBottomNav items={items} ariaLabel="Navigasi utama orang tua" />
    </ParentMoreSheet>
  );
}
