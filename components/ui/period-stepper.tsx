import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Previous / label / next control for stepping a month or a week. One
 * component so every stepper gets the `Button` icon size (and its 44px touch
 * floor) instead of a hand-rolled `<button className="p-2">`. For a stepper
 * that navigates by URL, or shows a "today" shortcut, use the portal's
 * `WeekNavigator`.
 */
export function PeriodStepper({
  label,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  variant = "ghost",
  className,
  labelClassName,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  /** Accessible name of the previous button, e.g. "Bulan sebelumnya". */
  prevLabel: string;
  nextLabel: string;
  variant?: "ghost" | "outline";
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <Button type="button" size="icon" variant={variant} onClick={onPrev} aria-label={prevLabel} title={prevLabel}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <span className={cn("min-w-0 text-center text-sm font-semibold", labelClassName)}>{label}</span>
      <Button type="button" size="icon" variant={variant} onClick={onNext} aria-label={nextLabel} title={nextLabel}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
