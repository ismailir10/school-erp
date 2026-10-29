"use client";

import { useCallback, useEffect, useMemo, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SectionCard } from "@/components/ui/section-card";
import { DetailPageHeader } from "@/components/admin/detail-page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { toast } from "sonner";
import { weekStart } from "@/lib/student-journal/week";
import { formatDate } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { PeriodStepper } from "@/components/ui/period-stepper";
import { DayMarkDialog } from "@/components/student-journal/day-mark-dialog";
import { isMarkableDate } from "@/lib/student-journal/day-mark-rules";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type StudentRow = {
  studentId: string;
  name: string;
  checkedCount: number;
  totalCells: number;
};

type RollUpData = {
  weekStart: string;
  dates: string[];
  /** `YYYY-MM-DD → keterangan` for days marked "hari tanpa buku penghubung". */
  dayMarks?: Record<string, string>;
  students: StudentRow[];
};

type ClassInfo = {
  className: string;
  programName: string;
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

function CompletionBar({
  checked,
  total,
}: {
  checked: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <Progress value={Math.min(pct, 100)} className="h-1.5 w-20" />
      <span className="text-xs tabular-nums text-muted-foreground">
        {checked}/{total}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function ClassWeekPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: classSectionId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [ws, setWs] = useState<string>(() => {
    const p = searchParams.get("weekStart");
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : currentMonday();
  });

  const [rollUp, setRollUp] = useState<RollUpData | null>(null);
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [query, setQuery] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  /** The date whose "tanpa buku penghubung" dialog is open, if any. */
  const [markDate, setMarkDate] = useState<string | null>(null);
  const today = getTodayInTimezone("Asia/Jakarta");

  const fetchRollUp = useCallback(
    async (weekStartYmd: string) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/student-journal/admin/class-roll-up?classSectionId=${classSectionId}&weekStart=${weekStartYmd}`,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || "Gagal memuat data kelas");
          return;
        }
        const json = await res.json();
        setRollUp(json.data ?? null);
      } catch {
        toast.error("Gagal memuat data kelas");
      } finally {
        setLoading(false);
      }
    },
    [classSectionId],
  );

  // Fetch class info from the classes list endpoint for the header
  useEffect(() => {
    fetch(`/api/student-journal/admin/classes?weekStart=${ws}`)
      .then((r) => r.json())
      .then((json) => {
        const row = (json.data ?? []).find(
          (c: { classSectionId: string; className: string; programName: string }) =>
            c.classSectionId === classSectionId,
        );
        if (row) {
          setClassInfo({ className: row.className, programName: row.programName });
        }
      })
      // Silent: optional header-label populate; primary data load has its own toast.error path.
      .catch(() => {});
  }, [classSectionId, ws]);

  useEffect(() => {
    fetchRollUp(ws);
  }, [fetchRollUp, ws]);

  useEffect(() => {
    setTablePage(1);
  }, [query, ws]);

  const handleWeekChange = (delta: number) => {
    const newWs = addWeeks(ws, delta);
    setWs(newWs);
    router.replace(
      `/admin/student-journal/classes/${classSectionId}?weekStart=${newWs}`,
      { scroll: false },
    );
  };

  const headerTitle = classInfo
    ? `${classInfo.className} — ${classInfo.programName}`
    : "Detail Kelas";

  const columns = useMemo<ColumnDef<StudentRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Siswa" />
        ),
        cell: ({ row }) => (
          <DataTableLinkCell
            href={`/admin/student-journal/students/${row.original.studentId}?weekStart=${ws}`}
          >
            {row.original.name}
          </DataTableLinkCell>
        ),
      },
      {
        accessorKey: "checkedCount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Kelengkapan" />
        ),
        cell: ({ row }) => (
          <CompletionBar
            checked={row.original.checkedCount}
            total={row.original.totalCells}
          />
        ),
      },
    ],
    [ws],
  );

  const students = useMemo(() => rollUp?.students ?? [], [rollUp]);
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((student) =>
      student.name.toLowerCase().includes(needle),
    );
  }, [query, students]);
  const tableTotalPages = Math.max(1, Math.ceil(filteredRows.length / tablePageSize));
  const safeTablePage = Math.min(tablePage, tableTotalPages);
  const tablePagination = {
    page: safeTablePage,
    pageSize: tablePageSize,
    total: filteredRows.length,
    totalPages: tableTotalPages,
  };

  return (
    <>
      <DetailPageHeader
        backHref="/admin/student-journal/monitoring"
        backLabel="Kembali ke Pemantauan"
        title={headerTitle}
        description="Rekap kelengkapan pengisian Buku Penghubung per siswa."
        actions={
          <div className="flex items-center gap-2">
            <PeriodStepper
              label={formatWeekLabel(ws)}
              onPrev={() => handleWeekChange(-1)}
              onNext={() => handleWeekChange(1)}
              prevLabel="Minggu sebelumnya"
              nextLabel="Minggu berikutnya"
              variant="outline"
              labelClassName="min-w-[104px] font-medium sm:min-w-[140px]"
            />
          </div>
        }
      />

      {rollUp ? (
        <SectionCard
          title="Hari tanpa buku penghubung"
          description="Tandai hari ketika kelas tidak memakai buku (misal renang). Wali melihat keterangannya di Jurnal."
          className="mb-4"
          data-testid="day-marks-section"
        >
          <ul className="divide-y divide-border/60">
            {rollUp.dates.map((d) => {
              const reason = rollUp.dayMarks?.[d];
              return (
                <li key={d} className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {formatDate(d, { weekday: "long", day: "numeric", month: "short" })}
                    </p>
                    {reason ? (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid={`day-mark-${d}`}>
                        <CalendarOff size={12} aria-hidden="true" className="shrink-0" />
                        {reason}
                      </p>
                    ) : null}
                  </div>
                  {isMarkableDate(d, today) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid={`day-mark-button-${d}`}
                      onClick={() => setMarkDate(d)}
                    >
                      {reason ? "Ubah" : "Tandai"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}

      <DayMarkDialog
        open={markDate !== null}
        onOpenChange={(open) => {
          if (!open) setMarkDate(null);
        }}
        classSectionId={classSectionId}
        date={markDate ?? ws}
        initialReason={markDate ? rollUp?.dayMarks?.[markDate] ?? null : null}
        onSaved={() => fetchRollUp(ws)}
      />

      <DataTableToolbar
        value={query}
        onValueChange={setQuery}
        searchPlaceholder="Cari siswa..."
      />

      <DataTable
        columns={columns}
        data={filteredRows}
        loading={loading}
        pagination={tablePagination}
        emptyTitle="Belum ada siswa aktif di kelas ini"
        emptyDescription="Rekap kelengkapan akan tampil di sini setelah ada siswa terdaftar aktif di kelas ini."
      />
    </>
  );
}
