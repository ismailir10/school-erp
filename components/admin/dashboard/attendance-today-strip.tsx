import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DashboardRetry } from "@/components/admin/dashboard/admin-work-queue";

type AttendanceTodayData =
  | { status: "ready"; total: number; present: number; late: number; absent: number; pending?: number }
  | { status: "unavailable" };

/**
 * Single-line "today" attendance summary — replaces the dashboard's full
 * StatGrid + 7-day trend chart, which moved to `/admin/employee-attendance`.
 */
export function AttendanceTodayStrip({ data }: { data: AttendanceTodayData }) {
  return (
    <div data-testid="dashboard-attendance-strip" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-card">
      {data.status === "ready" ? (
        <p className="text-body">
          Kehadiran karyawan hari ini:{" "}
          <span className="font-semibold tabular-nums">{data.present}/{data.total}</span> hadir ·{" "}
          <span className="tabular-nums">{data.late}</span> terlambat ·{" "}
          <span className="tabular-nums">{data.absent}</span> tidak hadir
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-body text-muted-foreground">Ringkasan kehadiran belum dapat dimuat.</p>
          <DashboardRetry />
        </div>
      )}
      {data.status === "ready" && data.pending ? (
        <Link
          href="/admin/employee-attendance?tab=pending"
          data-testid="dashboard-attendance-pending"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-status-late-subtle px-3 text-small font-semibold text-status-late-text"
        >
          <span className="tabular-nums">{data.pending}</span> absensi perlu persetujuan
        </Link>
      ) : null}
      <Link href="/admin/employee-attendance" className={buttonVariants({ variant: "ghost", size: "sm", className: "shrink-0" })}>
        Lihat kehadiran
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
