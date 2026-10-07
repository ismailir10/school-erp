export type AttendanceCounts = {
  hadir: number;
  sakit: number;
  alpa: number;
  izin: number;
  logged: number;
};

export type AttendanceBannerState =
  | { kind: "all-present" }
  | {
      kind: "attention";
      tone: "warm" | "neutral";
      /**
       * What the banner's second line may say. The tone alone could not carry
       * it: "warm" covers Sakit and Alpa, and a "semoga lekas sehat" line under
       * an Alpa-only week tells a parent their child is sick when the school
       * marked them absent without notice (TCH-12 / X-7). Alpa outranks Sakit:
       * an unexplained absence is the one the parent has to act on, so a week
       * with both leads with it (PARX-4) and reports Sakit via `alsoSick`.
       */
      reason: "sick" | "absent" | "permission";
      /** The week also has a Sakit day; only meaningful under `reason: "absent"`. */
      alsoSick: boolean;
      line: string;
    }
  | null;

/**
 * Decide whether the parent attendance week-summary banner should render and
 * which tone to use.
 *
 * - `all-present`: every weekday logged as PRESENT → celebration card.
 * - `attention` / `warm`: at least one SICK or ABSENT day → orange copy. Any
 *   ABSENT day makes `reason: "absent"` (even alongside Sakit); the get-well
 *   line is reserved for `reason: "sick"` (Sakit, no Alpa).
 * - `attention` / `neutral`: only PERMISSION days (no SICK/ABSENT) → sky-blue "izin" copy.
 *   This branch is the fix for UAT 2026-05-12 MAJOR-02 — PERMISSION-only weeks
 *   previously rendered no banner.
 * - `null`: nothing logged yet or only PRESENT days short of a full week.
 */
export function attendanceBannerState(counts: AttendanceCounts): AttendanceBannerState {
  const { hadir, sakit, alpa, izin, logged } = counts;
  if (logged === 5 && hadir === 5) return { kind: "all-present" };
  const hasAttention = sakit > 0 || alpa > 0 || izin > 0;
  if (!hasAttention) return null;
  const tone: "warm" | "neutral" = sakit > 0 || alpa > 0 ? "warm" : "neutral";
  const reason: "sick" | "absent" | "permission" =
    alpa > 0 ? "absent" : sakit > 0 ? "sick" : "permission";
  const izinPart = izin > 0 ? ` · Izin ${izin}` : "";
  const line = `Hadir ${hadir} · Sakit ${sakit} · Alpa ${alpa}${izinPart}`;
  return { kind: "attention", tone, reason, alsoSick: sakit > 0, line };
}
