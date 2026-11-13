import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="px-page-x py-page-y" aria-busy="true">
      <div className="mb-section space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-card lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
