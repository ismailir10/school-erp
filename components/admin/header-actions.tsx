import { ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * One header action, shared by `DetailPageHeader` and `PageHeader`. Rendered as
 * a `Button` (primary/secondary slot) or a `DropdownMenuItem` (menu slot).
 */
export type HeaderAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /** Drop the action entirely, so callers can keep one array and gate membership by condition. */
  hidden?: boolean;
  /** Button fill; ignored for menu items. Defaults to `"outline"`. */
  variant?: "default" | "outline";
  /** Forwarded as `data-testid` on the rendered Button / DropdownMenuItem. */
  testId?: string;
};

export function visibleActions(actions?: HeaderAction[]) {
  return (actions ?? []).filter((a) => !a.hidden);
}

export function ActionButton({ action, className }: { action: HeaderAction; className?: string }) {
  return (
    <Button
      size="sm"
      variant={action.variant ?? "outline"}
      disabled={action.disabled}
      onClick={action.onClick}
      data-testid={action.testId}
      className={cn(action.destructive && "text-destructive hover:text-destructive", className)}
      {...(action.href ? { render: <Link href={action.href} /> } : {})}
    >
      {action.icon}
      {action.label}
    </Button>
  );
}

export function MenuActionItem({ action, className }: { action: HeaderAction; className?: string }) {
  return (
    <DropdownMenuItem
      onClick={action.onClick}
      disabled={action.disabled}
      data-testid={action.testId}
      variant={action.destructive ? "destructive" : "default"}
      className={className}
      {...(action.href ? { render: <Link href={action.href} /> } : {})}
    >
      {action.icon}
      {action.label}
    </DropdownMenuItem>
  );
}

/**
 * The `⋯` overflow menu. Destructive items render last, after a separator.
 * `mobileOnly` items (a secondary action that is a visible button from `sm` up)
 * are listed first and hidden from `sm` up by CSS.
 */
export function OverflowMenu({
  actions,
  mobileOnly,
}: {
  actions?: HeaderAction[];
  mobileOnly?: HeaderAction[];
}) {
  const menu = visibleActions(actions);
  const folded = visibleActions(mobileOnly);
  if (menu.length === 0 && folded.length === 0) return null;
  const nonDestructive = menu.filter((a) => !a.destructive);
  const destructive = menu.filter((a) => a.destructive);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Aksi lainnya"
            className={menu.length === 0 ? "sm:hidden" : undefined}
          />
        }
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </DropdownMenuTrigger>
      {/* Sizes to content: the anchor is a 32px icon button, so the primitive's w-(--anchor-width) made 128px menus that wrapped labels word by word. */}
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        {folded.map((action, i) => (
          <MenuActionItem key={"m" + action.label + i} action={action} className="sm:hidden" />
        ))}
        {nonDestructive.map((action, i) => (
          <MenuActionItem key={action.label + i} action={action} />
        ))}
        {nonDestructive.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map((action, i) => (
          <MenuActionItem key={action.label + i} action={action} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
