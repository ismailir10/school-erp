"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Home, School, ClipboardCheck, BookHeart, MoreHorizontal } from "lucide-react";
import { PortalBottomNav, type PortalBottomNavItem } from "@/components/portal/portal-bottom-nav";
import { isPortalMoreRoute } from "@/components/portal/more-sheet";
import { TeacherMoreSheet, TEACHER_MORE_ITEMS } from "@/components/teacher/more-sheet";

// Teacher keeps daily teaching work in the tab bar. Personal attendance (with
// Cuti & Izin), salary, and profile share the same fifth-slot overflow pattern
// as parent navigation.
//
// Absensi names the task of taking roll. Kehadiran names the saved record.
const baseTabs: PortalBottomNavItem[] = [
  {
    label: "Beranda",
    href: "/teacher",
    icon: Home,
    matcher: (path) => path === "/teacher"
      || isPortalMoreRoute(path, "/teacher/gate")
      || isPortalMoreRoute(path, "/teacher/sessions"),
  },
  { label: "Absensi", href: "/teacher/class-attendance", icon: School },
  { label: "Jurnal", href: "/teacher/student-journal", icon: BookHeart },
  { label: "Penilaian", href: "/teacher/assessments", icon: ClipboardCheck },
];

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const onMoreRoute = TEACHER_MORE_ITEMS.some((item) => isPortalMoreRoute(pathname, item.href));
  const items: PortalBottomNavItem[] = [
    ...baseTabs,
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
    <TeacherMoreSheet open={moreOpen} onOpenChange={setMoreOpen}>
      <PortalBottomNav items={items} ariaLabel="Navigasi utama guru" />
    </TeacherMoreSheet>
  );
}
