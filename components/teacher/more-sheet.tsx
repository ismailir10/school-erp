"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChevronRight, Presentation, User, Wallet, type LucideIcon } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export type TeacherMoreItem = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

/**
 * Lower-frequency teacher destinations for the mobile bottom-navigation
 * overflow. Classroom work stays in the tab bar; personal account surfaces
 * live here, matching the parent portal's overflow interaction.
 */
export const TEACHER_MORE_ITEMS: TeacherMoreItem[] = [
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
    label: "Panduan Talib",
    description: "Tur singkat semua modul Talib",
    href: "/panduan",
    icon: Presentation,
  },
];

export function TeacherMoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-md mx-auto safe-area-bottom">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle>Lainnya</DrawerTitle>
          <DrawerDescription className="text-xs">
            Halaman pribadi yang tidak dibuka setiap hari
          </DrawerDescription>
        </DrawerHeader>

        <nav aria-label="Menu lainnya guru" className="px-4 pb-6">
          <ul className="space-y-2">
            {TEACHER_MORE_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => onOpenChange(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl border bg-card p-4 transition-colors",
                      "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isActive
                        ? "border-primary/40"
                        : "border-border hover:border-primary/30 active:border-primary/40",
                    )}
                  >
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
                      aria-hidden="true"
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <ChevronRight
                      size={18}
                      className="shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
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
