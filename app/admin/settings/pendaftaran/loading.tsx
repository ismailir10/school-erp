import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="px-page-x py-page-y" aria-busy="true">
      <div className="mb-section space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-96 w-full max-w-2xl rounded-xl" />
    </div>
  );
}
