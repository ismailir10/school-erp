"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, LogOut, Presentation } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TalibWordmark } from "@/components/brand/talib-wordmark";
import { GuardedLink } from "@/components/admin/guarded-link";
import { signOut } from "@/lib/sign-out";
import {
  adminNav,
  getActiveGroup,
  getActiveHref,
  getVisibleAdminNav,
  hasVisibleSettings,
  settingsNavLink,
  type NavItem,
  type NavGroup,
} from "@/config/admin-nav";

function NavMenuItems({
  items,
  activeHref,
}: {
  items: NavItem[];
  activeHref: string | null;
}) {
  return (
    <SidebarMenu>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href === activeHref;
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              render={<GuardedLink href={item.href} />}
              isActive={active}
              tooltip={item.label}
            >
              <Icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function CollapsibleNavGroup({
  group,
  activeHref,
  open,
  onOpenChange,
}: {
  group: NavGroup;
  activeHref: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const GroupIcon = group.icon;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <SidebarGroup>
        <SidebarGroupLabel
          render={
            <CollapsibleTrigger className="group/nav-group flex w-full items-center gap-2" />
          }
        >
          <GroupIcon className="size-4" />
          <span>{group.label}</span>
          <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[panel-open]/nav-group:rotate-90" />
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <NavMenuItems items={group.items} activeHref={activeHref} />
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(adminNav.groups.map((g) => [g.id, true]))
  );

  const visibleNav = useMemo(() => getVisibleAdminNav(permissions), [permissions]);
  const visibleGroups = visibleNav.groups;
  const showSettingsLink = hasVisibleSettings(visibleNav);

  // Single source of truth for "which sidebar entry is active" — same
  // resolver used for breadcrumbs, so a hub-owned path (e.g.
  // /admin/report-cards/templates) lights up Pengaturan rather than the
  // shorter-matching Rapor entry.
  const activeHref = getActiveHref(pathname, visibleNav);

  // Auto-expand whichever group contains the active route so users who
  // collapsed a group and then navigated into it via breadcrumb/back don't
  // lose sight of their current location. User's collapsed state for
  // inactive groups is preserved.
  /* eslint-disable react-hooks/set-state-in-effect -- syncing collapsible
     state from the external system (URL pathname) into local UI state;
     functional setState bails out when the value already matches, so no
     cascading renders occur. */
  useEffect(() => {
    const activeGroupId = getActiveGroup(pathname, visibleNav);
    if (activeGroupId) {
      setOpenGroups((prev) =>
        prev[activeGroupId] ? prev : { ...prev, [activeGroupId]: true }
      );
    }
  }, [pathname, visibleNav]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleLogout() {
    try {
      await signOut();
    } catch {
      toast.error("Tidak bisa keluar. Coba lagi sebentar ya.");
    }
  }

  return (
    <Sidebar collapsible="icon">
      {/* Logo */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<GuardedLink href="/admin" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                <Image
                  src="/logo.png"
                  alt="An Nisaa'"
                  width={32}
                  height={32}
                  className="rounded-lg"
                />
              </div>
              <TalibWordmark size="md" showSublabel tone="onDark" className="flex-1 min-w-0" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Dashboard — standalone */}
        <SidebarGroup>
          <SidebarMenu>
            {visibleNav.standalone.map((item) => {
              const Icon = item.icon;
              const active = item.href === activeHref;
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<GuardedLink href={item.href} />}
                    isActive={active}
                    tooltip={item.label}
                  >
                    <Icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Module groups — Kesiswaan, Harian, Penilaian, Keuangan, SDM */}
        {visibleGroups.map((group) => (
          <CollapsibleNavGroup
            key={group.id}
            group={group}
            activeHref={activeHref}
            open={openGroups[group.id] ?? false}
            onOpenChange={(open) =>
              setOpenGroups((prev) => ({ ...prev, [group.id]: open }))
            }
          />
        ))}

        {/* Pengaturan — single link to the settings hub, not a collapsible
            group. Any destination formerly nested under a module group now
            lives on /admin/settings instead. */}
        {showSettingsLink && (
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<GuardedLink href={settingsNavLink.href} />}
                  isActive={activeHref === settingsNavLink.href}
                  tooltip={settingsNavLink.label}
                >
                  <settingsNavLink.icon />
                  <span>{settingsNavLink.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer — product guide, then logout */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<GuardedLink href="/panduan" />}
              tooltip="Panduan Talib"
            >
              <Presentation />
              <span>Panduan Talib</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Keluar" onClick={handleLogout}>
              <LogOut />
              <span>Keluar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
