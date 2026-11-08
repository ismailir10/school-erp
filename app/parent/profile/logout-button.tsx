"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LogoutConfirmDialog } from "@/components/portal/logout-confirm-dialog";
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
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
      >
        <LogOut size={16} />
        {busy ? "Keluar..." : "Keluar"}
      </Button>
      <LogoutConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleLogout}
        loading={busy}
      />
    </>
  );
}
