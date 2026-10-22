import {
  loadAttendanceAnalytics,
  loadFinanceAnalytics,
  loadJournalAnalytics,
  type AnalyticsSource,
} from "@/lib/dashboard/analytics";
import { AgingCard } from "./aging-card";
import { ANALYTICS_HEADING_ID, AnalyticsHeading } from "./analytics-heading";
import { FinanceTrendCard } from "./finance-trend-card";
import { HeadlineBand } from "./headline-band";
import { JournalCard } from "./journal-card";
import { StudentAttendanceCard } from "./student-attendance-card";

/**
 * Same contract as the Dasbor's other sources: `hidden` when the viewer lacks
 * the permission, `unavailable` (logged, never a false zero) when the query
 * throws, so one failed source only blanks its own card.
 */
async function loadSource<T>(key: string, allowed: boolean, load: () => Promise<T>): Promise<AnalyticsSource<T>> {
  if (!allowed) return { status: "hidden" };
  try {
    return { status: "ready", data: await load() };
  } catch (error) {
    console.error("[dashboard] source unavailable", { key, error });
    return { status: "unavailable" };
  }
}

/**
 * The "Analitik" section under the action region. Async server component: it
 * renders inside a Suspense boundary on /admin so its aggregates never delay
 * "Perlu ditangani". Attendance and buku penghubung are for every admin role
 * (their modules are admin-only); finance needs `invoices.view`.
 */
export async function DashboardAnalytics({
  tenantId,
  today,
  canSeeFinance,
}: {
  tenantId: string;
  today: string;
  canSeeFinance: boolean;
}) {
  const [attendance, journal, finance] = await Promise.all([
    loadSource("analytics-attendance", true, () => loadAttendanceAnalytics(tenantId, today)),
    loadSource("analytics-journal", true, () => loadJournalAnalytics(tenantId, today)),
    loadSource("analytics-finance", canSeeFinance, () => loadFinanceAnalytics(tenantId, today)),
  ]);

  return (
    <section
      data-testid="dashboard-analytics"
      aria-labelledby={ANALYTICS_HEADING_ID}
      className="mt-section space-y-section"
    >
      <AnalyticsHeading />
      <div className="space-y-section">
        <HeadlineBand attendance={attendance} finance={finance} journal={journal} />
        <div className="grid items-start gap-section lg:grid-cols-2">
          <StudentAttendanceCard source={attendance} />
          <JournalCard source={journal} />
        </div>
        {finance.status !== "hidden" && (
          <div className="grid items-start gap-section xl:grid-cols-2">
            <FinanceTrendCard source={finance} />
            <AgingCard source={finance} />
          </div>
        )}
      </div>
    </section>
  );
}
