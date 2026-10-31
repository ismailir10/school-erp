"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function TeacherError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      className="py-20"
      title="Terjadi kesalahan"
      description="Halaman tidak bisa dimuat. Coba lagi sebentar ya."
      onRetry={reset}
    />
  );
}
