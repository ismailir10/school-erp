import { toast } from "sonner";
import { userMessage } from "@/lib/api/client-errors";

/**
 * The generic feedback copy, worded per `.claude/standards/voice.md` § Errors
 * (actionable, no status codes, a warm "ya" on retries). Domain-specific
 * messages ("Absensi tidak tersimpan…") stay at their call site; only the
 * generic ones live here so the same failure reads the same everywhere.
 */
export const MESSAGES = {
  network: "Koneksi terputus. Coba lagi sebentar ya.",
  saveFailed: "Belum tersimpan. Coba lagi sebentar ya.",
  deleteFailed: "Belum terhapus. Coba lagi sebentar ya.",
  generic: "Ada yang tidak beres. Coba lagi sebentar ya.",
  required: "Wajib diisi.",
  loadFailed: (what: string) => `${what} belum bisa dimuat. Coba lagi sebentar ya.`,
} as const;

export const RETRY_LABEL = "Coba lagi";

type ToastErrorOptions = {
  /** Shows a "Coba lagi" action. A toast with a retry stays until dismissed. */
  retry?: () => void;
  /** Keep the toast until dismissed: failed saves of a record the user is entering. */
  persistent?: boolean;
  /** Reuse an id so repeated failures replace one toast instead of stacking. */
  id?: string | number;
};

/**
 * Error toast with the house rules baked in: a failed save of the user's own
 * record persists and offers a retry (ui.md § Overlays Rule); everything else
 * keeps Sonner's short default.
 */
export function toastError(message: string, { retry, persistent, id }: ToastErrorOptions = {}) {
  return toast.error(message, {
    id,
    duration: retry || persistent ? Infinity : undefined,
    action: retry ? { label: RETRY_LABEL, onClick: retry } : undefined,
  });
}

/** `toastError` for a caught error: our translation if we have one, else the fallback. */
export function toastCaughtError(err: unknown, fallback: string, options?: ToastErrorOptions) {
  return toastError(userMessage(err, fallback), options);
}
