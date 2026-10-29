"use client";

import { UserAvatar } from "@/components/ui/user-avatar";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { AttendanceTrendChart, type WeeklyTrend } from "@/components/admin/dashboard";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { OverrideModal } from "@/components/attendance/override-modal";
import { UserCheck, Clock, UserX, CalendarDays, Download, Replace } from "lucide-react";
import { formatDate, formatTime } from "@/lib/format";
import { toast } from "sonner";
import { computeAbsentCount, computeExcusedCount, isNonWorkingDay } from "./absent-stat";
import { parseWorkingDays } from "@/lib/payroll/working-days";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

type EmployeeAttendance = {
  employee: { id: string; kode: string; nama: string; jabatan: string; campusName: string };
  attendance: {
    id: string; status: string; checkInTime: string | null; checkOutTime: string | null;
    isManualOverride: boolean; isLocked: boolean;
  } | null;
};

type Campus = { id: string; name: string };
type Holiday = { date: string };

export default function AttendancePage() {
  // Per-render, not module-level: a module-level `TODAY_ISO` froze at build/
  // deploy time, so a non-working *today* kept computing as if it were the
  // day of the last deploy (the "Alpa" bug — F-20/Cycle-3-T8). Computed fresh
  // on every render rather than cached in state — cheap, and a stale value
  // for even one render across midnight would misclassify "today".
  const today = getTodayInTimezone("Asia/Jakarta");
  const [date, setDate] = useState(today);
  const [campusId, setCampusId] = useState("all");
  const [campuses, setCampuses] = useState<Campus[]>([]);
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
        toast.error("Gagal memuat data kehadiran");
        return;
      }
      setData(await attRes.json());
      setCampuses(await campRes.json());
    } catch {
      toast.error("Gagal memuat data kehadiran");
    } finally {
      setLoading(false);
    }
  }, [date, campusId]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/attendance/export?month=${new Date(date).getMonth() + 1}&year=${new Date(date).getFullYear()}`, "_blank")}>
              <Download size={14} className="mr-1.5" /> Ekspor CSV
            </Button>
            <Link href="/admin/employee-attendance/monthly">
              <Button variant="outline" size="sm"><CalendarDays size={14} className="mr-1.5" /> Bulanan</Button>
            </Link>
          </div>
        }
      />

      {/* Moved here from the admin dashboard — DMMT overhaul */}
      <AttendanceTrendChart data={trend} hideDetailLink className="mb-4" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <DatePicker value={date} onChange={setDate} className="w-full sm:w-44" />
        <Select value={campusId} onValueChange={(v) => v && setCampusId(v)} items={{ all: "Semua Kampus", ...Object.fromEntries(campuses.map((c) => [c.id, c.name])) }}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Semua Kampus" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Kampus</SelectItem>
            {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <StatsCardsRow cols={4}>
        <StatCard label="Hadir" value={present} icon={UserCheck} color="success" index={0} />
        <StatCard label="Terlambat" value={late} icon={Clock} color="warning" index={1} />
        <StatCard label="Alpa" value={absent} icon={UserX} color="error" index={2} />
        <StatCard label="Izin" value={leave} icon={CalendarDays} color="primary" index={3} />
      </StatsCardsRow>

      {/* Table */}
      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        emptyTitle="Tidak ada data kehadiran"
        emptyDescription="Belum ada karyawan yang tercatat untuk tanggal ini."
      />

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
