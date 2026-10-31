"use client";

import { MESSAGES } from "@/lib/feedback";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  const [previewOpen, setPreviewOpen] = useState(false);

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
      toast.error(MESSAGES.network);
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
        setPreviewOpen(false);
        setVersion((v) => v + 1);
        onMutated();
      } else {
        toast.error(`Gagal menghapus ${label}`);
      }
    } catch {
      toast.error(MESSAGES.network);
    } finally {
      setBusy(false);
    }
  }

  const previewId = `${parentId}-${field}-preview`;
  const url = `/api/parents/${parentId}/${field}?v=${version}`;
  // A deleted file has nothing to preview, whatever the toggle says.
  const showPreview = hasFile && previewOpen;

  return (
    <div role="group" aria-label={label} className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {hasFile ? (
            <Badge variant="success">Ada</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">Belum ada</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {hasFile && (
            <Button
              size="sm"
              variant="outline"
              aria-expanded={showPreview}
              aria-controls={previewId}
              onClick={() => setPreviewOpen((o) => !o)}
              aria-label={`${showPreview ? "Tutup pratinjau" : "Lihat"} ${label}`}
            >
              {showPreview ? "Tutup" : "Lihat"}
            </Button>
          )}
          {canEdit && (
            <>
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
                <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteOpen(true)} disabled={busy} aria-label={`Hapus ${label}`}>
                  Hapus
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {/* The file is requested only here, after "Lihat": a KTP/KK is personal
          data (UU PDP) and used to load on every visit. */}
      <div id={previewId}>
        {showPreview && (
          <div className="mt-3 space-y-2">
            <embed
              key={version}
              src={url}
              className="h-64 w-full rounded-lg border bg-muted"
              aria-label={`Pratinjau ${label}`}
            />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-target inline-flex items-center text-xs text-primary-text hover:underline"
            >
              Buka di tab baru →
            </a>
          </div>
        )}
      </div>
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
        KTP per orang tua + KK per keluarga · maks 5 MB · JPG / PNG / PDF · pratinjau dibuka sesuai permintaan
      </p>
      <div className="divide-y divide-border/50">
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
