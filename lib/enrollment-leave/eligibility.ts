import { formatYearMonth } from "./months";
import { academicYearBillingWindow } from "./window";

export type LeaveEligibility = {
  eligible: boolean;
  /** Indonesian reason an enrollment cannot take a new leave; null when eligible. */
  ineligibleReason: string | null;
  /** The months a leave may cover, `YYYY-MM`; null when the year has no usable dates. */
  window: { from: string; to: string } | null;
};

/**
 * Can this enrollment take a NEW leave? ACTIVE enrollment, ACTIVE student, a
 * class in a year that is not ARCHIVED, and a year with usable dates. Mirrors
 * the checks POST /api/students/[id]/leaves enforces, so the picker offers
 * only what the server accepts.
 */
export function leaveEligibility(input: {
  enrollmentStatus: string;
  studentStatus: string;
  yearStatus: string;
  year: { startDate: string; endDate: string };
}): LeaveEligibility {
  const win = academicYearBillingWindow(input.year);
  const window = win ? { from: formatYearMonth(win.from), to: formatYearMonth(win.to) } : null;
  let ineligibleReason: string | null = null;
  if (input.studentStatus !== "ACTIVE") ineligibleReason = "Siswa tidak aktif.";
  else if (input.enrollmentStatus !== "ACTIVE") ineligibleReason = "Pendaftaran kelas ini tidak aktif.";
  else if (input.yearStatus === "ARCHIVED") ineligibleReason = "Tahun ajaran sudah diarsipkan.";
  else if (!window) ineligibleReason = "Tahun ajaran belum punya rentang bulan yang valid.";
  return { eligible: ineligibleReason === null, ineligibleReason, window };
}
