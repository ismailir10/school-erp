import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { formatDate } from "@/lib/format";
import { ActivityFeed, QueueSummaryTiles, UrgentList, AttendanceTodayStrip, FinanceTiles } from "@/components/admin/dashboard";
import { DashboardRetry } from "@/components/admin/dashboard/admin-work-queue";
import { loadReceivables } from "@/lib/dashboard/receivables";
import { getRecentActivity } from "@/lib/dashboard/activity-feed";
import { buildAdminWorkQueue, rankUrgent, summarizeQueue, canViewAdminActivity } from "@/lib/dashboard/admin-work-queue";
import { loadAdminQueueSources } from "@/lib/dashboard/queue-sources";

export default async function AdminDashboard() {
  const session = await getSession();
  if (!session || !isAdminRole(session.role) || !session.tenantId) redirect("/");
  const tenantId = session.tenantId;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const can = (permission: string) => hasPermission(session, permission);
  const canSeeAttendance = can("hr.view") && can("attendance.view");

  const [sources, finance, attendance, activity] = await Promise.all([
    loadAdminQueueSources({ ...session, tenantId }, { take: 5 }),
    (async () => {
      if (!can("invoices.view")) return { status: "hidden" as const };
      try {
        return { status: "ready" as const, ...(await loadReceivables(tenantId)) };
      } catch (error) {
        console.error("[dashboard] source unavailable", { key: "finance", error });
        return { status: "unavailable" as const };
      }
    })(),
    (async () => {
      if (!canSeeAttendance) return { status: "hidden" as const };
      try {
        const [total, rows] = await Promise.all([
          prisma.employee.count({ where: { tenantId, status: "ACTIVE" } }),
          prisma.attendanceRecord.groupBy({ by: ["status"], where: { employee: { tenantId, status: "ACTIVE" }, date: today }, _count: true }),
        ]);
        const count = (status: string) => rows.find(row => row.status === status)?._count ?? 0;
        return { status: "ready" as const, total, present: count("PRESENT") + count("PRESENT_NO_CHECKOUT"), late: count("LATE"), absent: count("ABSENT") };
      } catch (error) {
        console.error("[dashboard] source unavailable", { key: "attendance", error });
        return { status: "unavailable" as const };
      }
    })(),
    (async () => {
      if (!can("hr.view")) return { status: "hidden" as const };
      try {
        const events = (await getRecentActivity(tenantId, 8)).filter(event => canViewAdminActivity(session, event.href)).slice(0, 5);
        return { status: "ready" as const, events };
      } catch (error) {
        console.error("[dashboard] source unavailable", { key: "activity", error });
        return { status: "unavailable" as const };
      }
    })(),
  ]);

  const items = buildAdminWorkQueue(sources);
  // Four rows keeps the dashboard inside one 1440x900 screen (e2e
  // admin-dashboard "fits one screen") even when the queue is full — with
  // admission inquiries as a queue source it usually is. The full list is one
  // click away via "Lihat semua".
  const urgent = rankUrgent(items).slice(0, 4);
  const summary = summarizeQueue(sources);

  return <>
    <PageHeader title="Perlu ditangani" description="Pekerjaan yang menunggu keputusan atau pemeriksaan Anda." actions={<p className="text-body text-muted-foreground">{formatDate(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>} />
    <div className="grid min-w-0 items-start gap-section xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-section xl:space-y-3">
        <QueueSummaryTiles items={summary.items} />
        {finance.status !== "hidden" && <FinanceTiles data={finance} />}
        <UrgentList items={urgent} total={summary.total} />
        {attendance.status !== "hidden" && <AttendanceTodayStrip data={attendance} />}
      </div>
      <div className="hidden space-y-field xl:block">
        {activity.status === "ready" && <ActivityFeed events={activity.events} />}
        {activity.status === "unavailable" && <div className="space-y-field rounded-lg border p-card"><p className="text-body text-muted-foreground">Aktivitas belum dapat dimuat.</p><DashboardRetry /></div>}
      </div>
    </div>
  </>;
}
