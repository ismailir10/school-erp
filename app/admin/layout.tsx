import { getSession, isAdminRole, homePathForRole } from "@/lib/auth";
import { getAdminHeaderContext } from "@/lib/admin/header-context";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/admin/sidebar";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { UnsavedChangesProvider } from "@/components/admin/unsaved-changes-provider";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isAdminRole(session.role)) redirect(homePathForRole(session.role));

  const header = session.tenantId ? await getAdminHeaderContext(session.tenantId).catch(() => null) : null;
  const years = header?.years ?? null;
  const yearContext = years === null ? "Tahun ajaran belum tersedia" : years.length ? years.join(", ") : "Belum ada tahun ajaran aktif";

  return (
    <UnsavedChangesProvider>
      <SidebarProvider>
        <AppSidebar permissions={session.permissions} />
        {/* min-w-0 is load-bearing: this is a flex child, and a flex item's
            default `min-width: auto` refuses to shrink below its content. A
            wide table would otherwise stretch this column past the viewport,
            carrying the header and its action buttons off-screen instead of
            letting the table's own overflow-x-auto scroll it. */}
        <div className="relative flex w-full min-w-0 flex-1 flex-col bg-background">
          <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-page-x py-3">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 !h-4" />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold break-words">{yearContext}</p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-muted">
                <span className="text-xs font-bold text-primary-text">
                  {session.name?.[0] ?? "A"}
                </span>
              </div>
            </div>
          </header>
          {/* Back link and breadcrumb say the same thing: a page that renders a `data-page-back` link
              (DetailPageHeader, BackLink) hides the breadcrumb wrapper. CSS-only so it works across
              the server/client boundary. */}
          <main className="min-w-0 px-page-x py-page-y [&:has([data-page-back])_[data-admin-breadcrumb]]:hidden">
            <AdminBreadcrumb />
            {children}
          </main>
        </div>
      </SidebarProvider>
    </UnsavedChangesProvider>
  );
}
