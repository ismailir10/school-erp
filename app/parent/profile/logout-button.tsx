"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { signOut } from "@/lib/sign-out";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await signOut();
    } catch {
      toast.error("Tidak bisa keluar. Coba lagi sebentar ya.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-status-absent-subtle bg-transparent px-4 py-3 text-sm font-semibold text-status-absent-text transition-colors hover:bg-status-absent-subtle active:scale-98 disabled:opacity-60"
      >
        <LogOut size={16} />
        {busy ? "Keluar..." : "Keluar"}
      </button>
      {/* One tap used to end the session; a thumb brushing the red button on
          the profile page signed the parent out with no way to undo it. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Keluar dari Talib?"
        description="Anda perlu masuk lagi untuk melihat kabar anak."
        confirmLabel="Keluar"
        cancelLabel="Batal"
        onConfirm={handleLogout}
        destructive
        loading={busy}
      />
    </>
  );
}
