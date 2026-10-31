"use client";

import Link from "next/link";
import { ErrorState } from "@/components/ui/error-state";

export default function ParentError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      className="py-20"
      title="Halaman belum bisa dimuat"
      description="Koneksi terputus. Coba lagi sebentar ya. Kalau masih belum bisa, hubungi admin sekolah ya."
      onRetry={reset}
    >
      <Link
        href="/parent"
        className="tap-target inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Kembali ke Beranda
      </Link>
    </ErrorState>
  );
}
