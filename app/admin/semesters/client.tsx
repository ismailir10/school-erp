"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { DatePicker } from "@/components/ui/date-picker";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BookMarked, CalendarRange, Layers, Plus, Target } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort } from "@/lib/format";
import { semesterFormSchema } from "@/lib/validations/curriculum";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

type Semester = {
  id: string;
  academicYearId: string;
  number: 1 | 2;
  startDate: string;
  endDate: string;
  status: string;
  academicYear: { id: string; name: string; status: string };
  _count: { themes: number };
};
type AcademicYear = { id: string; name: string; status: string };

type StatusFilter = "ACTIVE" | "INACTIVE" | "all";

const NUMBER_LABEL: Record<number, string> = { 1: "Semester 1", 2: "Semester 2" };
const YEAR_STATUS_SUFFIX: Record<string, string> = { PLANNING: " (perencanaan)", ARCHIVED: " (diarsipkan)" };

const EMPTY_SEMESTER_FORM = {
  academicYearId: "",
  number: "1" as const,
  startDate: "",
  endDate: "",
};

function toJakartaYmd(iso: string): string {
  // The API returns UTC-midnight DateTime values; for display we want the
  // Jakarta-day label. Since storage is UTC-midnight of the Jakarta day,
  // reading the UTC YMD off the ISO string is the inverse mapping.
  return iso.slice(0, 10);
}

