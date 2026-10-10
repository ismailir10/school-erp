"use client";

import Link from "next/link";
import { DossierSection } from "@/components/admin/dossier-section";
import type { Guardian } from "./types";

/**
 * "Dokumen Keluarga" — read-only KK preview resolved via the primary
 * guardian (active primary → first active fallback → empty-state nudge).
 * Preview src is the admin-only auth-proxied endpoint (cookies forwarded by
 * the browser); raw filesystem paths never leak to the DOM.
 */
export function DokumenSection({
  kkGuardian,
  canEdit,
  hasKk,
  open,
  onOpenChange,
}: {
  kkGuardian: Guardian | null;
  canEdit: boolean;
  hasKk: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DossierSection id="dokumen" label="Dokumen Keluarga" open={open} onOpenChange={onOpenChange}>
      {!kkGuardian ? (
        <p className="text-sm text-muted-foreground">
          {canEdit ? "Belum ada wali aktif — tambahkan wali untuk mengunggah KK." : "Belum ada wali aktif."}
        </p>
      ) : hasKk ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            KK · {kkGuardian.parent.name}
            {kkGuardian.isPrimary ? " (wali utama)" : ""}
          </p>
          {/* <embed> handles both image and PDF — browser sniffs the
              response Content-Type. */}
          <embed
            src={`/api/parents/${kkGuardian.parent.id}/kk`}
            className="h-64 w-full max-w-md rounded-lg border bg-muted"
            aria-label={`KK keluarga ${kkGuardian.parent.name}`}
          />
          <a
            href={`/api/parents/${kkGuardian.parent.id}/kk`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-primary-text hover:underline"
          >
            Buka di tab baru →
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            KK belum diunggah untuk wali {kkGuardian.parent.name}.
          </p>
          <Link
            href={`/admin/guardians/${kkGuardian.parent.id}`}
            className="text-sm text-primary-text hover:underline"
          >
            {canEdit ? "Unggah KK di halaman wali →" : "Lihat data wali →"}
          </Link>
        </div>
      )}
    </DossierSection>
  );
}
