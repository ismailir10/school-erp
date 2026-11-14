"use client";

import { Badge } from "@/components/ui/badge";
import { MESSAGES } from "@/lib/feedback";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { AttendanceTrendChart, type WeeklyTrend } from "@/components/admin/dashboard";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AdminTabs, AdminTabsContent, AdminTabsList, AdminTabsTrigger } from "@/components/admin/admin-tabs";
import { PendingApprovals, type PendingCheckIn } from "./pending-approvals";
import { OverrideModal } from "@/components/attendance/override-modal";
import { UserCheck, Clock, UserX, CalendarDays, Download, Replace, ListChecks } from "lucide-react";
import { campusShortLabels, formatDate, formatTime } from "@/lib/format";
import { toast } from "sonner";
import { computeAbsentCount, computeExcusedCount, isNonWorkingDay } from "./absent-stat";
import { parseWorkingDays } from "@/lib/payroll/working-days";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

type EmployeeAttendance = {
  employee: { id: string; kode: string; nama: string; jabatan: string; campusName: string };
  attendance: {
    id: string; status: string; checkInTime: string | null; checkOutTime: string | null;
    isManualOverride: boolean; isLocked: boolean; approvalStatus?: string;
  } | null;
};

type Campus = { id: string; name: string };
type Holiday = { date: string };

export default function AttendancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-section px-page-x py-page-y">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <AttendancePageInner />
    </Suspense>
  );
}

