"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { OverrideModal } from "@/components/attendance/override-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarX } from "lucide-react";
import { formatMonthLabel } from "@/lib/format";
import { BackLink } from "@/components/portal/back-link";
import { PeriodStepper } from "@/components/ui/period-stepper";

type MonthlyData = {
  employee: { id: string; kode: string; nama: string; campusName: string };
  records: { id: string; date: string; status: string; checkInTime: string | null; checkOutTime: string | null; isLocked: boolean }[];
  summary: { present: number; late: number; absent: number; leave: number };
};

type Campus = { id: string; name: string };

const STATUS_COLORS: Record<string, string> = {
  PRESENT: "bg-status-present",
  LATE: "bg-status-late",
  ABSENT: "bg-status-absent",
  LEAVE: "bg-status-leave",
  HOLIDAY: "bg-status-holiday",
  HALF_DAY: "bg-status-late",
  PRESENT_NO_CHECKOUT: "bg-status-late",
};

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Hadir",
  LATE: "Terlambat",
  ABSENT: "Alpa",
  LEAVE: "Izin",
  HOLIDAY: "Libur",
  HALF_DAY: "Setengah hari",
  PRESENT_NO_CHECKOUT: "Hadir tanpa check-out",
};

export default function MonthlyAttendancePage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [campusId, setCampusId] = useState("all");
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [data, setData] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{
    recordId: string | null; employeeId: string; employeeName: string;
    date: string; currentStatus: string | null;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ month: String(month), year: String(year), campusId });
    const [attRes, campRes] = await Promise.all([
      fetch(`/api/attendance/monthly?${params}`),
      fetch("/api/config/campuses"),
    ]);
    setData(await attRes.json());
    setCampuses(await campRes.json());
    setLoading(false);
  }, [month, year, campusId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, [fetchData]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const monthLabel = formatMonthLabel(year, month);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  }

  function handleCellClick(emp: MonthlyData, day: number) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const record = emp.records.find((r) => r.date === dateStr);
    if (record?.isLocked) return;
    setOverrideTarget({
      recordId: record?.id ?? null,
      employeeId: emp.employee.id,
      employeeName: emp.employee.nama,
      date: dateStr,
      currentStatus: record?.status ?? null,
    });
    setOverrideOpen(true);
  }

  return (
    <>
      <BackLink href="/admin/employee-attendance" label="Kembali ke Harian" className="mb-2" />
      <PageHeader
        title="Kehadiran Bulanan"
        description="Pilih sel untuk menimpa status kehadiran"
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodStepper
          label={monthLabel}
          onPrev={prevMonth}
          onNext={nextMonth}
          prevLabel="Bulan sebelumnya"
          nextLabel="Bulan berikutnya"
          className="w-full sm:w-auto"
          labelClassName="capitalize sm:w-40"
        />
        <Select value={campusId} onValueChange={(v) => v && setCampusId(v)} items={{ all: "Semua Kampus", ...Object.fromEntries(campuses.map((c) => [c.id, c.name])) }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Semua" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Kampus</SelectItem>
            {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : data.length === 0 ? (
        <EmptyState
          icon={CalendarX}
          title="Belum ada kehadiran"
          description="Tidak ada data kehadiran untuk bulan dan kampus ini. Ubah filter atau kembali ke tampilan harian untuk mencatat kehadiran."
        />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-card px-3 py-2 font-semibold text-muted-foreground w-40">Nama</TableHead>
                {days.map((d) => {
                  const dow = new Date(year, month - 1, d).getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <TableHead key={d} className={`px-1 py-2 h-auto text-center font-medium w-7 [@media(pointer:coarse)]:min-w-11 ${isWeekend ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                      {d}
                    </TableHead>
                  );
                })}
                {/* H/T/A/I summed into one sticky-right group (backlog,
                    2026-09-26 admin-ui-standard-c1) — four separate columns
                    sat past 27+ day cells, out of reach without scrolling
                    the whole grid on a phone. */}
                <TableHead
                  className="sticky right-0 z-10 bg-card px-2 py-2 h-auto text-center font-semibold text-muted-foreground shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]"
                  title="H = Hadir · T = Terlambat · A = Alpa · I = Izin"
                >
                  H/T/A/I
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((emp) => {
                const recordMap = new Map(emp.records.map((r) => [r.date, r]));
                return (
                  <TableRow key={emp.employee.id}>
                    <TableCell className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium truncate max-w-[160px]">
                      {emp.employee.nama}
                    </TableCell>
                    {days.map((d) => {
                      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                      const record = recordMap.get(dateStr);
                      const dow = new Date(year, month - 1, d).getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      const status = record
                        ? STATUS_LABELS[record.status] ?? record.status
                        : isWeekend
                          ? "Akhir pekan"
                          : "Tidak ada data";
                      return (
                        <TableCell key={d} className="px-0.5 py-1 text-center [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:p-0.5">
                          <button
                            onClick={() => handleCellClick(emp, d)}
                            aria-label={`${emp.employee.nama}, ${dateStr}, ${status}${record?.isLocked ? ", terkunci" : ""}`}
                            disabled={record?.isLocked}
                            className={`w-5 h-5 rounded-sm inline-block [@media(pointer:coarse)]:size-11 ${
                              record ? STATUS_COLORS[record.status] ?? "bg-muted" : isWeekend ? "bg-muted/30" : ""
                            } ${record?.isLocked ? "opacity-50 cursor-not-allowed" : "hover:ring-1 hover:ring-primary cursor-pointer"}`}
                            title={status}
                          />
                        </TableCell>
                      );
                    })}
                    <TableCell className="sticky right-0 z-10 bg-card px-2 py-1 shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.12)]">
                      <div className="flex items-center justify-center gap-1.5 font-currency">
                        <span className="text-status-present" title="Hadir">{emp.summary.present}</span>
                        <span className="text-status-late" title="Terlambat">{emp.summary.late}</span>
                        <span className="text-destructive" title="Alpa">{emp.summary.absent}</span>
                        <span className="text-status-leave" title="Izin">{emp.summary.leave}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Legend */}
      {data.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-3 text-xs">
          {Object.entries(STATUS_COLORS).slice(0, 5).map(([key, bg]) => (
            <div key={key} className="flex items-center gap-1">
              <div className={`w-3 h-3 rounded-sm ${bg}`} />
              <span className="text-muted-foreground">{STATUS_LABELS[key] ?? key}</span>
            </div>
          ))}
        </div>
      )}

      {overrideTarget && (
        <OverrideModal
          open={overrideOpen}
          onOpenChange={setOverrideOpen}
          recordId={overrideTarget.recordId}
          employeeId={overrideTarget.employeeId}
          employeeName={overrideTarget.employeeName}
          date={overrideTarget.date}
          currentStatus={overrideTarget.currentStatus}
          onSuccess={fetchData}
        />
      )}
    </>
  );
}
