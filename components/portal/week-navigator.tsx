import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Prev / label / next control for the week-scoped portal pages.
 *
 * Kehadiran and Jurnal had each grown their own: Kehadiran used 44px bare
 * chevron links, Jurnal used 32×32 outline buttons — below the 44px minimum
 * target, and visibly a different control for the same job one tab away.
 * Both now render this.
 *
 * Navigation is by `href` (server-rendered pages, so the week survives a
 * refresh and a back-button press) or by `onPrev`/`onNext` (the client-state
 * Jurnal page). Exactly one pair should be supplied.
 *
 * Two opt-in behaviours, added for the journal surfaces:
 * - `nextDisabled` stops a reader paging into weeks that cannot hold data. The
 *   journal grids lock future cells and the teacher picker caps at today, so a
 *   future journal week is empty by construction — it used to page forward
 *   forever, and the label gave no hint you had left the current year.
 * - `onToday`/`todayHref` renders the way back. Pass it only when the reader is
 *   off the current week; when it is absent nothing is rendered, so the control
 *   keeps its original shape on the surfaces that don't opt in
 *   (`/parent/attendance` and `/teacher/assessments/weekly` both deliberately
 *   allow looking ahead).
 */
export function WeekNavigator({
  label,
  prevHref,
  nextHref,
  onPrev,
  onNext,
  prevLabel = "Pekan sebelumnya",
  nextLabel = "Pekan berikutnya",
  nextDisabled = false,
  onToday,
  todayHref,
  todayLabel = "Kembali ke pekan ini",
  className,
}: {
  label: string;
  prevHref?: string;
  nextHref?: string;
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
  /** Render the next control inert — used when the next week cannot hold data. */
  nextDisabled?: boolean;
  onToday?: () => void;
  todayHref?: string;
  todayLabel?: string;
  className?: string;
}) {
  const showToday = Boolean(onToday || todayHref);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2">
        {prevHref ? (
          <Link href={prevHref} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={prevLabel}>
            <ChevronLeft size={20} />
          </Link>
        ) : (
          <Button variant="ghost" size="icon" onClick={onPrev} aria-label={prevLabel}>
            <ChevronLeft size={20} />
          </Button>
        )}

        <span className="min-w-0 truncate text-sm font-medium text-foreground">{label}</span>

        {nextDisabled ? (
          // Rendered as a disabled button in both modes: a Link with no href
          // would still be focusable and would read as actionable.
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-disabled="true"
            aria-label={`${nextLabel} — pekan berikutnya belum tersedia`}
          >
            <ChevronRight size={20} />
          </Button>
        ) : nextHref ? (
          <Link href={nextHref} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={nextLabel}>
            <ChevronRight size={20} />
          </Link>
        ) : (
          <Button variant="ghost" size="icon" onClick={onNext} aria-label={nextLabel}>
            <ChevronRight size={20} />
          </Button>
        )}
      </div>

      {showToday ? (
        <div className="flex justify-center">
          {todayHref ? (
            <Link href={todayHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {todayLabel}
            </Link>
          ) : (
            <Button variant="ghost" size="sm" onClick={onToday}>
              {todayLabel}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default WeekNavigator;
