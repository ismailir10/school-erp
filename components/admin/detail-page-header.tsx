import { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * A single detail-header action. `primaryActions` renders as a visible
 * `Button` (max 2 — anything past that is a caller bug, not something this
 * component silently fixes); `menuActions` renders as a `DropdownMenuItem`
 * inside the `⋯` overflow menu, destructive ones last after a separator.
 */
export type DetailPageHeaderAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /** Drop the action entirely — lets callers keep one array and gate membership by condition. */
  hidden?: boolean;
  /**
   * Button fill for a `primaryActions` entry — ignored on a `menuActions`
   * entry (menu items never render filled). Defaults to `"outline"`, matching
   * every other visible header button. At most **one** action per header
   * should be `"default"` (filled) — it reads as *the* primary action; a
   * second filled button competes with it and the eye has nowhere to land.
   */
  variant?: "default" | "outline";
  /** Forwarded as `data-testid` on the rendered Button / DropdownMenuItem. */
  testId?: string;
};

function visible(actions?: DetailPageHeaderAction[]) {
  return (actions ?? []).filter((a) => !a.hidden);
}

function PrimaryActionButton({ action }: { action: DetailPageHeaderAction }) {
  return (
    <Button
      size="sm"
      variant={action.variant ?? "outline"}
      disabled={action.disabled}
      onClick={action.onClick}
      data-testid={action.testId}
      className={action.destructive ? "text-destructive hover:text-destructive" : undefined}
      {...(action.href ? { render: <Link href={action.href} /> } : {})}
    >
      {action.icon}
      {action.label}
    </Button>
  );
}

function MenuActionItem({ action }: { action: DetailPageHeaderAction }) {
  return (
    <DropdownMenuItem
      onClick={action.onClick}
      disabled={action.disabled}
      data-testid={action.testId}
      variant={action.destructive ? "destructive" : "default"}
      {...(action.href ? { render: <Link href={action.href} /> } : {})}
    >
      {action.icon}
      {action.label}
    </DropdownMenuItem>
  );
}

/**
 * The structured-actions renderer: at most **two** visible buttons, plus a
 * `⋯` overflow menu for the rest. Destructive menu items always render last,
 * separated from the non-destructive ones. Used when a caller passes
 * `primaryActions` / `menuActions` instead of the legacy `actions` slot.
 */
function StructuredActions({
  primaryActions,
  menuActions,
}: {
  primaryActions?: DetailPageHeaderAction[];
  menuActions?: DetailPageHeaderAction[];
}) {
  const primary = visible(primaryActions).slice(0, 2);
  const menu = visible(menuActions);
  const nonDestructive = menu.filter((a) => !a.destructive);
  const destructive = menu.filter((a) => a.destructive);

  return (
    <>
      {primary.map((action, i) => (
        <PrimaryActionButton key={action.label + i} action={action} />
      ))}
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="Aksi lainnya" />
            }
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </DropdownMenuTrigger>
          {/* Sizes to content: the anchor is a 32px icon button, so the primitive's w-(--anchor-width) made 128px menus that wrapped labels word by word. */}
          <DropdownMenuContent align="end" className="w-auto min-w-40">
            {nonDestructive.map((action, i) => (
              <MenuActionItem key={action.label + i} action={action} />
            ))}
            {nonDestructive.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
            {destructive.map((action, i) => (
              <MenuActionItem key={action.label + i} action={action} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

export function DetailPageHeader({
  backHref,
  backLabel = "Kembali",
  title,
  description,
  badge,
  actions,
  primaryActions,
  menuActions,
}: {
  backHref: string;
  backLabel?: string;
  title: string;
  description?: string;
  badge?: ReactNode;
  /** Legacy escape hatch — an arbitrary ReactNode. Prefer `primaryActions` / `menuActions`. */
  actions?: ReactNode;
  /** At most 2 rendered as visible Buttons; anything past that is dropped. */
  primaryActions?: DetailPageHeaderAction[];
  /** Rendered inside a `⋯` DropdownMenu; destructive entries render last, after a separator. */
  menuActions?: DetailPageHeaderAction[];
}) {
  const resolvedActions =
    actions !== undefined ? (
      actions
    ) : primaryActions || menuActions ? (
      <StructuredActions primaryActions={primaryActions} menuActions={menuActions} />
    ) : undefined;

  return (
    <div className="mb-section min-w-0">
      <Link
        href={backHref}
        className="mb-field inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 -ml-2 text-body text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {backLabel}
      </Link>
      <div className="flex min-w-0 flex-col gap-field sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-h1 text-balance break-words font-bold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            {badge}
          </div>
          {description && (
            <p className="mt-1 text-body text-muted-foreground">{description}</p>
          )}
        </div>
        {resolvedActions && (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {resolvedActions}
          </div>
        )}
      </div>
    </div>
  );
}
