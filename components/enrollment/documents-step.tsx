"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { prepareUpload } from "@/lib/enrollment/compress-image";
import {
  DOCUMENT_ITEMS,
  MAX_DOCUMENT_BYTES,
  type DocumentItem,
  type DocumentKey,
  type PublicDocuments,
} from "@/lib/enrollment/documents";

/**
 * "Berkas" step of the public enrollment form.
 *
 * Uploads are optional and persist server-side the moment they succeed (the
 * route writes straight onto the row), so they are NOT part of the draft
 * autosave payload. The parent only ever sees file names; storage tokens never
 * reach the browser.
 *
 * The upload/delete state lives in `useDocumentUploads`, owned by the wizard
 * (not by this step), so a row keeps showing "Mengunggah…" if the parent goes
 * back a step mid-upload and returns.
 */

const MAX_LABEL = 80;

export type RowBusy = "upload" | "delete";

type UploadResponse = {
  key: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  label?: string;
};

export function documentErrorMessage(status: number | null): string {
  switch (status) {
    case 413:
      return "Ukuran berkas terlalu besar (maks. 4 MB). Coba foto ulang atau kecilkan PDF.";
    case 415:
      return "Format tidak didukung. Gunakan foto (JPG/PNG) atau PDF.";
    case 409:
      return "Formulir sudah dikirim, berkas tidak bisa diubah.";
    case 429:
      return "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.";
    default:
      return "Gagal mengunggah. Periksa koneksi lalu coba lagi.";
  }
}

function deleteErrorMessage(status: number | null): string {
  return status === 409 || status === 429
    ? documentErrorMessage(status)
    : "Gagal menghapus. Periksa koneksi lalu coba lagi.";
}

