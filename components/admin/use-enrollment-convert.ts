"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { DuplicateCandidate, GuardianMismatch } from "@/components/admin/enrollment-convert-confirm";

type CopyStatus = "copied" | "skipped_existing" | "missing" | "failed";
type DocumentsCopied = { ktpAyah?: CopyStatus; ktpIbu?: CopyStatus; kk?: CopyStatus };
type ReusedGuardian = { role: "AYAH" | "IBU"; name: string; otherChildrenCount: number };

const COPIED_LABELS: [keyof DocumentsCopied, string][] = [
  ["ktpAyah", "KTP Ayah"],
  ["ktpIbu", "KTP Ibu"],
  ["kk", "KK"],
];

/** Toast copy for the guardian-document copy that runs after convert. */
function copyOutcomeMessages(copied: DocumentsCopied | undefined) {
  if (!copied) return { copiedText: "", anyFailed: false };
  const done = COPIED_LABELS.filter(([k]) => copied[k] === "copied").map(([, l]) => l);
  return {
    copiedText: done.length > 0 ? ` ${done.join(", ")} disalin ke data wali.` : "",
    anyFailed: COPIED_LABELS.some(([k]) => copied[k] === "failed"),
  };
}

/** Which confirmation the convert route asked for; null = none open. */
export type ConvertPrompt =
  | { kind: "duplicate"; candidates: DuplicateCandidate[] }
  | { kind: "guardians"; guardians: GuardianMismatch[] }
  | null;

/** The flags already confirmed in this convert attempt; a later 409 must not forget an earlier answer. */
type Confirmations = { confirmDuplicate?: true; confirmGuardians?: true };

/** Server text is Indonesian prose; a bare word ("Forbidden", "Not found") or a missing body gets our own copy. */
function convertErrorText(status: number, body: { error?: unknown } | null, fallback: string): string {
  const text = typeof body?.error === "string" ? body.error.trim() : "";
  if (text.includes(" ") && !(status === 404 && /^not found$/i.test(text))) return text;
  if (status === 403) return "Anda tidak memiliki izin untuk tindakan ini.";
  if (status === 404) return "Formulir tidak ditemukan. Muat ulang halaman.";
  return fallback;
}

/** The API names each missing field; staff can fix it right from the toast. */
export function toastMissingData(message: string, fieldErrors: { message: string }[], openEditor: () => void) {
  const detail = fieldErrors.map((e) => e.message).join(" ");
  toast.error(detail || message, { action: { label: "Ubah data", onClick: openEditor } });
}

/** Dialogs animate out in 100ms; the next one waits for that so overlays never stack. */
const DIALOG_EXIT_MS = 150;
const afterDialogExit = () => new Promise<void>((resolve) => setTimeout(resolve, DIALOG_EXIT_MS));

/**
 * The convert state machine for the formulir detail page: the confirm dialog, the request, and the
 * two questions the route may ask (possible duplicate, existing wali under another name).
 * Confirming a question re-sends the convert with that flag added to the ones already answered.
 * `convert` never throws: every outcome is a toast or a dialog.
 */
export function useEnrollmentConvert({
  id,
  load,
  openEditor,
  returnFocus,
}: {
  id: string;
  load: (showSkeleton?: boolean) => Promise<void>;
  openEditor: () => void;
  returnFocus: (testId?: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The ref mirrors the state so a dialog that closes after its own confirm can tell
  // "answered, a new question opened" from "cancelled".
  const [prompt, setPromptState] = useState<ConvertPrompt>(null);
  const promptRef = useRef<ConvertPrompt>(null);
  const confirmations = useRef<Confirmations>({});
  const setPrompt = (p: ConvertPrompt) => {
    promptRef.current = p;
    setPromptState(p);
  };

  function toastConverted(body: {
    student?: { id?: string };
    documentsCopied?: DocumentsCopied;
    reusedGuardians?: ReusedGuardian[];
  }) {
    const { copiedText, anyFailed } = copyOutcomeMessages(body.documentsCopied);
    const message = `Siswa berhasil dibuat dari formulir.${copiedText}`;
    const description =
      (body.reusedGuardians ?? []).length > 0 ? "Wali sudah terdaftar; anak ditautkan ke akun yang sama." : undefined;
    const studentId = body.student?.id;
    if (studentId) {
      toast.success(message, {
        description,
        duration: 10000,
        action: { label: "Lihat siswa", onClick: () => router.push(`/admin/students/${studentId}`) },
        // sonner has one `action`; `cancel` carries "Daftarkan ke kelas" for its secondary styling only.
        cancel: {
          label: "Daftarkan ke kelas",
          onClick: () => router.push(`/admin/students/${studentId}?aksi=daftarkan-kelas`),
        },
      });
    } else {
      toast.success(message, { description, duration: 10000 });
    }
    if (anyFailed) {
      toast.warning("Sebagian berkas gagal disalin ke data wali. Unggah manual dari halaman wali.");
    }
  }

  async function post() {
    setBusy(true);
    try {
      const res = await fetch(`/api/enrollments/${id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmations.current),
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

      if (res.ok) {
        toastConverted((body ?? {}) as Parameters<typeof toastConverted>[0]);
        try {
          await load(false);
        } catch {
          // The toast already confirmed the conversion; the view refreshes on the next load.
        }
        returnFocus();
        return;
      }

      const code = typeof body?.code === "string" ? body.code : null;
      if (res.status === 409 && code === "POSSIBLE_DUPLICATE" && Array.isArray(body?.candidates)) {
        await afterDialogExit();
        setPrompt({ kind: "duplicate", candidates: body.candidates as DuplicateCandidate[] });
        return;
      }
      if (res.status === 409 && code === "GUARDIAN_NAME_MISMATCH" && Array.isArray(body?.guardians)) {
        await afterDialogExit();
        setPrompt({ kind: "guardians", guardians: body.guardians as GuardianMismatch[] });
        return;
      }

      const message = convertErrorText(res.status, body, "Gagal menjadikan siswa. Coba lagi.");
      if (res.status === 400 && Array.isArray(body?.errors)) {
        toastMissingData(
          message,
          (body.errors as { message?: unknown }[]).filter((e): e is { message: string } => typeof e?.message === "string"),
          openEditor,
        );
      } else if (code === "GUARDIAN_INACTIVE") {
        toast.error(message, { action: { label: "Ubah data", onClick: openEditor } });
      } else {
        toast.error(message);
      }
      // The page no longer matches the server (already converted, or no longer convertible).
      if (code === "ALREADY_CONVERTED" || code === "NOT_CONVERTIBLE") void load(false);
    } catch {
      toast.error("Gagal menjadikan siswa. Periksa koneksi, lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  /** The confirm dialog's action: a fresh attempt, with no earlier answers. */
  function convert() {
    confirmations.current = {};
    setConfirmOpen(false);
    return post();
  }

  /** A question dialog's action: close it, then re-send with its flag added. */
  function answer(flag: keyof Confirmations) {
    confirmations.current = { ...confirmations.current, [flag]: true };
    setPrompt(null);
    return post();
  }

  // A question dialog closing: cancelled only when it is still the open question
  // (an answer clears it before sending, so its later close is ignored).
  function closePrompt(kind: "duplicate" | "guardians") {
    if (promptRef.current?.kind !== kind) return;
    setPrompt(null);
    returnFocus("enrollment-primary-action");
  }

  return { busy, confirmOpen, setConfirmOpen, prompt, convert, answer, closePrompt };
}
