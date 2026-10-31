"use client";

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { toast } from "sonner";
import { formatDate, formatDateShort } from "@/lib/format";
import { weekStart } from "@/lib/student-journal/week";
import {
  BookOpen,
  CheckSquare,
  MessageSquare,
  CalendarX,
} from "lucide-react";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { PeriodStepper } from "@/components/ui/period-stepper";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type ClassRow = {
  classSectionId: string;
  className: string;
  programName: string;
  studentCount: number;
  checkedCount: number;
  completionPct: number;
  lastFilledAt: string | null;
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function currentMonday(): string {
  const today = getTodayInTimezone("Asia/Jakarta");
  return weekStart(today);
}

function addWeeks(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(ws: string): string {
  const d = new Date(`${ws}T00:00:00Z`);
  const fri = new Date(d);
  fri.setUTCDate(d.getUTCDate() + 4);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const friYmd = fri.toISOString().slice(0, 10);
  return `${formatDate(ws, opts)} – ${formatDate(friYmd, opts)}`;
}

// ------------------------------------------------------------------
// Completion bar
// ------------------------------------------------------------------

function CompletionBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[72px]">
      <Progress value={Math.min(pct, 100)} className="h-1.5 flex-1" />
      <span className="text-xs tabular-nums w-9 text-right">{pct}%</span>
    </div>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function MonitoringPage() {
  const [ws, setWs] = useState<string>(currentMonday);
  const [data, setData] = useState<ClassRow[]>([]);
  const [activeStudentCount, setActiveStudentCount] = useState(0);
  const [query, setQuery] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize] = useState(10);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (weekStartYmd: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/student-journal/admin/classes?weekStart=${weekStartYmd}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || MESSAGES.loadFailed("Data kelas"));
        return;
      }
      const json = await res.json();
      setData(json.data ?? []);
      setActiveStudentCount(json.summary?.activeStudentCount ?? 0);
    } catch {
      toast.error(MESSAGES.loadFailed("Data kelas"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(ws);
  }, [fetchData, ws]);

  useEffect(() => {
    setTablePage(1);
  }, [query, ws]);

  // Derived stats from the class list response.
  //
  // `totalEntries` reads the raw per-class `checkedCount`. It used to be
  // reverse-engineered from the ROUNDED completionPct
  // (`round(pct/100 * studentCount * 5)`), which lost the real figure at low
  // percentages — 4 entries in a 5-student class rounded to 3% and displayed
  // as 1. `hariKosong` was dead (computed, never rendered) and is gone.
  const stats = useMemo(() => {
    const totalEntries = data.reduce((sum, c) => sum + c.checkedCount, 0);
    // "Filled" is the same fact the "Terakhir diisi" column shows: the class has
    // at least one checked entry this week. It used to test the ROUNDED
    // completionPct, so a class with 4 entries in a big roster (0%) read as
    // "belum isi" next to a real last-filled date (ACAD-8).
    const kelasSudahIsi = data.filter((c) => c.checkedCount > 0).length;
    return { totalEntries, kelasSudahIsi };
  }, [data]);

  const columns = useMemo<ColumnDef<ClassRow>[]>(
    () => [
      {
        accessorKey: "className",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Kelas" />
        ),
        cell: ({ row }) => (
          <DataTableLinkCell
            href={`/admin/student-journal/classes/${row.original.classSectionId}?weekStart=${ws}`}
            className="whitespace-normal"
            description={
              <>
                <span className="block">{row.original.programName}</span>
                <DataTableMobileMeta>
                  <span>{row.original.studentCount} siswa</span>
                </DataTableMobileMeta>
              </>
            }
          >
            {row.original.className}
          </DataTableLinkCell>
        ),
      },
      {
        accessorKey: "studentCount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Siswa" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.studentCount}
          </span>
        ),
      },
      {
        accessorKey: "completionPct",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Kelengkapan" />
        ),
        cell: ({ row }) => (
          <CompletionBar pct={row.original.completionPct} />
        ),
      },
      {
        accessorKey: "lastFilledAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Terakhir diisi" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) =>
          row.original.lastFilledAt ? (
            <span className="text-xs text-muted-foreground">
              {formatDateShort(row.original.lastFilledAt)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">—</span>
          ),
      },
    ],
    [ws],
  );

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((row) =>
      [row.className, row.programName].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [data, query]);
  const tableTotalPages = Math.max(1, Math.ceil(filteredRows.length / tablePageSize));
  const safeTablePage = Math.min(tablePage, tableTotalPages);
  const pagination = {
    page: safeTablePage,
    pageSize: tablePageSize,
    total: filteredRows.length,
    totalPages: tableTotalPages,
  };

  return (
    <>
      <PageHeader
        title="Buku Penghubung — Pemantauan"
        description="Ringkasan pengisian per kelas untuk minggu berjalan."
        actions={
          <div className="flex items-center gap-2">
            <PeriodStepper
              label={formatWeekLabel(ws)}
              onPrev={() => setWs((w) => addWeeks(w, -1))}
              onNext={() => setWs((w) => addWeeks(w, 1))}
              prevLabel="Minggu sebelumnya"
              nextLabel="Minggu berikutnya"
              variant="outline"
              labelClassName="min-w-[104px] font-medium sm:min-w-[140px]"
            />
          </div>
        }
      />

      <StatsCardsRow cols={4}>
        <StatCard
          label="Total entri minggu ini"
          value={loading ? "—" : stats.totalEntries}
          icon={BookOpen}
          color="primary"
          index={0}
        />
        <StatCard
          label="Kelas sudah isi"
          value={loading ? "—" : `${stats.kelasSudahIsi} / ${data.length}`}
          icon={CheckSquare}
          color="success"
          index={1}
        />
        <StatCard
          label="Siswa terdaftar aktif"
          value={loading ? "—" : activeStudentCount}
          icon={MessageSquare}
          color="primary"
          index={2}
        />
        <StatCard
          label="Kelas belum isi"
          value={
            loading
              ? "—"
              : data.length - stats.kelasSudahIsi
          }
          icon={CalendarX}
          color={data.length - stats.kelasSudahIsi > 0 ? "warning" : "success"}
          index={3}
        />
      </StatsCardsRow>

      <DataTableToolbar
        value={query}
        onValueChange={setQuery}
        searchPlaceholder="Cari kelas atau program..."
      />

      <DataTable
        columns={columns}
        data={filteredRows}
        pagination={pagination}
        defaultSort={{ field: "className", order: "asc" }}
        loading={loading}
        emptyTitle="Belum ada kelas aktif"
        emptyDescription="Tambahkan kelas terlebih dahulu di menu Kelas."
      />
    </>
  );
}
