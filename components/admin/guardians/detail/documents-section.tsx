"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ParentDetail } from "./types";

// ------------------------------------------------------------------
// Document upload control (T14 + T6) — KTP / KK admin-only auth-proxied
// ------------------------------------------------------------------

const DOC_MAX_BYTES = 5 * 1024 * 1024;
const DOC_ACCEPT = "image/jpeg,image/png,application/pdf";

function DocumentUploadCell({
  parentId,
  parentName,
  field,
  label,
  hasFile,
  onMutated,
  canEdit,
}: {
  parentId: string;
  parentName: string;
  field: "ktp" | "kk";
  label: string;
  hasFile: boolean;
  onMutated: () => void;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Cache-bust the auth-proxied URL after upload/delete so <embed> reloads.
  const [version, setVersion] = useState(0);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > DOC_MAX_BYTES) {
      toast.error(`Ukuran ${label} maksimal 5 MB`);
      return;
    }
    const okMime = ["image/jpeg", "image/png", "application/pdf"].includes(file.type);
    if (!okMime) {
      toast.error(`Format ${label} harus JPG, PNG, atau PDF`);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/parents/${parentId}/${field}`, { method: "POST", body: fd });
      if (res.ok) {
        toast.success(`${label} diperbarui`);
        setVersion((v) => v + 1);
        onMutated();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error === "UNSUPPORTED_MEDIA_TYPE"
          ? `Format ${label} tidak sesuai isi berkas. Pastikan file JPG, PNG, atau PDF asli — bukan hasil ubah ekstensi.`
          : d.error || `Gagal mengunggah ${label}`);
      }
    } catch {
      toast.error("Terjadi kesalahan jaringan");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/parents/${parentId}/${field}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`${label} dihapus`);
        setVersion((v) => v + 1);
        onMutated();
      } else {
        toast.error(`Gagal menghapus ${label}`);
      }
    } catch {
      toast.error("Terjadi kesalahan jaringan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {hasFile ? (
        <>
          <embed
            key={version}
            src={`/api/parents/${parentId}/${field}?v=${version}`}
            className="w-full h-48 border rounded-lg bg-muted"
            aria-label={`Pratinjau ${label}`}
          />
          <a
            href={`/api/parents/${parentId}/${field}?v=${version}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary-text hover:underline inline-block"
          >
            Buka di tab baru →
          </a>
        </>
      ) : (
        <div className="w-full h-48 border border-dashed rounded-lg bg-muted/50 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">{label} belum diunggah</p>
        </div>
      )}
      {canEdit && <div className="flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={DOC_ACCEPT}
          className="hidden"
          onChange={handleFile}
        />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Memproses..." : hasFile ? `Ganti ${label}` : `Unggah ${label}`}
        </Button>
        {hasFile && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteOpen(true)} disabled={busy}>
            Hapus
          </Button>
        )}
      </div>}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Hapus ${label}?`}
        description={`${label} ${parentName} akan dihapus. Unggah lagi jika masih diperlukan.`}
        confirmLabel="Ya, Hapus"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

/** KTP + KK side by side. Sensitive PII (UU PDP 27/2022): files live under .data/, reads stream through the requireAdmin-gated GET. */
export function DocumentsPanel({ parent, onMutated }: { parent: ParentDetail; onMutated: () => void }) {
  return (
    <>
      <p className="mb-4 text-xs text-muted-foreground">
        KTP per orang tua + KK per keluarga · maks 5 MB · JPG / PNG / PDF
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <DocumentUploadCell
          parentId={parent.id}
          parentName={parent.name}
          field="ktp"
          label="KTP"
          canEdit={parent.canEdit === true}
          hasFile={parent.hasKtp}
          onMutated={onMutated}
        />
        <DocumentUploadCell
          parentId={parent.id}
          parentName={parent.name}
          field="kk"
          label="KK"
          canEdit={parent.canEdit === true}
          hasFile={parent.hasKk}
          onMutated={onMutated}
        />
      </div>
    </>
  );
}
