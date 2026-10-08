/**
 * Shared constants for the admissions module, split out of
 * `app/admin/admissions/page.tsx` (T5, cycle 2026-09-27-admin-finish-standard).
 * No behaviour change — moved verbatim.
 */

export const SOURCE_LABELS: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  WALK_IN: "Datang Langsung",
  WEBSITE: "Website",
  REFERRAL: "Referensi",
  OTHER: "Lainnya",
};

// One name per status, shared by the filter, the stat cards and the toasts.
// Mirrors the StatusBadge labels so the row chip says the same thing
// (R2-ADMIN-14: the stat card said "Diterima" while the row said "Terdaftar").
export const ADMISSION_STATUS_LABELS: Record<string, string> = {
  INQUIRY: "Pertanyaan",
  VISIT_SCHEDULED: "Kunjungan",
  VISITED: "Sudah Kunjungan",
  ADMITTED: "Diterima",
  CANCELLED: "Dibatalkan",
};

// Happy-path transitions for the Admission state machine.
// Mirrors VALID_TRANSITIONS in `app/api/admissions/[id]/route.ts`.
// Terminal state CANCELLED has no next step. ADMITTED is terminal in the
// next-action surface (no entry below) but retains ADMITTED → CANCELLED via
// VALID_TRANSITIONS. ADMITTED-with-studentId hides via the row-action
// early-return (see actions column cell). Cycle 2026-05-12 dropped REGISTERED
// — converted vs not is encoded by `studentId`.
export const NEXT_STATUS: Record<string, { status: string; label: string } | undefined> = {
  // `label` is the row-menu action (a verb phrase, sentence case) — not the
  // status name; the target status's name lives in ADMISSION_STATUS_LABELS.
  INQUIRY: { status: "VISIT_SCHEDULED", label: "Jadwalkan kunjungan" },
  VISIT_SCHEDULED: { status: "VISITED", label: "Tandai sudah berkunjung" },
  VISITED: { status: "ADMITTED", label: "Terima" },
};

// Terminal states — hide "Batalkan" when already at one of these.
export const TERMINAL_STATUSES = new Set(["CANCELLED"]);
