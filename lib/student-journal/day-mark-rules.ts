/**
 * Pure rules for "hari tanpa buku penghubung". Kept free of Prisma so the entry
 * page and the dialog can share them with the route (`day-marks.ts` imports Prisma).
 */

/** Only school days can be marked, and not ones that have not happened yet. */
export function isMarkableDate(date: string, todayYmd: string): boolean {
  if (date > todayYmd) return false;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

export const DAY_MARK_NOT_MARKABLE_MSG =
  "Hanya hari sekolah (Senin–Jumat) yang sudah lewat atau hari ini yang bisa ditandai.";

/** One-tap keterangan under the field; the guru can still type anything. */
export const DAY_MARK_SUGGESTIONS = ["Renang", "Libur", "Kegiatan luar"] as const;
