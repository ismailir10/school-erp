import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="px-page-x py-page-y space-y-section">
      <Skeleton className="h-7 w-64 rounded-lg" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
