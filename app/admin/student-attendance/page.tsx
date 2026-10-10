"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type * as z4 from "zod/v4/core";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { formatDate, formatClassOptionLabel } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { updateStudentAttendanceSchema } from "@/lib/validations/student-attendance";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import {
  AdminTabs,
  AdminTabsList,
  AdminTabsTrigger,
  AdminTabsContent,
} from "@/components/admin/admin-tabs";
import {
  CalendarCheck,
  CalendarX,
  Download,
  Heart,
  Info,
  Pencil,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AttendanceRecord = {
  id: string;
  date: string;
  status: string;
  notes: string | null;
  student: { id: string; name: string; nickname: string | null };
  classSection: { id: string; name: string };
};

type AcademicYearRef = { id: string; name: string; status: string };

// `academicYear`/`capacity`/`_count` are optional so this type still fits a
// section coming from anywhere upstream that predates the yearStatus/label
// work — the grouped select below degrades a section with no academicYear
// by simply dropping it from every group (see `groupClassSectionsByYear`).
type ClassSection = {
  id: string;
  name: string;
  academicYear?: AcademicYearRef | null;
  capacity?: number;
  _count?: { enrollments: number };
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

type RecapRow = {
  studentId: string;
  name: string;
  nickname: string | null;
  nis: string | null;
  classSectionId: string;
  className: string;
  present: number;
  absent: number;
  sick: number;
  permission: number;
  total: number;
};

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "PRESENT", label: "Hadir" },
  { value: "ABSENT", label: "Alpa" },
  { value: "SICK", label: "Sakit" },
  { value: "PERMISSION", label: "Izin" },
];

// ─── Kelas filter — grouped by Tahun Ajaran ────────────────────────────────────
//
// This is a read/filter surface over historical attendance data, not a write
// target — it legitimately needs every academic year (unlike the write-path
// enroll/promote pickers, which scope to writable years only). Grouping by
// TA keeps the current year discoverable in a list spanning 5+ years.

const YEAR_STATUS_RANK: Record<string, number> = { ACTIVE: 0, PLANNING: 1, ARCHIVED: 2 };

type ClassSectionYearGroup = { year: AcademicYearRef; sections: ClassSection[] };

/**
 * Groups class sections by academic year and orders the groups ACTIVE
 * first, then PLANNING, then ARCHIVED newest-first. Year names sort
 * correctly as plain strings ("2025/2026" > "2020/2021") because the
 * format is a consistent "YYYY/YYYY". Sibling copy lives in
 * `components/admin/student-export-dialog.tsx`'s `groupClassSectionsByYear`
 * — duplicated rather than pulled into a shared lib module to keep this
 * cycle's diff scoped to the two picker surfaces it touches.
 */
function groupClassSectionsByYear(sections: ClassSection[]): ClassSectionYearGroup[] {
  const byYear = new Map<string, ClassSectionYearGroup>();
  for (const section of sections) {
    const year = section.academicYear;
    if (!year) continue;
    let group = byYear.get(year.id);
    if (!group) {
      group = { year, sections: [] };
      byYear.set(year.id, group);
    }
    group.sections.push(section);
  }
  return Array.from(byYear.values()).sort((a, b) => {
    const rankDiff =
      (YEAR_STATUS_RANK[a.year.status] ?? 3) - (YEAR_STATUS_RANK[b.year.status] ?? 3);
    if (rankDiff !== 0) return rankDiff;
    return b.year.name.localeCompare(a.year.name);
  });
}

/**
 * Shared "Kelas" filter used by both the Harian list and the Rekap Bulanan
 * tab. Option text drops the redundant " · TA ..." suffix from
 * `formatClassOptionLabel` — the enclosing `SelectGroup`'s `SelectLabel`
 * already states the Tahun Ajaran once per group.
 */
