"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function ParentInvoicesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Gagal memuat tagihan"
      description="Coba lagi sebentar ya. Kalau masih belum bisa, hubungi admin sekolah ya."
      onRetry={reset}
    />
  );
}
