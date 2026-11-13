"use client";

import type { ReactNode } from "react";
import { BookOpen, LineChart, User } from "lucide-react";
import { PortalMoreSheet, type PortalMoreItem } from "@/components/portal/more-sheet";
import { parentHref } from "@/lib/parent/navigation";

/**
 * Overflow destinations for the parent bottom nav. These are the surfaces whose
 * cadence is weekly (Perkembangan) or semester-ly (Rapor), plus account settings
 * — none of them earn a permanent slot in a 5-tab bar, and the home already
 * summarises it in its "Perkembangan pekan ini" section.
 *
 * "Capaian" is deliberately absent from these labels: `voice.md`'s glossary
 * reserves that word for the per-element achievement level *inside* the page
 * and bans it as a nav or page label, so nav copy stays on "Perkembangan".
 */
export const PARENT_MORE_ITEMS: PortalMoreItem[] = [
  {
    label: "Perkembangan",
    description: "Perkembangan anak per elemen",
    href: "/parent/perkembangan",
    icon: LineChart,
  },
  {
    label: "Rapor",
    description: "Laporan hasil belajar per triwulan",
    href: "/parent/reports",
    icon: BookOpen,
  },
  {
    label: "Profil",
    description: "Data akun dan kontak",
    href: "/parent/profile",
    icon: User,
  },
];

export function ParentMoreSheet({
  open,
  onOpenChange,
  childId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childId?: string | null;
  children?: ReactNode;
}) {
  return (
    <PortalMoreSheet
      open={open}
      onOpenChange={onOpenChange}
      items={PARENT_MORE_ITEMS}
      description="Halaman yang tidak dibuka setiap hari"
      ariaLabel="Menu lainnya"
      resolveHref={(href) => parentHref(href, childId)}
    >
      {children}
    </PortalMoreSheet>
  );
}
