"use client";

import { MESSAGES } from "@/lib/feedback";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Props = {
  /** Note to delete; `null` keeps the dialog closed. */
  noteId: string | null;
  onClose: () => void;
  /** Called after the server confirmed the (soft) delete. */
  onDeleted: () => void;
};

/**
 * Confirm + delete for a catatan the current user wrote. Shared by the teacher
 * and parent journal pages so the copy, the failure handling and the request
 * cannot drift. The API only lets the author delete (403 otherwise), so the
 * caller decides whether to offer the control at all.
 */
export function NoteDeleteDialog({ noteId, onClose, onDeleted }: Props) {
  async function handleConfirm() {
    if (!noteId) return;
    try {
      const res = await fetch(`/api/student-journal/notes/${noteId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(err.error ?? "Catatan belum bisa dihapus. Coba lagi sebentar ya.");
        // Throwing keeps the confirm open (ConfirmDialog closes on resolve only).
        throw new Error("delete failed");
      }
    } catch (error) {
      if (!(error instanceof Error && error.message === "delete failed")) {
        toast.error(MESSAGES.network);
      }
      throw error;
    }
    toast.success("Catatan dihapus");
    onDeleted();
  }

  return (
    <ConfirmDialog
      open={noteId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Hapus catatan ini?"
      description="Catatan yang dihapus tidak dapat dikembalikan."
      confirmLabel="Hapus"
      destructive
      onConfirm={handleConfirm}
    />
  );
}