export function SemestersClient({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Semester[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [ayFilter, setAyFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize] = useState(10);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Semester | null>(null);
  const formId = useId();
  const form = useZodForm(semesterFormSchema, { defaultValues: EMPTY_SEMESTER_FORM });
  const formStartDate = form.watch("startDate");
  const formEndDate = form.watch("endDate");

  const [deactivateTarget, setDeactivateTarget] = useState<Semester | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<Semester | null>(null);

  async function fetchAll() {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: "100" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (ayFilter !== "all") params.set("academicYearId", ayFilter);
    const [semRes, ayRes] = await Promise.all([
      fetch(`/api/admin/curriculum/semesters?${params.toString()}`).then((r) => r.json()),
      fetch("/api/academic-years").then((r) => r.json()),
    ]);
    setRows(Array.isArray(semRes?.data) ? semRes.data : []);
    setAcademicYears(Array.isArray(ayRes) ? ayRes : ayRes?.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, ayFilter]);

  useEffect(() => {
    setTablePage(1);
  }, [statusFilter, ayFilter, query]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === "ACTIVE");
    const themeTotal = active.reduce((acc, r) => acc + r._count.themes, 0);
    return { active: active.length, all: rows.length, themes: themeTotal };
  }, [rows]);

  const resetForm = useCallback(() => {
    setEditing(null);
    form.reset(EMPTY_SEMESTER_FORM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    resetForm();
    setCreateOpen(true);
  }

  const openEdit = useCallback((row: Semester) => {
    setEditing(row);
    form.reset({
      academicYearId: row.academicYearId,
      number: String(row.number) as "1" | "2",
      startDate: toJakartaYmd(row.startDate),
      endDate: toJakartaYmd(row.endDate),
    });
    setCreateOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = form.handleSubmit(async (values) => {
    const url = editing
      ? `/api/admin/curriculum/semesters/${editing.id}`
      : `/api/admin/curriculum/semesters`;
    const method = editing ? "PUT" : "POST";
    const body = editing
      ? { number: values.number, startDate: values.startDate, endDate: values.endDate }
      : {
          academicYearId: values.academicYearId,
          number: values.number,
          startDate: values.startDate,
          endDate: values.endDate,
        };
    try {
      const saved = await sendJson<{ status?: string; number?: number } | null>(url, { method, body }, "Gagal menyimpan");
      if (!editing && saved?.status === "INACTIVE") {
        // DOC-3: the year already has an active semester and creating another
        // must not silently take over. Say so, and show it (the default list
        // filter is "Aktif", which would otherwise hide the new row).
        toast.info(`${NUMBER_LABEL[saved.number ?? Number(values.number)]} ditambahkan tetapi belum aktif. Semester yang sedang aktif tidak berubah; aktifkan dari menu baris bila perlu.`);
        setStatusFilter("all");
      } else {
        toast.success(editing ? "Semester diperbarui" : "Semester ditambahkan");
      }
      setCreateOpen(false);
      resetForm();
      fetchAll();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan");
    }
  });

  async function flipStatus(target: Semester, status: "ACTIVE" | "INACTIVE") {
    const res = await fetch(`/api/admin/curriculum/semesters/${target.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast.success(status === "ACTIVE" ? "Diaktifkan" : "Dinonaktifkan");
      fetchAll();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Gagal");
    }
  }

  const columns = useMemo<ColumnDef<Semester>[]>(() => [
    {
      accessorKey: "academicYear",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tahun Ajaran" />,
      cell: ({ row }) => (
        <DataTableLinkCell
          href={`/admin/semesters/${row.original.id}/themes`}
          className="whitespace-normal"
          description={
            <>
              {NUMBER_LABEL[row.original.number]}
              {/* Status is hidden below `md`: repeat it under the name for a phone. */}
              <DataTableMobileMeta className="mt-1">
                <StatusBadge status={row.original.status} />
              </DataTableMobileMeta>
            </>
          }
        >
          {row.original.academicYear.name}
        </DataTableLinkCell>
      ),
    },
    {
      accessorKey: "startDate",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Periode" />,
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="text-sm">
          {formatDateShort(toJakartaYmd(row.original.startDate))} – {formatDateShort(toJakartaYmd(row.original.endDate))}
        </span>
      ),
    },
    {
      id: "themes",
      accessorFn: (r) => r._count.themes,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tema" />,
      cell: ({ row }) => <span className="font-currency text-sm">{row.original._count.themes}</span>,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      // Status sits under the name below `md` (DataTableMobileMeta above).
      meta: { priority: "low" },
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DataTableRowActions
          onEdit={canWrite ? () => openEdit(row.original) : undefined}
          onDeactivate={
            canWrite && row.original.status === "ACTIVE"
              ? () => setDeactivateTarget(row.original)
              : undefined
          }
          onActivate={
            canWrite && row.original.status === "INACTIVE"
              ? () => setReactivateTarget(row.original)
              : undefined
          }
          isActive={row.original.status === "ACTIVE"}
          extraActions={[
            {
              label: "Kelola tema",
              icon: <Layers size={14} />,
              onClick: () => router.push(`/admin/semesters/${row.original.id}/themes`),
            },
            {
              label: "Kelola Tujuan Pembelajaran",
              icon: <Target size={14} />,
              onClick: () => router.push(`/admin/semesters/${row.original.id}/objectives`),
            },
          ]}
        />
      ),
    },
  ], [canWrite, openEdit, router]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [
        row.academicYear.name,
        NUMBER_LABEL[row.number],
        row.status,
      ].some((value) => value.toLowerCase().includes(needle)),
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
      <PageHeader
        title="Kurikulum — Semester"
        description="Tahap awal pengaturan kurikulum: petakan semester ke tahun ajaran sebelum menambah tema, subtema, dan pekan."
        actions={
          canWrite ? (
            <Button onClick={openCreate} className="gap-2">
              <Plus className="size-4" /> Tambah Semester
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-section">
      <StatsCardsRow cols={3}>
        <StatCard label="Semester aktif" value={stats.active} icon={CalendarRange} color="success" index={0} />
        <StatCard label="Total tercatat" value={stats.all} icon={BookMarked} index={1} />
        <StatCard label="Tema terdaftar" value={stats.themes} icon={Layers} color="primary" sublabel="pada semester aktif" index={2} />
      </StatsCardsRow>

      <DataTableToolbar
        value={query}
        onValueChange={setQuery}
        searchPlaceholder="Cari semester atau tahun ajaran..."
        filters={[
          {
            key: "academicYear",
            label: "Tahun Ajaran",
            value: ayFilter,
            onChange: setAyFilter,
            options: [
              { value: "all", label: "Semua Tahun Ajaran" },
              ...academicYears.map((ay) => ({ value: ay.id, label: ay.name })),
            ],
          },
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            resetValue: "ACTIVE",
            onChange: (v) => setStatusFilter(v as StatusFilter),
            options: [
              { value: "all", label: "Semua Status" },
              { value: "ACTIVE", label: "Aktif" },
              { value: "INACTIVE", label: "Tidak Aktif" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        data={filteredRows}
        loading={loading}
        pagination={tablePagination}
        emptyTitle="Belum ada semester"
        emptyDescription="Semester yang ditambahkan akan tampil di sini."
      />
      </div>

      <ResponsiveFormDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) resetForm();
        }}
        title={editing ? "Ubah Semester" : "Tambah Semester"}
        description={editing ? "Perbarui periode atau status." : "Pilih tahun ajaran lalu tentukan nomor dan periode."}
        footer={
          <FormDialogFooter
            formId={formId}
            pending={form.formState.isSubmitting}
            onCancel={() => setCreateOpen(false)}
            submitLabel={editing ? "Simpan Perubahan" : "Tambah Semester"}
          />
        }
      >
        <form id={formId} onSubmit={save} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          <FormField
            control={form.control}
            name="academicYearId"
            label="Tahun ajaran"
            required
            id="semester-academic-year"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && field.onChange(v)}
                disabled={!!editing}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue placeholder="Pilih tahun ajaran" />
                </SelectTrigger>
                <SelectContent>
                  {academicYears
                    // DOC-3: next year's semesters are set up while that year is
                    // still PLANNING, so PLANNING years are offered too. Only
                    // ARCHIVED years are hidden — except when editing, where the
                    // row's own year must stay so the trigger is never empty.
                    .filter((ay) => ay.status !== "ARCHIVED" || ay.id === field.value)
                    .map((ay) => (
                      <SelectItem key={ay.id} value={ay.id}>
                        {ay.name}
                        {YEAR_STATUS_SUFFIX[ay.status] ?? ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          />

          <FormField
            control={form.control}
            name="number"
            label="Nomor semester"
            required
            id="semester-number"
            render={({ field, controlProps }) => (
              <Select
                value={String(field.value) as "1" | "2"}
                onValueChange={(v) => v != null && field.onChange(v)}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Semester 1</SelectItem>
                  <SelectItem value="2">Semester 2</SelectItem>
                </SelectContent>
              </Select>
            )}
          />

          <div className="grid grid-cols-2 gap-field">
            <FormField
              control={form.control}
              name="startDate"
              label="Tanggal mulai"
              required
              id="semester-start-date"
              render={({ field, controlProps }) => (
                <DatePicker {...controlProps} value={field.value} onChange={field.onChange} max={formEndDate || undefined} required />
              )}
            />
            <FormField
              control={form.control}
              name="endDate"
              label="Tanggal selesai"
              required
              id="semester-end-date"
              render={({ field, controlProps }) => (
                <DatePicker {...controlProps} value={field.value} onChange={field.onChange} min={formStartDate || undefined} required />
              )}
            />
          </div>
        </form>
      </ResponsiveFormDialog>

      <DeactivateConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(v) => !v && setDeactivateTarget(null)}
        entityName={
          deactivateTarget
            ? `semester ${NUMBER_LABEL[deactivateTarget.number]} (${deactivateTarget.academicYear.name})`
            : "semester"
        }
        extraWarning={
          deactivateTarget && deactivateTarget._count.themes > 0
            ? `${deactivateTarget._count.themes} tema terkait tetap aktif.`
            : undefined
        }
        onConfirm={async () => {
          if (deactivateTarget) {
            await flipStatus(deactivateTarget, "INACTIVE");
            setDeactivateTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        onOpenChange={(v) => !v && setReactivateTarget(null)}
        title="Aktifkan kembali semester?"
        description={
          reactivateTarget
            ? `${reactivateTarget.academicYear.name} · ${NUMBER_LABEL[reactivateTarget.number]} akan menjadi semester aktif tahun ajaran ini. Semester lain yang sedang aktif di tahun ajaran yang sama akan dinonaktifkan.`
            : ""
        }
        confirmLabel="Aktifkan"
        onConfirm={async () => {
          if (reactivateTarget) {
            await flipStatus(reactivateTarget, "ACTIVE");
            setReactivateTarget(null);
          }
        }}
      />
    </>
  );
}
