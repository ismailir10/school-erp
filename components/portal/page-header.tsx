import type { ReactNode } from "react";
import { PageHeader as BasePageHeader } from "@/components/admin/page-header";

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
};

/**
 * Portal-route page header (parent, teacher, admin sub-pages). The layout lives
 * in `components/admin/page-header.tsx` — one implementation — and this keeps
 * the `subtitle` prop the portal callers already use. Don't add props here: if
 * a page needs icons or custom markup in the heading, wrap the primitive.
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <BasePageHeader title={title} description={subtitle} actions={actions} className={className} />
  );
}

export default PageHeader;
