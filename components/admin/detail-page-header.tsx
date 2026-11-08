import { ReactNode } from "react";
import { GuardedLink } from "@/components/admin/guarded-link";
import { ArrowLeft } from "lucide-react";
import { ActionButton, OverflowMenu, visibleActions, type HeaderAction } from "@/components/admin/header-actions";

/** A single detail-header action — the shared `HeaderAction` (see header-actions.tsx). */
export type DetailPageHeaderAction = HeaderAction;

/**
 * The structured-actions renderer: at most **two** visible buttons, plus a
 * `⋯` overflow menu for the rest (destructive last, after a separator). Used
 * when a caller passes `primaryActions` / `menuActions` instead of `actions`.
 */
function StructuredActions({
  primaryActions,
  menuActions,
}: {
  primaryActions?: HeaderAction[];
  menuActions?: HeaderAction[];
}) {
  const primary = visibleActions(primaryActions).slice(0, 2);
  return (
    <>
      {primary.map((action, i) => (
        <ActionButton key={action.label + i} action={action} />
      ))}
      <OverflowMenu actions={menuActions} />
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
      {/* GuardedLink: a page with unsaved edits (useUnsavedChangesGuard) gets the
          "Keluar tanpa menyimpan?" confirm instead of silently losing them. */}
      <GuardedLink
        href={backHref}
        data-page-back=""
        className="mb-field inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 -ml-2 text-body text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        {backLabel}
      </GuardedLink>
      <div className="flex min-w-0 flex-col gap-field sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="text-h1 text-balance break-words tracking-tight text-foreground">
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
