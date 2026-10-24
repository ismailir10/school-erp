import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="px-page-x py-page-y space-y-section">
      <Skeleton className="h-7 w-72 rounded-lg" />
      <div className="grid gap-card lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
