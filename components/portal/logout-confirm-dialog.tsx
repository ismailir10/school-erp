"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** The one logout confirm shared by every portal. Neutral: signing out is reversible. */
export function LogoutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keluar dari Talib?"
      description="Anda bisa masuk lagi kapan saja."
      confirmLabel="Keluar"
      onConfirm={onConfirm}
      loading={loading}
    />
  );
}
