import { formatDate, formatMonthLabel } from "@/lib/format";
import { getYmdInTimezone } from "@/lib/attendance/timezone";

type SlipWithPeriod = {
  payrollRun: { periodEnd: string };
};

/** The slip for last month is promised after this day of the month. */
const SLIP_AVAILABLE_AFTER_DAY = 5;

/** Date-only part of a `YYYY-MM-DD` or ISO string. */
function dateOnly(value: string): string {
  return value.includes("T") ? value.split("T")[0] : value;
}

/** Returns { year, month (1-based), label } for the prior calendar month relative to `today`. */
export function priorMonthLabel(today: Date): { year: number; month: number; label: string } {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-based
  const label = formatMonthLabel(year, month);
  return { year, month, label };
}

/**
 * Returns true if `slips` contains any slip whose period ENDS in the given
 * year+month. A 21 Aug – 20 Sep cycle is the "September" slip, the same name the
 * list rows, the detail headline and the banner all use.
 */
export function hasSlipInMonth(
  slips: SlipWithPeriod[],
  year: number,
  month: number,
): boolean {
  return slips.some((s) => {
    // Parse only the date portion to avoid timezone offset issues.
    const [y, m] = dateOnly(s.payrollRun.periodEnd).split("-").map(Number);
    return y === year && m === month;
  });
}

/** "September 2026" for a payroll period, named by the month it ends in. */
export function periodMonthLabel(periodEnd: string): string {
  const [y, m] = dateOnly(periodEnd).split("-").map(Number);
  return formatMonthLabel(y, m);
}

/**
 * "21 Agustus – 20 September 2026". The year moves to the start date only when
 * the cycle crosses a year boundary ("21 Desember 2026 – 20 Januari 2027").
 */
export function formatPeriodRange(periodStart: string, periodEnd: string): string {
  const startYear = dateOnly(periodStart).slice(0, 4);
  const endYear = dateOnly(periodEnd).slice(0, 4);
  const start = formatDate(
    periodStart,
    startYear === endYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" },
  );
  return `${start} – ${formatDate(periodEnd)}`;
}

export type SlipBanner = {
  /** "upcoming" = still inside the promised window; "overdue" = the promised day has passed. */
  kind: "upcoming" | "overdue";
  title: string;
  description: string;
};

/**
 * What to tell the teacher about last month's slip, or null when it is already
 * here. Decided on the Asia/Jakarta calendar day. Never promises a date that has
 * already passed: from the 6th on, a missing slip is reported as "not issued yet".
 */
export function slipBanner(slips: SlipWithPeriod[], now: Date): SlipBanner | null {
  const [y, m, d] = getYmdInTimezone(now, "Asia/Jakarta").split("-").map(Number);
  const prior = priorMonthLabel(new Date(y, m - 1, 1));
  if (hasSlipInMonth(slips, prior.year, prior.month)) return null;

  if (d <= SLIP_AVAILABLE_AFTER_DAY) {
    return {
      kind: "upcoming",
      title: `Slip ${prior.label} akan tersedia setelah tanggal ${SLIP_AVAILABLE_AFTER_DAY}`,
      description: "Hubungi admin jika belum tersedia setelah tanggal tersebut.",
    };
  }
  return {
    kind: "overdue",
    title: `Slip ${prior.label} belum diterbitkan admin`,
    description: "Hubungi admin bila perlu.",
  };
}
