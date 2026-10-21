import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsHeading } from "./analytics-heading";

/**
 * Suspense fallback with the real section's heading and block heights, so the
 * page doesn't jump when the analytics arrive. `showFinance` mirrors the
 * permission gate so an admin without `invoices.view` doesn't see a row of
 * finance placeholders that then disappears.
 */
export function AnalyticsSkeleton({ showFinance = true }: { showFinance?: boolean }) {
  return (
    <section
      data-testid="dashboard-analytics-skeleton"
      aria-busy="true"
      aria-label="Memuat analitik"
      className="mt-section space-y-section"
    >
      <AnalyticsHeading />
      <Skeleton className="h-36 rounded-xl md:h-36" />
      <div className="grid gap-section lg:grid-cols-2">
        <Skeleton className="h-[34rem] rounded-xl" />
        <Skeleton className="h-[34rem] rounded-xl" />
      </div>
      {showFinance && (
        <div className="grid gap-section lg:grid-cols-5">
          <Skeleton className="h-[24rem] rounded-xl lg:col-span-3" />
          <Skeleton className="h-[24rem] rounded-xl lg:col-span-2" />
        </div>
      )}
    </section>
  );
}
