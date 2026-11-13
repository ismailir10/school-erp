import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Two columns below lg: an odd last card spans both so the grid has no hole. Cards are
// min-w-0 so one wide figure can't stretch its column past the viewport.
const ODD_LAST = "max-lg:[&>*:last-child:nth-child(odd)]:col-span-2 [&>*]:min-w-0";

const COLS_CLASS: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: `grid grid-cols-2 gap-3 mb-6 ${ODD_LAST}`,
  3: `grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6 ${ODD_LAST}`,
  4: `grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 ${ODD_LAST}`,
  5: `grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6 ${ODD_LAST}`,
  6: `grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6 ${ODD_LAST}`,
};

export function StatsCardsRow({
  children,
  cols = 4,
  className,
  ...props
}: ComponentProps<"div"> & {
  cols?: 2 | 3 | 4 | 5 | 6;
}) {
  return <div {...props} className={cn(COLS_CLASS[cols], className)}>{children}</div>;
}
