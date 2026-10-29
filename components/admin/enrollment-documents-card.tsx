"use client";

import { MESSAGES } from "@/lib/feedback";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionCard } from "@/components/ui/section-card";
import {
  DOCUMENT_ITEMS,
  REQUIRED_DOCUMENT_COUNT,
  type AdminDocuments,
  type DocumentKey,
} from "@/lib/enrollment/documents";

class SaveError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * "Kelengkapan Berkas" card on `/admin/enrollments/[id]`.
 *
 * One row per paper-form item: uploaded by the parent (Lihat opens the
 * admin-gated stream route, never a storage token), received on paper (staff
 * tick), or still missing. The tick is allowed after conversion too, so the
 * card gates only on `canEdit` (admissions.edit), not on application status.
 */
export function EnrollmentDocumentsCard({
  applicationId,
  documents,
  canEdit,
  onChange,
}: {
  applicationId: string;
  documents: AdminDocuments;
  canEdit: boolean;
  /** Called after a tick is saved, so a host showing derived counts can refresh. */
  onChange?: () => void;
}) {
  // Optimistic ticks keyed by item; dropped again if the save fails.
  const [overrides, setOverrides] = useState<Partial<Record<DocumentKey, boolean>>>({});
  const [saving, setSaving] = useState<Partial<Record<DocumentKey, boolean>>>({});

  const receivedOf = (key: DocumentKey) => overrides[key] ?? documents[key]?.receivedPhysical ?? false;

  const done = DOCUMENT_ITEMS.filter(
    (i) => i.required && (documents[i.key]?.hasFile || receivedOf(i.key)),
  ).length;

  async function toggle(key: DocumentKey, checked: boolean) {
    setOverrides((o) => ({ ...o, [key]: checked }));
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const res = await fetch(`/api/enrollments/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentsReceived: { [key]: checked } }),
      });
      if (!res.ok) {
        throw new SaveError(res.status);
      }
      onChange?.();
    } catch (err) {
      setOverrides((o) => {
        const next = { ...o };
        delete next[key];
        return next;
      });
      // Never surface raw API error codes to staff.
      toast.error(
        err instanceof SaveError && err.status === 403
          ? "Anda tidak memiliki akses untuk mengubah berkas."
          : MESSAGES.saveFailed,
      );
    } finally {
      setSaving((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
    }
  }

  return (
    <SectionCard
      title="Kelengkapan Berkas"
      action={
        <p className="text-sm font-normal text-muted-foreground" aria-live="polite">
          {done} / {REQUIRED_DOCUMENT_COUNT} berkas lengkap
        </p>
      }
    >

      <ul className="divide-y">
        {DOCUMENT_ITEMS.map((item) => {
          const key = item.key;
          const doc = documents[key];
          const hasFile = doc?.hasFile === true;
          const received = receivedOf(key);
          const title = key === "lainnya" && doc?.label ? `${item.label}: ${doc.label}` : item.label;
          return (
            <li
              key={key}
              className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">
                  {title}
                  {!item.required && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">Opsional</span>
                  )}
                </p>
                {hasFile && doc?.fileName && (
                  <p className="break-all text-xs text-muted-foreground">{doc.fileName}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {hasFile ? (
                  <Badge variant="default">Diunggah</Badge>
                ) : received ? (
                  <Badge variant="secondary">Diterima fisik</Badge>
                ) : (
                  <Badge variant="outline">Belum</Badge>
                )}
                {hasFile && (
                  <a
                    href={`/api/enrollments/${applicationId}/documents/${key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Lihat ${title}`}
                    className="inline-flex min-h-11 items-center gap-1 text-sm text-primary-text underline-offset-4 hover:underline sm:min-h-8"
                  >
                    Lihat <ExternalLink size={12} aria-hidden />
                  </a>
                )}
                <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
                  <Checkbox
                    checked={received}
                    disabled={!canEdit || saving[key] === true}
                    onCheckedChange={(c) => void toggle(key, c === true)}
                    aria-label={`Diterima fisik: ${title}`}
                  />
                  <span aria-hidden>Diterima fisik</span>
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
