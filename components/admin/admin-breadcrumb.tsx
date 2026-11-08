"use client";

import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getBreadcrumbs } from "@/config/admin-nav";
import { GuardedLink } from "@/components/admin/guarded-link";
import { Fragment } from "react";

export function AdminBreadcrumb() {
  const pathname = usePathname();
  const crumbs = getBreadcrumbs(pathname);

  // One crumb is just the page title again; the breadcrumb earns its row only with a trail.
  if (crumbs.length <= 1) return null;

  return (
    // `data-admin-breadcrumb`: app/admin/layout.tsx hides this wrapper (with its margin) on any page
    // that renders a back link (`data-page-back`), where the back link already says where "up" is.
    <div data-admin-breadcrumb="" className="mb-field">
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.href ? (
                <BreadcrumbLink render={<GuardedLink href={crumb.href} />}>
                  {crumb.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
    </div>
  );
}