function AttendancePageInner() {
  // Per-render, not module-level: a module-level `TODAY_ISO` froze at build/
  // deploy time, so a non-working *today* kept computing as if it were the
  // day of the last deploy (the "Alpa" bug — F-20/Cycle-3-T8). Computed fresh
  // on every render rather than cached in state — cheap, and a stale value
  // for even one render across midnight would misclassify "today".
  const today = getTodayInTimezone("Asia/Jakarta");
  const [date, setDate] = useState(today);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The URL is the single source of truth, so back/forward keeps the control in step.
  const rawCampusId = searchParams?.get("campusId") || "all";
  const [campuses, setCampuses] = useState<Campus[]>([]);
  // The URL value is only trusted once the campus list confirms it exists.
  const campusId = campuses.length === 0 || campuses.some((c) => c.id === rawCampusId) ? rawCampusId : "all";
  const campusShort = campusShortLabels(campuses.map((c) => c.name));
  const campusQs = campusId === "all" ? "" : `?campusId=${encodeURIComponent(campusId)}`;
  function selectCampus(v: string) {
    router.replace(v === "all" ? pathname : `${pathname}?campusId=${encodeURIComponent(v)}`, { scroll: false });
  }
  const [data, setData] = useState<EmployeeAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  // F-20: holiday list fetched once. Holidays are non-working days for the
  // "tidak hadir" stat and the Libur rows. Fetch failure is non-fatal — the
  // rule simply falls back to weekend-only exclusion.
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  // Tenant working days (OrgConfig) — a school may run on Saturday. Null until
  // loaded or on failure, where the rule falls back to Sat/Sun.
  const [workingDays, setWorkingDays] = useState<string[] | null>(null);
  // 7-weekday trend, fetched independently of the date/campus filters above —
  // moved here from the admin dashboard (DMMT overhaul) via a small
  // dedicated endpoint so this client page doesn't duplicate the dashboard's
  // groupBy query. Fetch failure degrades to the chart's own empty state.
  const [trend, setTrend] = useState<WeeklyTrend[]>([]);

  // "Perlu persetujuan": geofence check-ins waiting for a decision (any date).
  const [tab, setTab] = useState("hari-ini");
  const [pending, setPending] = useState<PendingCheckIn[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);

  // Override modal
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{
    recordId: string | null;
    employeeId: string;
    employeeName: string;
    currentStatus: string | null;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date, campusId });
      const [attRes, campRes] = await Promise.all([
        fetch(`/api/attendance/today?${params}`),
        fetch("/api/config/campuses"),
      ]);
      if (!attRes.ok || !campRes.ok) {
        toast.error(MESSAGES.loadFailed("Data kehadiran"));
        return;
      }
      setData(await attRes.json());
      setCampuses(await campRes.json());
    } catch {
      toast.error(MESSAGES.loadFailed("Data kehadiran"));
    } finally {
      setLoading(false);
    }
  }, [date, campusId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/pending");
      if (!res.ok) return;
      const rows = await res.json();
      if (Array.isArray(rows)) setPending(rows);
    } catch {
      // Non-fatal: the tab simply shows no rows.
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  // The dashboard badge links here with ?tab=pending.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "pending") setTab("pending");
  }, []);

  const reloadAfterDecision = useCallback(() => {
    fetchPending();
    fetchData();
  }, [fetchPending, fetchData]);

  // F-20: holidays fetched once on mount; non-blocking for the table.
  useEffect(() => {
    fetch("/api/config/holidays")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Holiday[]) =>
        setHolidays(new Set((Array.isArray(rows) ? rows : []).map((h) => h.date))),
      )
      .catch(() => {
        // Non-fatal: stat falls back to weekend-only exclusion.
      });
  }, []);

  useEffect(() => {
    fetch("/api/config/org")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { workingDays?: string | null } | null) => {
        const days = parseWorkingDays(cfg?.workingDays);
        if (days.length > 0) setWorkingDays(days);
      })
      .catch(() => {
        // Non-fatal: falls back to Sat/Sun as the weekend.
      });
  }, []);

  // Trend chart fetched once on mount; non-fatal — falls back to the
  // chart's own empty state (never a false zero, never blocks the table).
  useEffect(() => {
    fetch("/api/attendance/trend")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: WeeklyTrend[]) => setTrend(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  const present = data.filter((d) => ["PRESENT", "LATE", "PRESENT_NO_CHECKOUT"].includes(d.attendance?.status ?? "")).length;
  const late = data.filter((d) => d.attendance?.status === "LATE").length;
  // F-20 (fixed Cycle 3 T8): weekends and holidays are never "tidak hadir",
  // whether the selected date is in the past, is today, or is in the future.
  const absent = computeAbsentCount({ selectedDate: date, data, holidays, workingDays });
  const leave = computeExcusedCount(data);
  // Drives the status column below: a row with no attendance record on a
  // non-working day is "Libur" (closed), not "Alpa" (should have shown up).
  const nonWorkingDay = isNonWorkingDay(date, holidays, workingDays);

  const openOverride = useCallback((ea: EmployeeAttendance) => {
    setOverrideTarget({
      recordId: ea.attendance?.id ?? null,
      employeeId: ea.employee.id,
      employeeName: ea.employee.nama,
      currentStatus: ea.attendance?.status ?? null,
    });
    setOverrideOpen(true);
  }, []);

  // Memoised — a fresh array every render would remount row cells and close
  // any open row-action menu (Cycle 3 T7).
  const columns: ColumnDef<EmployeeAttendance>[] = useMemo(() => {
    const statusBadge = (ea: EmployeeAttendance) => {
      if (ea.attendance?.approvalStatus === "PENDING") return <StatusBadge status="PENDING" />;
      if (ea.attendance) return <StatusBadge status={ea.attendance.status} />;
      // No record on a non-working day means the school was closed, not
      // that the employee failed to show up.
      return nonWorkingDay ? (
        <StatusBadge status="HOLIDAY" />
      ) : (
        <StatusBadge status="ABSENT" label="—" />
      );
    };
    return [
    {
      id: "nama",
      accessorFn: (row) => row.employee.nama,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Karyawan" />
      ),
      cell: ({ row }) => {
        const ea = row.original;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar name={ea.employee.nama} size="sm" className="shrink-0" />
            <DataTableLinkCell
              href={`/admin/employees/${ea.employee.id}`}
              className="min-w-0 whitespace-normal"
              description={
                <>
                  {`${ea.employee.kode} · ${ea.employee.campusName}`}
                  <DataTableMobileMeta className="mt-1">{statusBadge(ea)}</DataTableMobileMeta>
                </>
              }
            >
              {ea.employee.nama}
            </DataTableLinkCell>
          </div>
        );
      },
    },
    {
      id: "checkIn",
      accessorFn: (row) => row.attendance?.checkInTime,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Masuk" />
      ),
      cell: ({ row }) => (
        <span className="font-currency text-xs text-muted-foreground">
          {formatTime(row.original.attendance?.checkInTime ?? null)}
        </span>
      ),
    },
    {
      id: "checkOut",
      accessorFn: (row) => row.attendance?.checkOutTime,
      header: "Pulang",
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="font-currency text-xs text-muted-foreground">
          {formatTime(row.original.attendance?.checkOutTime ?? null)}
        </span>
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.attendance?.status ?? "ABSENT",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      // Status sits under the name below `md` (DataTableMobileMeta above).
      meta: { priority: "low" },
      cell: ({ row }) => statusBadge(row.original),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        // AttendanceRecord is an event-log (Category C): no row Edit action.
        // Correction is an override (new canonical event), not an edit.
        <DataTableRowActions
          extraActions={[
            {
              label: "Timpa",
              icon: <Replace size={14} />,
              onClick: () => openOverride(row.original),
            },
          ]}
        />
      ),
    },
  ];
  }, [openOverride, nonWorkingDay]);

  return (
    <>
      <PageHeader
        title="Kehadiran Hari Ini"
        description={formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/attendance/export?month=${new Date(date).getMonth() + 1}&year=${new Date(date).getFullYear()}`, "_blank")}>
              <Download size={14} className="mr-1.5" /> Ekspor CSV
            </Button>
            <Link href={`/admin/employee-attendance/daily${campusQs}`}>
              <Button size="sm"><ListChecks size={14} className="mr-1.5" /> Absensi Staf Harian</Button>
            </Link>
            <Link href={`/admin/employee-attendance/monthly${campusQs}`}>
              <Button variant="outline" size="sm"><CalendarDays size={14} className="mr-1.5" /> Bulanan</Button>
            </Link>
          </div>
        }
      />

      <AdminTabs value={tab} onValueChange={(v) => setTab(String(v))}>
      <AdminTabsList>
        <AdminTabsTrigger value="hari-ini">Kehadiran</AdminTabsTrigger>
        <AdminTabsTrigger value="pending">
          Perlu persetujuan
          {pending.length > 0 ? (
            <Badge variant="warning" className="ml-1.5 tabular-nums" data-testid="pending-count">{pending.length}</Badge>
          ) : null}
        </AdminTabsTrigger>
      </AdminTabsList>

      <AdminTabsContent value="pending">
        <PendingApprovals rows={pending} loading={pendingLoading} onChanged={reloadAfterDecision} />
      </AdminTabsContent>

      <AdminTabsContent value="hari-ini">
      {/* Moved here from the admin dashboard — DMMT overhaul */}
      <AttendanceTrendChart data={trend} hideDetailLink className="mb-4" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <DatePicker value={date} onChange={setDate} className="w-full sm:w-44" />
        {campuses.length > 1 && (
        <Select value={campusId} onValueChange={(v) => v && selectCampus(v)} items={{ all: "Semua Kampus", ...Object.fromEntries(campuses.map((c) => [c.id, campusShort.get(c.name) ?? c.name])) }}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Semua Kampus" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Kampus</SelectItem>
            {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{campusShort.get(c.name) ?? c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        )}
      </div>

      {/* Stats */}
      <StatsCardsRow cols={4}>
        <StatTile size="lg" mono
          label="Hadir" value={present} icon={UserCheck} tone="positive" />
        <StatTile size="lg" mono
          label="Terlambat" value={late} icon={Clock} tone="warning" />
        <StatTile size="lg" mono
          label="Alpa" value={absent} icon={UserX} tone="critical" />
        <StatTile size="lg" mono
          label="Izin" value={leave} icon={CalendarDays} tone="default" />
      </StatsCardsRow>

      {/* Table */}
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyTitle="Tidak ada data kehadiran"
        emptyDescription="Belum ada karyawan yang tercatat untuk tanggal ini."
      />
      </AdminTabsContent>
      </AdminTabs>

      {/* Override Modal */}
      {overrideTarget && (
        <OverrideModal
          open={overrideOpen}
          onOpenChange={setOverrideOpen}
          recordId={overrideTarget.recordId}
          employeeId={overrideTarget.employeeId}
          employeeName={overrideTarget.employeeName}
          date={date}
          currentStatus={overrideTarget.currentStatus}
          onSuccess={fetchData}
        />
      )}
    </>
  );
}