function GroupedClassSelect({
  value,
  onChange,
  classSections,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  classSections: ClassSection[];
  className?: string;
  // Required, not optional: `classSectionFilter` defaults to "all", which
  // always matches the "Semua Kelas" item, so the SelectValue placeholder
  // never renders — the trigger has no visible or programmatic name unless
  // an explicit <label htmlFor> supplies one. Every call site must pass a
  // unique id (this component renders twice on the page: Harian + Rekap).
  id: string;
}) {
  const groups = useMemo(() => groupClassSectionsByYear(classSections), [classSections]);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-muted-foreground whitespace-nowrap">
        Kelas
      </label>
      <Select value={value} onValueChange={(v) => { if (v) onChange(v); }}>
        <SelectTrigger id={id} className={className ?? "w-full sm:w-48 h-9"}>
          <SelectValue placeholder="Kelas" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua Kelas</SelectItem>
          {groups.map(({ year, sections }) => (
            <SelectGroup key={year.id}>
              <SelectLabel>{`TA ${year.name}`}</SelectLabel>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {formatClassOptionLabel({
                    name: s.name,
                    enrolled: s._count?.enrollments ?? 0,
                    capacity: s.capacity ?? 0,
                  })}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StudentAttendancePage() {
  const listRequest = useRef(0);
  const [listError, setListError] = useState(false);
  const [hasLoadedList, setHasLoadedList] = useState(false);
  const [data, setData] = useState<AttendanceRecord[]>([]);
  const [classSections, setClassSections] = useState<ClassSection[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, pageSize: 20, total: 0, totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [classSectionFilter, setClassSectionFilter] = useState("all");
  // Default both ends of the range to today so the table renders something on
  // first load (UAT 2026-05-12 admin m8 — blank dd/mm/yyyy placeholders left
  // the admin staring at a "Tidak ada catatan" empty state before they could
  // figure out the filter was required). Jakarta-tz helper, not toISOString —
  // the UTC split showed yesterday's date 00:00–06:59 WIB (2026-04-24 ADR).
  const [dateFrom, setDateFrom] = useState(() => getTodayInTimezone("Asia/Jakarta"));
  const [dateTo, setDateTo] = useState(() => getTodayInTimezone("Asia/Jakarta"));
  const [stats, setStats] = useState({ present: 0, absent: 0, sick: 0, permission: 0 });

  // Override dialog (Category C — event-log override, not a destructive edit)
  const [overrideTarget, setOverrideTarget] = useState<AttendanceRecord | null>(null);
  const overrideFormId = useId();
  const overrideForm = useZodForm(updateStudentAttendanceSchema, {
    defaultValues: { status: "PRESENT", notes: "" },
  });

  // Void confirm
  const [voidTarget, setVoidTarget] = useState<AttendanceRecord | null>(null);
  const [voiding, setVoiding] = useState(false);

  // ── Fetch class sections once ───────────────────────────────────
  useEffect(() => {
    fetch("/api/class-sections")
      .then((r) => r.json())
      .then((d) => setClassSections(Array.isArray(d) ? d : []))
      .catch(() => toast.error("Gagal memuat data"));
  }, []);

  // ── Fetch stats (today's date range for context) ────────────────
  useEffect(() => {
    const today = getTodayInTimezone("Asia/Jakarta");
    fetch(`/api/student-attendance/stats?dateFrom=${today}&dateTo=${today}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.present !== undefined) setStats(data);
      })
      .catch(() => toast.error("Gagal memuat data"));
  }, []);

  // ── Fetch list ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        mode: "list",
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
      });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (classSectionFilter !== "all") params.set("classSectionId", classSectionFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/student-attendance?${params}`);
      if (request !== listRequest.current) return;
      if (!res.ok) throw new Error("Gagal memuat kehadiran");
      const json = await res.json();
      if (request !== listRequest.current) return;
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
      setHasLoadedList(true);
      setListError(false);
    } catch {
      if (request === listRequest.current) setListError(true);
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, statusFilter, classSectionFilter, dateFrom, dateTo]);

  useEffect(() => {
    const requests = listRequest;
    fetchData();
    return () => { ++requests.current; };
  }, [fetchData]);

  const today = getTodayInTimezone("Asia/Jakarta");
  const hasListFilter = Boolean(search || statusFilter !== "all" || classSectionFilter !== "all"
    || (dateFrom && dateFrom !== today) || (dateTo && dateTo !== today));

  // ── Handlers ────────────────────────────────────────────────────

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const openOverride = useCallback(
    (r: AttendanceRecord) => {
      setOverrideTarget(r);
      overrideForm.reset({
        status: r.status as z4.input<typeof updateStudentAttendanceSchema>["status"],
        notes: r.notes ?? "",
      });
    },
    [overrideForm],
  );

  const handleOverride = overrideForm.handleSubmit(async (values) => {
    if (!overrideTarget) return;
    try {
      await sendJson(
        `/api/student-attendance/${overrideTarget.id}`,
        { method: "PUT", body: { status: values.status, notes: values.notes || null } },
        "Gagal menimpa kehadiran",
      );
      toast.success("Kehadiran ditimpa");
      setOverrideTarget(null);
      fetchData();
    } catch (err) {
      applyServerErrors(overrideForm, err, "Gagal menimpa kehadiran");
    }
  });

  async function handleVoid() {
    if (!voidTarget) return;
    setVoiding(true);
    let errorToasted = false;
    try {
      const res = await fetch(`/api/student-attendance/${voidTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const message = d.error || "Gagal membatalkan";
        errorToasted = true;
        toast.error(message);
        throw new Error(message);
      }
      toast.success("Catatan kehadiran dibatalkan");
      setVoidTarget(null);
      void fetchData();
    } catch (error) {
      if (!errorToasted) {
        toast.error("Gagal membatalkan catatan kehadiran. Coba lagi.");
      }
      throw error instanceof Error
        ? error
        : new Error("Gagal membatalkan catatan kehadiran");
    } finally {
      setVoiding(false);
    }
  }

  // ── Columns ─────────────────────────────────────────────────────
  // Memoised — a fresh array every render would remount row cells and close
  // any open row-action menu (Cycle 3 T7; see the removed retry hack in
  // `__tests__/override-dialog.test.tsx`).

  const columns: ColumnDef<AttendanceRecord>[] = useMemo(() => [
    {
      accessorKey: "date",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tanggal" />,
      // The date follows the student's name below `md`, so Status stays on screen (ACAD-10).
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="text-sm font-medium">{formatDate(row.original.date)}</span>
      ),
    },
    {
      id: "student",
      header: "Siswa",
      cell: ({ row }) => {
        const s = row.original.student;
        return (
          <DataTableLinkCell
            href={`/admin/students/${s.id}`}
            className="whitespace-normal"
            description={
              <>
                {s.nickname}
                <DataTableMobileMeta className="mt-0.5">
                  <span>{`${formatDate(row.original.date)} · ${row.original.classSection.name}`}</span>
                </DataTableMobileMeta>
              </>
            }
          >
            {s.name}
          </DataTableLinkCell>
        );
      },
    },
    {
      id: "class",
      header: "Kelas",
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.classSection.name}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "notes",
      header: "Catatan",
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground max-w-[200px] truncate block">
          {row.original.notes ?? "—"}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DataTableRowActions
          extraActions={[
            {
              label: "Timpa",
              icon: <Pencil size={14} />,
              onClick: () => openOverride(row.original),
            },
          ]}
          onVoid={() => setVoidTarget(row.original)}
        />
      ),
    },
  ], [openOverride]);

  // ─────────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader
        title="Kehadiran Siswa"
        description={hasLoadedList ? `${pagination.total} catatan${listError ? " pada hasil terakhir" : ""}` : "Pantau catatan kehadiran siswa."}
      />

      <StatsCardsRow cols={4}>
        <StatCard label="Hadir Hari Ini" value={stats.present} icon={CalendarCheck} color="success" index={0} />
        <StatCard label="Alpa" value={stats.absent} icon={CalendarX} color="error" index={1} />
        <StatCard label="Sakit" value={stats.sick} icon={Heart} color="warning" index={2} />
        <StatCard label="Izin" value={stats.permission} icon={Info} color="primary" index={3} />
      </StatsCardsRow>

      <AdminTabs defaultValue="harian">
        <AdminTabsList>
          <AdminTabsTrigger value="harian">Harian</AdminTabsTrigger>
          <AdminTabsTrigger value="rekap">Rekap Bulanan</AdminTabsTrigger>
        </AdminTabsList>

        <AdminTabsContent value="harian">

      {/* Date range filters (outside DataTableToolbar since they're date inputs) */}
      <div className="flex flex-wrap gap-3 mb-3">
        <div className="flex items-center gap-2">
          <label htmlFor="attendance-date-from" className="text-xs text-muted-foreground whitespace-nowrap">Dari</label>
          <DatePicker
            id="attendance-date-from"
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="h-9 w-40 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="attendance-date-to" className="text-xs text-muted-foreground whitespace-nowrap">Sampai</label>
          <DatePicker
            id="attendance-date-to"
            value={dateTo}
            onChange={(v) => {
              setDateTo(v);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="h-9 w-40 text-sm"
          />
        </div>
        <GroupedClassSelect
          id="attendance-class-filter-harian"
          value={classSectionFilter}
          onChange={(v) => {
            setClassSectionFilter(v);
            setPagination((p) => ({ ...p, page: 1 }));
          }}
          classSections={classSections}
        />
        {(dateFrom || dateTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setPagination((p) => ({ ...p, page: 1 }));
            }}
          >
            Atur ulang tanggal
          </Button>
        )}
      </div>

      <DataTableToolbar
        searchPlaceholder="Cari nama siswa..."
        onSearchChange={handleSearchChange}
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            onChange: (v) => {
              setStatusFilter(v);
              setPagination((p) => ({ ...p, page: 1 }));
            },
            options: STATUS_OPTIONS,
          },
        ]}
        // The Kelas filter moved out of `filters` (it needs SelectGroup/
        // SelectLabel for the TA grouping, which the generic toolbar filter
        // doesn't support) — wire it back into the toolbar's "Reset" so
        // that button keeps clearing it, same as before this change.
        hasExternalFilter={classSectionFilter !== "all"}
        onReset={() => {
          setClassSectionFilter("all");
          setPagination((p) => ({ ...p, page: 1 }));
        }}
      />

      {listError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Data kehadiran belum bisa dimuat</AlertTitle>
          <AlertDescription>
            <p>{hasLoadedList && data.length > 0
              ? "Hasil terakhir masih ditampilkan dan belum diperbarui sesuai filter. Coba lagi untuk memuat data terbaru."
              : "Periksa koneksi Anda, lalu coba lagi."}</p>
            <Button type="button" variant="outline" className="mt-2" onClick={fetchData} disabled={loading}>
              {loading ? "Memuat..." : "Coba Lagi"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {(!listError || data.length > 0) && <DataTable
        columns={columns}
        data={data}
        pagination={pagination}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
        onPageSizeChange={(pageSize) => setPagination((p) => ({ ...p, page: 1, pageSize }))}
        loading={loading && !hasLoadedList}
        emptyTitle={hasListFilter ? "Tidak ada hasil untuk filter ini" : "Tidak ada catatan kehadiran"}
        emptyDescription={hasListFilter
          ? "Ubah pencarian, kelas, status, atau rentang tanggal untuk melihat catatan lainnya."
          : "Catatan kehadiran siswa akan tampil di sini setelah guru mencatat kehadiran."}
      />}

        </AdminTabsContent>

        <AdminTabsContent value="rekap">
          <RecapView classSections={classSections} />
        </AdminTabsContent>
      </AdminTabs>

      {/* ── Override dialog (Category C — event-log override) ─── */}
      <ResponsiveFormDialog
        open={!!overrideTarget}
        onOpenChange={(o) => { if (!overrideForm.formState.isSubmitting && !o) setOverrideTarget(null); }}
        title="Timpa Kehadiran"
        description={overrideTarget ? `${overrideTarget.student.name} — ${formatDate(overrideTarget.date)}` : undefined}
        size="lg"
        footer={
          <FormDialogFooter
            formId={overrideFormId}
            pending={overrideForm.formState.isSubmitting}
            onCancel={() => setOverrideTarget(null)}
            submitLabel="Simpan"
          />
        }
      >
        <form id={overrideFormId} onSubmit={handleOverride} noValidate className="space-y-field">
          <FormRootError formState={overrideForm.formState} />
          <FormField
            control={overrideForm.control}
            name="status"
            label="Status Kehadiran"
            id="attendance-override-status"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && field.onChange(v)}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRESENT">Hadir</SelectItem>
                  <SelectItem value="ABSENT">Alpa</SelectItem>
                  <SelectItem value="SICK">Sakit</SelectItem>
                  <SelectItem value="PERMISSION">Izin</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <FormField
            control={overrideForm.control}
            name="notes"
            label="Catatan (opsional)"
            id="attendance-override-notes"
            render={({ field, controlProps }) => (
              <Textarea
                {...field}
                {...controlProps}
                value={field.value ?? ""}
                placeholder="Catatan tambahan..."
                rows={2}
              />
            )}
          />
        </form>
      </ResponsiveFormDialog>

      {/* ── Void confirm ────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!voidTarget}
        onOpenChange={(o) => { if (!o) setVoidTarget(null); }}
        title="Batalkan Catatan Kehadiran?"
        description={
          voidTarget
            ? `Catatan kehadiran ${voidTarget.student.name} pada ${formatDate(voidTarget.date)} akan dibatalkan dan tidak muncul di laporan.`
            : undefined
        }
        confirmLabel="Ya, Batalkan"
        destructive
        loading={voiding}
        onConfirm={handleVoid}
      />

    </>
  );
}

// ─── Rekap Bulanan ────────────────────────────────────────────────────────────

const recapColumns: ColumnDef<RecapRow>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Siswa" />,
    cell: ({ row }) => (
      <DataTableLinkCell
        href={`/admin/students/${row.original.studentId}`}
        description={row.original.nis ? `NIS ${row.original.nis}` : undefined}
      >
        {row.original.name}
      </DataTableLinkCell>
    ),
  },
  {
    accessorKey: "className",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Kelas" />,
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.className}</span>
    ),
  },
  {
    accessorKey: "present",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Hadir" />,
    cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.present}</span>,
  },
  {
    accessorKey: "sick",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Sakit" />,
    cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.sick}</span>,
  },
  {
    accessorKey: "permission",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Izin" />,
    cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.permission}</span>,
  },
  {
    accessorKey: "absent",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Alpa" />,
    cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.absent}</span>,
  },
  {
    accessorKey: "total",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Total Tercatat" />,
    cell: ({ row }) => (
      <span className="text-sm font-medium tabular-nums">{row.original.total}</span>
    ),
  },
];

function RecapView({ classSections }: { classSections: ClassSection[] }) {
  // <input type="month"> value: "YYYY-MM" — default to the current Jakarta month.
  const [month, setMonth] = useState(() =>
    getTodayInTimezone("Asia/Jakarta").slice(0, 7),
  );
  const [classFilter, setClassFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize] = useState(10);
  const [rows, setRows] = useState<RecapRow[]>([]);
  const [loading, setLoading] = useState(true);

  const buildParams = useCallback(() => {
    const [y, m] = month.split("-");
    const params = new URLSearchParams({ month: m, year: y });
    if (classFilter !== "all") params.set("classSectionId", classFilter);
    return params;
  }, [month, classFilter]);

  // Same fetch-in-callback shape as the daily view's fetchData — the lint
  // rule rejects setState directly in an effect body.
  const fetchRecap = useCallback(async (signal: { cancelled: boolean }) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/student-attendance/recap?${buildParams()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ApiError(err.error || "Gagal memuat rekap");
      }
      const json = await res.json();
      if (!signal.cancelled) setRows(json.data ?? []);
    } catch (e) {
      if (!signal.cancelled) {
        toast.error(userMessage(e, "Gagal memuat rekap"));
      }
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    if (!month) return;
    const signal = { cancelled: false };
    fetchRecap(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [month, fetchRecap]);

  useEffect(() => {
    setTablePage(1);
  }, [classFilter, query, month]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.nickname ?? "", row.nis ?? "", row.className].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [query, rows]);
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
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <label htmlFor="attendance-recap-month" className="text-xs text-muted-foreground whitespace-nowrap">Bulan</label>
          <Input
            id="attendance-recap-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 w-44 text-sm"
          />
        </div>
        <GroupedClassSelect
          id="attendance-class-filter-rekap"
          value={classFilter}
          onChange={setClassFilter}
          classSections={classSections}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-9 ml-auto"
          disabled={!month || loading || rows.length === 0}
          onClick={() => {
            window.open(`/api/student-attendance/export?${buildParams()}`, "_blank");
          }}
        >
          <Download size={14} className="mr-1" /> Ekspor CSV
        </Button>
      </div>

      <DataTableToolbar
        value={query}
        onValueChange={setQuery}
        searchPlaceholder="Cari siswa, NIS, atau kelas..."
        // The Kelas filter moved above (grouped by TA — SelectGroup/SelectLabel
        // aren't supported by the generic toolbar filter shape) — wire it back
        // into "Reset" so that button still clears it, same as before.
        hasExternalFilter={classFilter !== "all"}
        onReset={() => setClassFilter("all")}
      />

      <DataTable
        columns={recapColumns}
        data={filteredRows}
        loading={loading}
        pagination={tablePagination}
        emptyTitle="Belum ada data rekap"
        emptyDescription="Rekap bulanan tampil setelah ada siswa terdaftar aktif. Pilih bulan lain atau periksa filter kelas."
      />
    </>
  );
}
