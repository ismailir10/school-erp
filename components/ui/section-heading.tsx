import { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Canonical section heading. Use above a group of cards or content rows.
 *
 * Renders `text-xs font-semibold text-muted-foreground uppercase
 * tracking-wider` plus optional description and right-aligned actions slot.
 *
 * - Text comes from `label` or `children` (children wins when both given).
 * - `as` picks the element (default `h3`); use `p` for a label over a list
 *   that already carries its own `aria-label`, `h2` for a real landmark.
 * - `className` goes on the wrapper (e.g. `mb-0`); other HTML attributes
 *   (`id`, `aria-*`) go on the heading element.
 */
export function SectionHeading({
  label,
  children,
  description,
  actions,
  as: Tag = "h3",
  className,
  ...props
}: {
  label?: string;
  children?: ReactNode;
  description?: string;
  actions?: ReactNode;
  as?: "h2" | "h3" | "p";
  className?: string;
} & Omit<React.HTMLAttributes<HTMLHeadingElement>, "children">) {
  return (
    <div className={cn("flex items-start justify-between gap-2 mb-3", className)}>
      <div className="min-w-0">
        <Tag
          className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
          {...props}
        >
          {children ?? label}
        </Tag>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