function formatSize(bytes: number): string {
  if (!(bytes > 0)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Documents + per-row busy/error state and the two network operations. State
 * updates are functional so two rows finishing together never overwrite each
 * other, and they keep working after the step component has unmounted.
 */
export function useDocumentUploads(token: string, initial: PublicDocuments) {
  const [documents, setDocuments] = useState<PublicDocuments>(initial);
  const [busy, setBusy] = useState<Partial<Record<DocumentKey, RowBusy>>>({});
  const [errors, setErrors] = useState<Partial<Record<DocumentKey, string>>>({});

  const url = useCallback(
    (key: DocumentKey) => `/api/enrollments/token/${token}/documents?key=${key}`,
    [token],
  );
  const setRowBusy = useCallback((key: DocumentKey, v: RowBusy | null) => {
    setBusy((b) => {
      const next = { ...b };
      if (v) next[key] = v;
      else delete next[key];
      return next;
    });
  }, []);
  const setRowError = useCallback((key: DocumentKey, msg: string | null) => {
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[key] = msg;
      else delete next[key];
      return next;
    });
  }, []);

  const upload = useCallback(
    async (key: DocumentKey, picked: File, label?: string) => {
      setRowError(key, null);
      setRowBusy(key, "upload");
      try {
        const file = await prepareUpload(picked);
        // Don't spend a slow uplink on a file the server will refuse anyway.
        if (file.size > MAX_DOCUMENT_BYTES) {
          setRowError(key, documentErrorMessage(413));
          return;
        }
        const fd = new FormData();
        fd.append("file", file, file.name);
        if (key === "lainnya" && label?.trim()) fd.append("label", label.trim().slice(0, MAX_LABEL));
        const res = await fetch(url(key), { method: "POST", body: fd });
        if (!res.ok) {
          setRowError(key, documentErrorMessage(res.status));
          return;
        }
        const d = (await res.json()) as UploadResponse;
        setDocuments((prev) => ({
          ...prev,
          [key]: {
            fileName: d.fileName,
            mimeType: d.mimeType,
            size: d.size,
            uploadedAt: d.uploadedAt,
            ...(d.label ? { label: d.label } : {}),
          },
        }));
      } catch {
        setRowError(key, documentErrorMessage(null));
      } finally {
        setRowBusy(key, null);
      }
    },
    [url, setRowBusy, setRowError],
  );

  const remove = useCallback(
    async (key: DocumentKey): Promise<boolean> => {
      setRowError(key, null);
      setRowBusy(key, "delete");
      try {
        const res = await fetch(url(key), { method: "DELETE" });
        if (!res.ok) {
          setRowError(key, deleteErrorMessage(res.status));
          return false;
        }
        setDocuments((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return true;
      } catch {
        setRowError(key, deleteErrorMessage(null));
        return false;
      } finally {
        setRowBusy(key, null);
      }
    },
    [url, setRowBusy, setRowError],
  );

  return { documents, busy, errors, upload, remove };
}

export function DocumentsStep({
  documents,
  busy,
  errors,
  onUpload,
  onRemove,
}: {
  documents: PublicDocuments;
  busy: Partial<Record<DocumentKey, RowBusy>>;
  errors: Partial<Record<DocumentKey, string>>;
  onUpload: (key: DocumentKey, file: File, label?: string) => void;
  onRemove: (key: DocumentKey) => Promise<boolean>;
}) {
  const [otherLabel, setOtherLabel] = useState(() => documents.lainnya?.label ?? "");
  const fileInputs = useRef<Partial<Record<DocumentKey, HTMLInputElement | null>>>({});
  const uploadButtons = useRef<Partial<Record<DocumentKey, HTMLButtonElement | null>>>({});
  const removeButtons = useRef<Partial<Record<DocumentKey, HTMLButtonElement | null>>>({});
  const [confirmKey, setConfirmKey] = useState<DocumentKey | null>(null);
  const restoreFocusTo = useRef<DocumentKey | null>(null);

  // When the confirm dialog closes, put focus somewhere sensible: back on Hapus
  // if the file is still there (cancelled / failed), otherwise on that row's
  // Unggah button (Hapus is gone). Deferred a tick so it lands after the
  // dialog's own focus restoration.
  useEffect(() => {
    if (confirmKey !== null) return;
    const key = restoreFocusTo.current;
    if (!key) return;
    restoreFocusTo.current = null;
    const present = !!documents[key];
    setTimeout(() => {
      (present ? removeButtons : uploadButtons).current[key]?.focus();
    }, 0);
  }, [confirmKey, documents]);

  const confirmItem = confirmKey
    ? (DOCUMENT_ITEMS as readonly DocumentItem[]).find((i) => i.key === confirmKey)
    : undefined;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-emerald-950">Berkas pendukung</h2>
      <p className="text-sm text-emerald-900/70">
        Mengunggah berkas bersifat opsional. Berkas yang belum sempat diunggah dapat dibawa langsung
        ke sekolah. Foto dari kamera, galeri, atau PDF semuanya bisa.
      </p>

      <ul className="space-y-3">
        {(DOCUMENT_ITEMS as readonly DocumentItem[]).map((item) => {
          const key = item.key as DocumentKey;
          const doc = documents[key];
          const state = busy[key];
          const error = errors[key];
          const inputId = `berkas-${key}`;
          const titleId = `berkas-${key}-title`;
          const errId = `berkas-${key}-error`;
          const isOther = key === "lainnya";
          return (
            <li key={key} className="rounded-xl border border-emerald-900/15 bg-white p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p id={titleId} className="text-sm font-medium text-emerald-950">
                    {item.label}
                    {!item.required && (
                      <span className="ml-2 text-xs font-normal text-emerald-900/60">Jika ada</span>
                    )}
                  </p>
                  {item.note && <p className="text-xs text-emerald-900/70">{item.note}</p>}
                  {doc ? (
                    <p className="flex items-start gap-1.5 text-sm text-emerald-800">
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
                      <span className="min-w-0 break-words">
                        <span className="sr-only">Terunggah: </span>
                        {doc.label ? `${doc.label} · ` : ""}
                        {doc.fileName}
                        {doc.size ? ` (${formatSize(doc.size)})` : ""}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-900/50">Belum diunggah</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <input
                    ref={(el) => {
                      fileInputs.current[key] = el;
                    }}
                    id={inputId}
                    type="file"
                    accept="image/jpeg,image/png,application/pdf,image/*"
                    className="sr-only"
                    tabIndex={-1}
                    aria-labelledby={titleId}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) onUpload(key, f, isOther ? otherLabel : undefined);
                    }}
                  />
                  {/* Buttons stay mounted while busy (aria-disabled, not
                      disabled) so keyboard focus is never dropped. */}
                  <Button
                    ref={(el: HTMLButtonElement | null) => {
                      uploadButtons.current[key] = el;
                    }}
                    type="button"
                    size="sm"
                    variant={doc ? "outline" : "default"}
                    className="min-h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:min-h-8"
                    aria-disabled={!!state}
                    aria-busy={state === "upload"}
                    aria-describedby={errId}
                    aria-label={
                      state === "upload"
                        ? `Mengunggah ${item.label}`
                        : `${doc ? "Ganti" : "Unggah"} ${item.label}`
                    }
                    onClick={() => {
                      if (!state) fileInputs.current[key]?.click();
                    }}
                  >
                    {state === "upload" ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <Paperclip size={14} aria-hidden />
                    )}{" "}
                    {state === "upload" ? "Mengunggah…" : doc ? "Ganti" : "Unggah"}
                  </Button>
                  {doc && (
                    <Button
                      ref={(el: HTMLButtonElement | null) => {
                        removeButtons.current[key] = el;
                      }}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-11 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:min-h-8"
                      aria-disabled={!!state}
                      aria-busy={state === "delete"}
                      aria-describedby={errId}
                      aria-label={
                        state === "delete" ? `Menghapus ${item.label}` : `Hapus ${item.label}`
                      }
                      onClick={() => {
                        if (!state) {
                          restoreFocusTo.current = key;
                          setConfirmKey(key);
                        }
                      }}
                    >
                      {state === "delete" && <Loader2 size={14} className="animate-spin" aria-hidden />}{" "}
                      {state === "delete" ? "Menghapus…" : "Hapus"}
                    </Button>
                  )}
                </div>
              </div>

              {isOther && !doc && (
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="berkas-lainnya-nama">Nama berkas</Label>
                  <Input
                    id="berkas-lainnya-nama"
                    value={otherLabel}
                    maxLength={MAX_LABEL}
                    placeholder="Contoh: Kartu imunisasi"
                    onChange={(e) => setOtherLabel(e.target.value)}
                  />
                </div>
              )}

              {/* The row's only live region. */}
              <p id={errId} aria-live="polite" className={error ? "mt-2 text-sm text-destructive" : "sr-only"}>
                {error ?? ""}
              </p>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirmKey !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmKey(null);
        }}
        title="Hapus berkas ini?"
        description={
          confirmItem
            ? `${confirmItem.label} akan dihapus dari formulir. Bapak/Ibu perlu mengunggahnya lagi jika diperlukan.`
            : undefined
        }
        confirmLabel="Hapus"
        destructive
        loading={confirmKey ? busy[confirmKey] === "delete" : false}
        onConfirm={async () => {
          if (confirmKey) await onRemove(confirmKey);
        }}
      />
    </div>
  );
}
