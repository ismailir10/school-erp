"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function TeacherError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle className="text-destructive" size={28} />
      </div>
      <h2 className="text-h2 font-semibold mb-2">Terjadi kesalahan</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Halaman tidak bisa dimuat. Coba lagi sebentar ya.
      </p>
      <Button onClick={reset} variant="outline" className="tap-target">
        Coba lagi
      </Button>
    </div>
  );
}
