import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getSession, isAdminRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getVisibleAdminNav } from "@/config/admin-nav";

export const metadata: Metadata = { title: "Pengaturan" };

export default async function AdminSettingsPage() {
  const session = await getSession();
  if (!session || !isAdminRole(session.role)) redirect("/");

  const nav = getVisibleAdminNav(session.permissions);
  // The sidebar only ever links here when at least one section is visible,
  // so reaching this page with none means a stale link or a hand-typed URL
  // for a permission the user no longer holds — send them back to Dasbor
  // rather than rendering an empty hub.
  if (nav.settingsHub.length === 0) redirect("/admin");

  return (
    <>
      <PageHeader
        title="Pengaturan"
        description="Atur data dasar sekolah, akademik, keuangan, dan akses pengguna."
      />
      <div className="grid gap-card md:grid-cols-2">
        {nav.settingsHub.map((section) => (
          <Card key={section.id}>
            <CardHeader>
              <CardTitle>{section.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="-mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/50 outline-none focus-visible:focus-outline"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium">{item.label}</p>
                      <p className="text-small text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
