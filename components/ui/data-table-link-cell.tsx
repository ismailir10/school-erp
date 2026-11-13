"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The row's primary cell doubles as the way into the record (cycle
 * 2026-09-26 admin-ui-standard-c1, "name is the link"): one obvious target
 * per row instead of a name *and* a separate "Lihat" button that do the same
 * thing. Pass `href` when the record has a detail page, or `onClick` when
 * viewing opens an overlay (e.g. a read-only Sheet). Edit / deactivate stay
 * in the row's `⋯` menu (DataTableRowActions).
 */
const LINK_CLASS =
  "inline-flex items-center rounded-sm text-left text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline focus-visible:focus-outline [@media(pointer:coarse)]:min-h-11";

type DataTableLinkCellProps = {
  children: ReactNode;
  /** Secondary line under the name (e.g. NIS, code, class). */
  description?: ReactNode;
  className?: string;
} & ({ href: string; onClick?: never } | { onClick: () => void; href?: never });

export function DataTableLinkCell({ children, description, className, ...target }: DataTableLinkCellProps) {
  const primary =
    "href" in target && target.href ? (
      <Link href={target.href} className={LINK_CLASS}>
        {children}
      </Link>
    ) : (
      <button type="button" onClick={target.onClick} className={LINK_CLASS}>
        {children}
      </button>
    );

  if (!description) return <div className={className}>{primary}</div>;

  return (
    <div className={cn("flex flex-col", className)}>
      {primary}
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  );
}
