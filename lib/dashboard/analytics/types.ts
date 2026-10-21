export type AnalyticsSource<T> = { status: "ready"; data: T } | { status: "unavailable" } | { status: "hidden" };

export type AttendanceDay = { date: string; present: number; permission: number; sick: number; absent: number; total: number; rate: number }; // rate = integer % 0..100
export type AttendanceAnalytics = {
  windowStart: string; windowEnd: string;          // YYYY-MM-DD, inclusive, 30 calendar days ending today (Asia/Jakarta)
  days: AttendanceDay[];                            // only days that have records, ascending
  rate: number | null;                              // integer %, Σpresent/Σtotal over the window; null when no records
  previousRate: number | null;                      // same for the 30 days before windowStart
  totalRecords: number;
  lowestClasses: { classSectionId: string; name: string; rate: number; total: number }[]; // up to 3, ascending by rate then name; only ACTIVE class sections with ≥1 record
};

export type JournalWeek = { weekStart: string; completionPct: number | null; checked: number; possible: number; teacherNotes: number; guardianNotes: number };
export type JournalAnalytics = {
  weeks: JournalWeek[];                              // exactly 8 Mon-start weeks, oldest first, the last one is the current week
  thisWeekPct: number | null;                        // = weeks[7].completionPct
  teacherNotes: number; guardianNotes: number;       // totals over the 8 weeks
  leastCompleteClasses: { classSectionId: string; name: string; completionPct: number }[]; // up to 3, ascending, this week, classes with possible > 0
};

export type AgingKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
export type FinanceAnalytics = {
  months: { month: string; billed: number; collected: number }[]; // exactly 6 "YYYY-MM", oldest first, last = current month (Jakarta)
  thisMonth: { billed: number; paid: number; rate: number | null }; // invoices due this month: Σ totalDue, Σ totalPaid, integer %
  aging: { key: AgingKey; amount: number; count: number }[];        // always all 5 keys in that order
  outstandingTotal: number;
};
