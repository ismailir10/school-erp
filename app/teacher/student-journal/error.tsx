"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function TeacherStudentJournalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Buku Penghubung tidak bisa dimuat"
      description="Coba lagi sebentar ya."
      onRetry={reset}
    />
  );
}
