"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);
  return (
    <ErrorState
      className="py-20"
      title="Terjadi Kesalahan"
      description="Maaf, terjadi kesalahan saat memuat halaman. Silakan coba lagi."
      onRetry={reset}
    />
  );
}
