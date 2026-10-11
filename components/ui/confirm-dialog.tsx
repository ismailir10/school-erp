"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Branded confirmation dialog — replaces window.confirm().
 * Built on AlertDialog so destructive confirms cannot be dismissed
 * by click-outside or Escape without an explicit Cancel.
 *
 * Usage:
 *   const [confirmOpen, setConfirmOpen] = useState(false);
 *   <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen}
 *     title="Hapus karyawan?" description="Tindakan ini tidak bisa dibatalkan."
 *     onConfirm={handleDelete} destructive />
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  onConfirm,
  destructive = false,
  loading = false,
  focusCancel = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  loading?: boolean;
  /**
   * Open with focus on the cancel button. Needed when `children` holds links or other tabbable
   * content, which would otherwise take the first focus ahead of the safe choice.
   */
  focusCancel?: boolean;
  /** Optional body rendered between the description and the footer (e.g. a required Textarea). */
  children?: ReactNode;
}) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleConfirm() {
    setIsLoading(true);
    try {
      await onConfirm();
      // Close only on successful resolution. If onConfirm rejects, the dialog
      // stays open so the caller can surface an error toast and the user can
      // retry without re-opening the sheet.
      onOpenChange(false);
    } catch {
      // Swallow — caller is expected to surface the error via toast. We do
      // not re-throw so handlers higher up don't see a duplicate error.
    } finally {
      setIsLoading(false);
    }
  }

  const busy = loading || isLoading;
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent {...(focusCancel ? { initialFocus: cancelRef } : {})}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? "Memproses..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
