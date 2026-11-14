import Link from "next/link";
import type { ReactNode } from "react";
import { LINK_TOUCH_CLASS, LINK_UNDERLINE_CLASS } from "@/components/ui/data-table-link-cell";
import { cn } from "@/lib/utils";

type EntityLinkProps = {
  /** Target from `entityHref`. `null`/`undefined` = viewer can't open it → plain text. */
  href: string | null | undefined;
  children: ReactNode;
  /** `default` reads as a name (foreground, medium); `muted` inherits the surrounding muted text colour. */
  tone?: "default" | "muted";
  /** Opt in to the 44px coarse-pointer hit area. Off by default: inline links must not stretch a text line. */
  touch?: boolean;
  className?: string;
};

/** A named entity that opens its own page ("names are doors"). */
export function EntityLink({ href, children, tone = "default", touch = false, className }: EntityLinkProps) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      className={cn(
        LINK_UNDERLINE_CLASS,
        tone === "default" ? "font-medium text-foreground" : "text-inherit",
        touch && cn("inline-flex items-center", LINK_TOUCH_CLASS),
        className,
      )}
    >
      {children}
    </Link>
  );
}
