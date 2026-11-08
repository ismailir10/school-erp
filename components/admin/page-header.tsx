import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  ActionButton,
  OverflowMenu,
  visibleActions,
  type HeaderAction,
} from "@/components/admin/header-actions";

export type PageHeaderAction = HeaderAction;

export function PageHeader({
  title,
  description,
  badge,
  actions,
  primaryAction,
  secondaryAction,
  menuActions,
  className,
}: {
  title: string;
  description?: string;
  badge?: ReactNode;
  /** Legacy escape hatch: an arbitrary node. Renders first, before the structured actions. */
  actions?: ReactNode;
  /** The one filled button (size sm). A page has one. */
  primaryAction?: PageHeaderAction;
  /** An outline button (size sm) beside the primary; below `sm` it folds into the `⋯` menu. */
  secondaryAction?: PageHeaderAction;
  /** Everything else, in the `⋯` menu; destructive entries last, after a separator. */
  menuActions?: PageHeaderAction[];
  className?: string;
}) {
  const primary = primaryAction && !primaryAction.hidden ? primaryAction : undefined;
  const secondary = secondaryAction && !secondaryAction.hidden ? secondaryAction : undefined;
  const hasMenu = visibleActions(menuActions).length > 0 || !!secondary;
  const hasStructured = !!primary || !!secondary || hasMenu;

  return (
    <header className={cn("mb-section flex min-w-0 flex-col gap-field sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-h1 text-balance tracking-tight text-foreground">
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p className="mt-1 max-w-prose text-body leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {(actions || hasStructured) && (
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
          {secondary && <ActionButton action={secondary} className="hidden sm:inline-flex" />}
          {hasMenu && <OverflowMenu actions={menuActions} mobileOnly={secondary ? [secondary] : undefined} />}
          {primary && <ActionButton action={{ ...primary, variant: primary.variant ?? "default" }} />}
        </div>
      )}
    </header>
  );
}
