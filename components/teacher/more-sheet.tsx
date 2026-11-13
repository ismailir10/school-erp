"use client";

import type { ReactNode } from "react";
import { CalendarDays, Presentation, Sparkles, User, Wallet } from "lucide-react";
import { PortalMoreSheet, type PortalMoreItem } from "@/components/portal/more-sheet";

/**
 * Lower-frequency teacher destinations for the mobile bottom-navigation
 * overflow. Classroom work stays in the tab bar; personal account surfaces
 * live here, matching the parent portal's overflow interaction.
 */
export const TEACHER_MORE_ITEMS: PortalMoreItem[] = [
  {
    label: "Kehadiran saya",
    description: "Riwayat kehadiran, cuti, dan izin",
    href: "/teacher/attendance",
    icon: CalendarDays,
  },
  {
    label: "Slip gaji",
    description: "Lihat slip gaji bulanan",
    href: "/teacher/slips",
    icon: Wallet,
  },
  {
    label: "Profil saya",
    description: "Data akun dan kontak",
    href: "/teacher/profile",
    icon: User,
  },
  {
    label: "Apa yang Baru",
    description: "Pembaruan terbaru di Talib",
    href: "/changelog",
    icon: Sparkles,
  },
  {
    label: "Panduan Talib",
    description: "Tur singkat semua modul Talib",
    href: "/guide",
    icon: Presentation,
  },
];

export function TeacherMoreSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <PortalMoreSheet
      open={open}
      onOpenChange={onOpenChange}
      items={TEACHER_MORE_ITEMS}
      description="Halaman yang tidak dibuka setiap hari"
      ariaLabel="Menu lainnya guru"
    >
      {children}
    </PortalMoreSheet>
  );
}
