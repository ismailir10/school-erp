import type {
  AnalyticsSource,
  AttendanceAnalytics,
  FinanceAnalytics,
  JournalAnalytics,
} from "@/lib/dashboard/analytics";

export const ready = <T,>(data: T): AnalyticsSource<T> => ({ status: "ready", data });
export const unavailable = { status: "unavailable" } as const;
export const hidden = { status: "hidden" } as const;

export function attendanceFixture(overrides: Partial<AttendanceAnalytics> = {}): AttendanceAnalytics {
  return {
    windowStart: "2026-09-22",
    windowEnd: "2026-10-21",
    days: [
      { date: "2026-10-19", present: 40, permission: 1, sick: 2, absent: 1, total: 44, rate: 91 },
      { date: "2026-10-20", present: 42, permission: 1, sick: 1, absent: 0, total: 44, rate: 95 },
      { date: "2026-10-21", present: 41, permission: 0, sick: 2, absent: 1, total: 44, rate: 93 },
    ],
    rate: 93,
    previousRate: 90,
    totalRecords: 132,
    lowestClasses: [
      { classSectionId: "cs-1", name: "Kelas 2A", rate: 82, total: 40 },
      { classSectionId: "cs-2", name: "Kelas 4B", rate: 88, total: 36 },
    ],
    ...overrides,
  };
}

export function journalFixture(overrides: Partial<JournalAnalytics> = {}): JournalAnalytics {
  const starts = ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"];
  return {
    weeks: starts.map((weekStart, index) => ({
      weekStart,
      completionPct: 40 + index * 7,
      checked: 40 + index * 7,
      possible: 100,
      teacherNotes: index,
      guardianNotes: 1,
    })),
    thisWeekPct: 89,
    teacherNotes: 28,
    guardianNotes: 8,
    leastCompleteClasses: [
      { classSectionId: "cs-9", name: "Kelas 1C", completionPct: 52 },
      { classSectionId: "cs-3", name: "Kelas 3A", completionPct: 64 },
    ],
    ...overrides,
  };
}

export function financeFixture(overrides: Partial<FinanceAnalytics> = {}): FinanceAnalytics {
  return {
    months: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month, index) => ({
      month,
      billed: 10_000_000 + index * 1_000_000,
      collected: 8_000_000 + index * 1_000_000,
    })),
    thisMonth: { billed: 16_000_000, paid: 12_400_000, rate: 78 },
    aging: [
      { key: "current", amount: 5_000_000, count: 4 },
      { key: "d1_30", amount: 3_000_000, count: 3 },
      { key: "d31_60", amount: 2_000_000, count: 2 },
      { key: "d61_90", amount: 1_000_000, count: 1 },
      { key: "d90_plus", amount: 500_000, count: 1 },
    ],
    outstandingTotal: 11_500_000,
    ...overrides,
  };
}
