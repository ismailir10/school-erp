import { getStatusConfig } from "@/components/ui/status-badge";
import type { AdmissionStage } from "./types";

/**
 * Filter vocabulary of the unified Pendaftaran list. The stage names themselves
 * (labels and tones) live in `StatusBadge`, so the filter, the row chip and the
 * stat cards cannot drift apart.
 */

/** Stages in pipeline order, then the two exits. */
const TAHAP_ORDER: AdmissionStage[] = [
  "BARU",
  "FORMULIR_DIKIRIM",
  "FORMULIR_MASUK",
  "DITERIMA",
  "SISWA",
  "DITOLAK",
  "BATAL",
];

export const TAHAP_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Semua tahap" },
  ...TAHAP_ORDER.map((stage) => ({ value: stage, label: getStatusConfig(stage).label })),
];

const TAHAP_SET = new Set<string>(TAHAP_ORDER);

/** A `?tahap=` value from the URL, or "all" when it is missing or not a stage. */
export function parseTahap(value: string | null | undefined): string {
  return value && TAHAP_SET.has(value) ? value : "all";
}

/** The only `?payment=` value the list understands. */
export const PAYMENT_UNPAID = "unpaid";
