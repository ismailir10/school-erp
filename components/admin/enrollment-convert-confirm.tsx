"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDateShort } from "@/lib/format";

/**
 * The two questions `POST /api/enrollments/[id]/convert` can ask before it
 * creates anything. Both are plain two-way confirms (ConfirmDialog): "go ahead"
 * re-sends the convert with the matching confirmation flag, "Batal" leaves the
 * formulir untouched. The page owns the request; these only show the evidence.
 */

export type DuplicateCandidate = {
  id: string;
  name: string;
  dateOfBirth: string | null;
  guardianNames: string[];
};

export type GuardianMismatch = {
  role: "AYAH" | "IBU";
  formName: string;
  existingName: string;
  otherChildrenCount: number;
};

/** Keep the last non-null value so the list does not empty out while the dialog animates closed. */
function useLastNonNull<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}

// Capped so Batal and the confirm button stay on screen on a phone with several rows; focusable so the
// list can be scrolled from the keyboard.
const LIST_CLASS = "max-h-[40dvh] space-y-2 overflow-y-auto text-sm";

const ROLE_LABEL: Record<GuardianMismatch["role"], string> = { AYAH: "Ayah", IBU: "Ibu" };

export function ConvertDuplicateConfirm({
  candidates,
  childName,
  onConfirm,
  onOpenChange,
}: {
  /** Null = closed. */
  candidates: DuplicateCandidate[] | null;
  childName: string;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const list = useLastNonNull(candidates) ?? [];
  return (
    <ConfirmDialog
      open={candidates !== null}
      onOpenChange={onOpenChange}
      focusCancel
      title="Sudah ada siswa dengan data mirip"
      description={`Periksa dulu supaya ${childName || "anak ini"} tidak terdaftar dua kali. Kalau memang anak yang berbeda, lanjutkan.`}
      confirmLabel="Tetap jadikan siswa"
      onConfirm={onConfirm}
    >
      <ul aria-label="Siswa dengan data mirip" tabIndex={0} className={LIST_CLASS}>
        {list.map((c) => (
          <li key={c.id} className="rounded-md border border-border px-3 py-2">
            <p className="font-medium">{c.name}</p>
            <p className="text-muted-foreground">
              {c.dateOfBirth ? `Lahir ${formatDateShort(c.dateOfBirth)}` : "Tanggal lahir belum diisi"}
              {c.guardianNames.length > 0 ? ` · Wali: ${c.guardianNames.join(", ")}` : ""}
            </p>
            <a
              href={`/admin/students/${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Lihat siswa
              <ExternalLink size={12} aria-hidden="true" className="mb-0.5 ml-1 inline" />
              {" "}
              <span className="sr-only">
                {c.name}, tab baru
              </span>
            </a>
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

export function ConvertGuardianConfirm({
  guardians,
  onConfirm,
  onOpenChange,
}: {
  /** Null = closed. */
  guardians: GuardianMismatch[] | null;
  onConfirm: () => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const list = useLastNonNull(guardians) ?? [];
  return (
    <ConfirmDialog
      open={guardians !== null}
      onOpenChange={onOpenChange}
      focusCancel
      title="Email ini sudah terdaftar atas nama lain"
      description="Kalau dilanjutkan, anak ini ditautkan ke wali yang sudah ada dan nama di data wali tidak diubah. Kalau salah ketik, pilih Batal lalu perbaiki lewat Ubah data."
      confirmLabel="Tetap tautkan"
      onConfirm={onConfirm}
    >
      <ul aria-label="Wali dengan nama berbeda" tabIndex={0} className={LIST_CLASS}>
        {list.map((g) => (
          <li key={g.role} className="rounded-md border border-border px-3 py-2">
            <p className="font-medium">{ROLE_LABEL[g.role]}</p>
            <p>
              Di formulir: <span className="font-medium">{g.formName}</span>
            </p>
            <p>
              Di data wali: <span className="font-medium">{g.existingName}</span>
            </p>
            {g.otherChildrenCount > 0 && (
              <p className="text-muted-foreground">Sudah tertaut ke {g.otherChildrenCount} anak lain.</p>
            )}
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}
