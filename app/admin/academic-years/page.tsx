"use client";

// Frontend cross-check: dialog + row actions follow design-system.html
// (ResponsiveFormDialog overlay, Select, Button states). This page is a
// single "use client" component — no server wrapper to host the note.

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { Plus, ArrowRightCircle, Archive } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort } from "@/lib/format";
import { academicYearFormSchema } from "@/lib/validations/academic-year";
import { programFormSchema } from "@/lib/validations/program";
import { rollForwardSchema } from "@/lib/validations/roll-forward";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { ApiError } from "@/lib/api/client-errors";
import { nextAcademicYearDefaults } from "@/lib/academic-year/next-year-defaults";
import { activationDescription, archiveDescription } from "@/lib/academic-year/activation-copy";

type AcademicYear = { id: string; name: string; startDate: string; endDate: string; status: string };
type Program = { id: string; code: string; name: string; description: string | null; type: string; ageMin: number | null; ageMax: number | null; status: string; _count: { classSections: number } };

const TYPE_LABELS: Record<string, string> = {
  SEMESTER: "Semester",
  YEAR_ROUND: "Sepanjang Tahun",
  SESSION: "Per Sesi",
};

const EMPTY_YEAR_FORM = { name: "", startDate: "", endDate: "" };
const EMPTY_PROGRAM_FORM = { code: "", name: "", description: "", type: "SEMESTER" as const, ageMin: "", ageMax: "" };
const EMPTY_ROLL_FORWARD_FORM = { sourceYearId: "" };

export default function AcademicPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [yearDialog, setYearDialog] = useState(false);
  const [programDialog, setProgramDialog] = useState(false);
  const yearFormId = useId();
  const programFormId = useId();
  const rollForwardFormId = useId();
  const yearForm = useZodForm(academicYearFormSchema, { defaultValues: EMPTY_YEAR_FORM });
  const programForm = useZodForm(programFormSchema, { defaultValues: EMPTY_PROGRAM_FORM });
  const yearStartDate = yearForm.watch("startDate");
  const yearEndDate = yearForm.watch("endDate");
  const [editingYear, setEditingYear] = useState<AcademicYear | null>(null);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<{ type: string; id: string; name: string } | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<{ type: string; id: string; name: string } | null>(null);
  // CORE-6: activating / archiving a year each have their own confirm that
  // states the real effect; PLANNING years can be archived too.
  const [activateYearTarget, setActivateYearTarget] = useState<AcademicYear | null>(null);
  const [archiveYearTarget, setArchiveYearTarget] = useState<AcademicYear | null>(null);
  const [programStatusFilter, setProgramStatusFilter] = useState<"all" | "ACTIVE" | "INACTIVE">("ACTIVE");
  const [yearStatusFilter, setYearStatusFilter] = useState<"all" | "ACTIVE" | "INACTIVE" | "PLANNING" | "ARCHIVED">("all");
  const [programQuery, setProgramQuery] = useState("");
  const [yearQuery, setYearQuery] = useState("");
  const [programPage, setProgramPage] = useState(1);
  const [programPageSize] = useState(10);
  const [yearPage, setYearPage] = useState(1);
  const [yearPageSize] = useState(10);

  // Roll forward — clone a source year's active class sections into a target year
  const [rollForwardTarget, setRollForwardTarget] = useState<AcademicYear | null>(null);
  const rollForwardForm = useZodForm(rollForwardSchema, { defaultValues: EMPTY_ROLL_FORWARD_FORM });

  // R2-ADMIN-15: "Tambah Tahun Ajaran" continues the latest open year.
  const nextYear = useMemo(() => nextAcademicYearDefaults(years), [years]);

  async function fetchAll() {
    const [y, p] = await Promise.all([
      fetch("/api/academic-years").then(r => r.json()),
      fetch("/api/programs").then(r => r.json()),
    ]);
    setYears(y); setPrograms(p);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgramPage(1);
  }, [programStatusFilter, programQuery]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setYearPage(1);
  }, [yearStatusFilter, yearQuery]);

  const saveYear = yearForm.handleSubmit(async (values) => {
    try {
      await sendJson(
        editingYear ? `/api/academic-years/${editingYear.id}` : "/api/academic-years",
        { method: editingYear ? "PUT" : "POST", body: values },
        "Gagal menyimpan",
      );
      toast.success(editingYear ? "Tahun ajaran diperbarui" : "Tahun ajaran ditambahkan");
      setYearDialog(false);
      setEditingYear(null);
      fetchAll();
    } catch (err) {
      // A clash like the overlap check comes back as a field error. Say what is
      // wrong in the toast instead of the generic "Periksa kolom yang ditandai".
      const fieldErrors = err instanceof ApiError ? err.fieldErrors : [];
      const mapped = fieldErrors.filter((e) => e.field === "name" || e.field === "startDate" || e.field === "endDate");
      if (mapped.length > 0) {
        mapped.forEach((e, i) =>
          yearForm.setError(e.field as "name" | "startDate" | "endDate", { type: "server", message: e.message }, { shouldFocus: i === 0 }),
        );
        toast.error(mapped[0].message);
        return;
      }
      applyServerErrors(yearForm, err, "Gagal menyimpan");
    }
  });

  const saveProgram = programForm.handleSubmit(async (values) => {
    try {
      await sendJson(
        editingProgram ? `/api/programs/${editingProgram.id}` : "/api/programs",
        { method: editingProgram ? "PUT" : "POST", body: values },
        "Gagal menyimpan",
      );
      toast.success(editingProgram ? "Program diperbarui" : "Program ditambahkan");
      setProgramDialog(false);
      setEditingProgram(null);
      fetchAll();
    } catch (err) {
      applyServerErrors(programForm, err, "Gagal menyimpan");
    }
  });

  async function handleDeactivate() {
    if (!deactivateTarget) return;
    const urlMap: Record<string, string> = {
      year: `/api/academic-years/${deactivateTarget.id}`,
      program: `/api/programs/${deactivateTarget.id}`,
    };
    const res = await fetch(urlMap[deactivateTarget.type], {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "INACTIVE" }),
    });
    if (res.ok) { toast.success("Dinonaktifkan"); setDeactivateTarget(null); fetchAll(); }
    else { const d = await res.json(); toast.error(d.error || "Gagal"); }
  }

  async function handleReactivate() {
    if (!reactivateTarget) return;
    const urlMap: Record<string, string> = {
      year: `/api/academic-years/${reactivateTarget.id}`,
      program: `/api/programs/${reactivateTarget.id}`,
    };
    const res = await fetch(urlMap[reactivateTarget.type], {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    if (res.ok) { toast.success("Diaktifkan"); setReactivateTarget(null); fetchAll(); }
    else { const d = await res.json(); toast.error(d.error || "Gagal"); }
  }

  async function handleActivateYear() {
    if (!activateYearTarget) return;
    const res = await fetch(`/api/academic-years/${activateYearTarget.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" }),
    });
    if (res.ok) {
      toast.success(`${activateYearTarget.name} kini menjadi tahun ajaran aktif`);
      setActivateYearTarget(null);
      fetchAll();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal mengaktifkan tahun ajaran");
    }
  }

  async function handleArchiveYear() {
    if (!archiveYearTarget) return;
    const res = await fetch(`/api/academic-years/${archiveYearTarget.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ARCHIVED" }),
    });
    if (res.ok) {
      toast.success(`${archiveYearTarget.name} diarsipkan`);
      setArchiveYearTarget(null);
      fetchAll();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal mengarsipkan tahun ajaran");
      // Keep the dialog open so the reason stays readable next to the action.
      throw new Error("archive failed");
    }
  }

  const handleRollForward = rollForwardForm.handleSubmit(async (values) => {
    if (!rollForwardTarget) return;
    try {
      const d = await sendJson<{
        sectionsCreated: number;
        tracksSkippedAlreadyRolled: number;
        truncated: boolean;
      }>(
        `/api/admin/academic-years/${rollForwardTarget.id}/roll-forward`,
        { method: "POST", body: { sourceYearId: values.sourceYearId, trackIds: [] } },
        "Gagal menggulir kelas",
      );
      if (d.sectionsCreated === 0 && d.tracksSkippedAlreadyRolled === 0) {
        toast.info("Tidak ada kelas aktif yang bisa digulir dari tahun ajaran sumber");
      } else {
        let msg = `${d.sectionsCreated} kelas digulir ke ${rollForwardTarget.name}`;
        if (d.tracksSkippedAlreadyRolled > 0) {
          msg += ` · ${d.tracksSkippedAlreadyRolled} kelas dilewati (sudah ada)`;
        }
        toast.success(msg);
        if (d.truncated) {
          toast.info("Sebagian kelas digulir — jalankan lagi untuk sisanya");
        }
      }
      setRollForwardTarget(null);
      fetchAll();
    } catch (err) {
      applyServerErrors(rollForwardForm, err, "Gagal menggulir kelas");
    }
  });

  // --- Column definitions ---

  const programColumns = useMemo<ColumnDef<Program>[]>(() => [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Program" />,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{p.name}</span>
              <Badge variant="outline" className="text-xs font-currency">{p.code}</Badge>
            </div>
            {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tipe" />,
      meta: { priority: "low" },
      cell: ({ row }) => <span className="text-sm">{TYPE_LABELS[row.original.type] ?? row.original.type}</span>,
    },
    {
      id: "age",
      header: "Usia",
      meta: { priority: "low" },
      cell: ({ row }) => {
        const p = row.original;
        if (p.ageMin == null) return <span className="text-xs text-muted-foreground">—</span>;
        return <span className="text-xs">{Math.floor(p.ageMin / 12)}–{Math.floor((p.ageMax ?? 72) / 12)} tahun</span>;
      },
    },
    {
      id: "classes",
      accessorFn: (row) => row._count.classSections,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Kelas" />,
      cell: ({ row }) => <span className="font-currency text-sm">{row.original._count.classSections}</span>,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DataTableRowActions
          onEdit={() => {
            const p = row.original;
            setEditingProgram(p);
            programForm.reset({ code: p.code, name: p.name, description: p.description ?? "", type: p.type as "SEMESTER" | "YEAR_ROUND" | "SESSION", ageMin: p.ageMin ? String(p.ageMin) : "", ageMax: p.ageMax ? String(p.ageMax) : "" });
            setProgramDialog(true);
          }}
          onDeactivate={() => setDeactivateTarget({ type: "program", id: row.original.id, name: row.original.name })}
          onActivate={() => setReactivateTarget({ type: "program", id: row.original.id, name: row.original.name })}
          isActive={row.original.status === "ACTIVE"}
        />
      ),
    },
  ], [programForm]);

  const filteredPrograms = useMemo(() => {
    const needle = programQuery.trim().toLowerCase();
    return programs.filter((p) => {
      const statusMatch = programStatusFilter === "all" || p.status === programStatusFilter;
      const queryMatch = !needle || [p.name, p.code, p.description ?? "", p.type]
        .some((value) => value.toLowerCase().includes(needle));
      return statusMatch && queryMatch;
    });
  }, [programQuery, programStatusFilter, programs]);
  const programTotalPages = Math.max(1, Math.ceil(filteredPrograms.length / programPageSize));
  const safeProgramPage = Math.min(programPage, programTotalPages);
  const programPagination = {
    page: safeProgramPage,
    pageSize: programPageSize,
    total: filteredPrograms.length,
    totalPages: programTotalPages,
  };

  const yearColumns = useMemo<ColumnDef<AcademicYear>[]>(() => [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tahun Ajaran" />,
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "startDate",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Periode" />,
      meta: { priority: "low" },
      cell: ({ row }) => {
        const y = row.original;
        return (
          <span className="text-xs text-muted-foreground">
            {formatDateShort(y.startDate)}
            {" — "}
            {formatDateShort(y.endDate)}
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "manageClasses",
      header: "",
      cell: ({ row }) => (
        <Link
          href={`/admin/classes?yearId=${row.original.id}`}
          className="text-xs text-primary-text hover:underline inline-flex items-center gap-1"
        >
          Kelola kelas tahun ini
          <ArrowRightCircle size={12} />
        </Link>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DataTableRowActions
          onEdit={() => {
            const y = row.original;
            setEditingYear(y);
            yearForm.reset({ name: y.name, startDate: y.startDate, endDate: y.endDate });
            setYearDialog(true);
          }}
          onActivate={() => setActivateYearTarget(row.original)}
          isActive={row.original.status === "ACTIVE"}
          extraActions={[
            {
              label: "Salin kelas dari tahun sebelumnya",
              icon: <ArrowRightCircle size={14} />,
              onClick: () => {
                setRollForwardTarget(row.original);
                rollForwardForm.reset(EMPTY_ROLL_FORWARD_FORM);
              },
            },
            ...(row.original.status !== "ARCHIVED"
              ? [{
                  label: "Arsipkan",
                  icon: <Archive size={14} />,
                  destructive: true,
                  onClick: () => setArchiveYearTarget(row.original),
                }]
              : []),
          ]}
        />
      ),
    },
  ], [yearForm, rollForwardForm]);

  const filteredYears = useMemo(() => {
    const needle = yearQuery.trim().toLowerCase();
    return years.filter((year) => {
      const statusMatch = yearStatusFilter === "all" || year.status === yearStatusFilter;
      const queryMatch = !needle || [year.name, year.status]
        .some((value) => value.toLowerCase().includes(needle));
      return statusMatch && queryMatch;
    });
  }, [yearQuery, yearStatusFilter, years]);
  const yearTotalPages = Math.max(1, Math.ceil(filteredYears.length / yearPageSize));
  const safeYearPage = Math.min(yearPage, yearTotalPages);
  const yearPagination = {
    page: safeYearPage,
    pageSize: yearPageSize,
    total: filteredYears.length,
    totalPages: yearTotalPages,
  };

  return (
    <>
      <PageHeader title="Tahun Ajaran" description="Program dan tahun ajaran" />

      {/* Programs Section */}
      <div className="mb-8">
        <h2 className="mb-4 text-h2 font-semibold">Program</h2>
        <DataTableToolbar
          value={programQuery}
          onValueChange={setProgramQuery}
          searchPlaceholder="Cari program atau kode..."
          filters={[
            {
              key: "programStatus",
              label: "Status",
              value: programStatusFilter,
              resetValue: "ACTIVE",
              onChange: (v) => setProgramStatusFilter(v as "all" | "ACTIVE" | "INACTIVE"),
              options: [
                { value: "all", label: "Semua Status" },
                { value: "ACTIVE", label: "Aktif" },
                { value: "INACTIVE", label: "Tidak Aktif" },
              ],
            },
          ]}
          actions={
            <Button size="sm" onClick={() => { setEditingProgram(null); programForm.reset(EMPTY_PROGRAM_FORM); setProgramDialog(true); }}>
              <Plus size={14} className="mr-1.5" /> Tambah Program
            </Button>
          }
        />
        <DataTable
          columns={programColumns}
          data={filteredPrograms}
          loading={loading}
          pagination={programPagination}
          defaultSort={{ field: "name", order: "asc" }}
          emptyTitle="Belum ada program"
          emptyDescription="Tambahkan program pendidikan untuk mengelompokkan kelas dan biaya."
        />
      </div>

      {/* Academic Years Section */}
      <div className="mb-8">
        <h2 className="mb-4 text-h2 font-semibold">Tahun Ajaran</h2>
        <DataTableToolbar
          value={yearQuery}
          onValueChange={setYearQuery}
          searchPlaceholder="Cari tahun ajaran..."
          filters={[
            {
              key: "yearStatus",
              label: "Status",
              value: yearStatusFilter,
              onChange: (v) => setYearStatusFilter(v as typeof yearStatusFilter),
              options: [
                { value: "all", label: "Semua Status" },
                { value: "PLANNING", label: "Rencana" },
                { value: "ACTIVE", label: "Aktif" },
                { value: "ARCHIVED", label: "Arsip" },
                { value: "INACTIVE", label: "Tidak Aktif" },
              ],
            },
          ]}
          actions={
            <Button size="sm" onClick={() => {
              setEditingYear(null);
              yearForm.reset(nextYear ? { name: "", startDate: nextYear.startDate, endDate: nextYear.endDate } : EMPTY_YEAR_FORM);
              setYearDialog(true);
            }}>
              <Plus size={14} className="mr-1.5" /> Tambah Tahun Ajaran
            </Button>
          }
        />
        <DataTable
          columns={yearColumns}
          data={filteredYears}
          loading={loading}
          pagination={yearPagination}
          defaultSort={{ field: "name", order: "desc" }}
          emptyTitle="Belum ada tahun ajaran"
          emptyDescription="Tambahkan tahun ajaran untuk membuka periode kelas, semester, dan rapor."
        />
      </div>

      {/* Add Year Dialog */}
      <ResponsiveFormDialog
        open={yearDialog}
        onOpenChange={setYearDialog}
        title={editingYear ? "Edit Tahun Ajaran" : "Tambah Tahun Ajaran"}
        size="xl"
        footer={
          <FormDialogFooter
            formId={yearFormId}
            pending={yearForm.formState.isSubmitting}
            onCancel={() => setYearDialog(false)}
            submitLabel={editingYear ? "Simpan Perubahan" : "Tambah Tahun Ajaran"}
          />
        }
      >
        <form id={yearFormId} onSubmit={saveYear} noValidate className="space-y-field">
          <FormRootError formState={yearForm.formState} />
          <FormField
            control={yearForm.control}
            name="name"
            label="Nama"
            required
            id="year-name"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} placeholder={nextYear?.name ?? "2026/2027"} />
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={yearForm.control}
              name="startDate"
              label="Mulai"
              required
              id="year-startDate"
              render={({ field, controlProps }) => (
                <DatePicker {...controlProps} value={field.value} onChange={field.onChange} max={yearEndDate || undefined} required />
              )}
            />
            <FormField
              control={yearForm.control}
              name="endDate"
              label="Selesai"
              required
              id="year-endDate"
              render={({ field, controlProps }) => (
                <DatePicker {...controlProps} value={field.value} onChange={field.onChange} min={yearStartDate || undefined} required />
              )}
            />
          </div>
        </form>
      </ResponsiveFormDialog>

      {/* Add Program Dialog */}
      <ResponsiveFormDialog
        open={programDialog}
        onOpenChange={setProgramDialog}
        title={editingProgram ? "Edit Program" : "Tambah Program"}
        size="lg"
        footer={
          <FormDialogFooter
            formId={programFormId}
            pending={programForm.formState.isSubmitting}
            onCancel={() => setProgramDialog(false)}
            submitLabel={editingProgram ? "Simpan Perubahan" : "Tambah Program"}
          />
        }
      >
        <form id={programFormId} onSubmit={saveProgram} noValidate className="space-y-field">
          <FormRootError formState={programForm.formState} />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={programForm.control}
              name="code"
              label="Kode"
              required
              id="program-code"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} placeholder="TKIT" />
              )}
            />
            <FormField
              control={programForm.control}
              name="name"
              label="Nama"
              required
              id="program-name"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} placeholder="TK Islam Terpadu" />
              )}
            />
          </div>
          <FormField
            control={programForm.control}
            name="description"
            label="Deskripsi"
            id="program-description"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={field.value ?? ""} />
            )}
          />
          <FormField
            control={programForm.control}
            name="type"
            label="Tipe"
            id="program-type"
            render={({ field, controlProps }) => (
              <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)} items={{ SEMESTER: "Semester", YEAR_ROUND: "Sepanjang Tahun", SESSION: "Per Sesi" }}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SEMESTER">Semester</SelectItem>
                  <SelectItem value="YEAR_ROUND">Sepanjang Tahun</SelectItem>
                  <SelectItem value="SESSION">Per Sesi</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={programForm.control}
              name="ageMin"
              label="Usia Min (bulan)"
              id="program-ageMin"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={field.value ?? ""} type="number" />
              )}
            />
            <FormField
              control={programForm.control}
              name="ageMax"
              label="Usia Max (bulan)"
              id="program-ageMax"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={field.value ?? ""} type="number" />
              )}
            />
          </div>
        </form>
      </ResponsiveFormDialog>

      {/* Roll Forward Dialog */}
      <ResponsiveFormDialog
        open={!!rollForwardTarget}
        onOpenChange={(o) => { if (!o) setRollForwardTarget(null); }}
        title="Salin Kelas ke Tahun Ajaran"
        size="lg"
        footer={
          <FormDialogFooter
            formId={rollForwardFormId}
            pending={rollForwardForm.formState.isSubmitting}
            onCancel={() => setRollForwardTarget(null)}
            submitLabel="Salin Kelas"
            pendingLabel="Menyalin..."
          />
        }
      >
        <form id={rollForwardFormId} onSubmit={handleRollForward} noValidate className="space-y-field">
          <FormRootError formState={rollForwardForm.formState} />
          <p className="text-sm text-muted-foreground">
            Menyalin semua kelas aktif dari tahun ajaran sumber ke{" "}
            <span className="font-medium text-foreground">{rollForwardTarget?.name}</span>.
            Kelas yang sudah ada di tahun ini akan dilewati.
          </p>
          <FormField
            control={rollForwardForm.control}
            name="sourceYearId"
            label="Tahun Ajaran Sumber"
            required
            id="rollforward-sourceYear"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && field.onChange(v)}
                items={years.filter(y => y.id !== rollForwardTarget?.id).map(y => ({ label: y.name, value: y.id }))}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih tahun ajaran sumber" /></SelectTrigger>
                <SelectContent>
                  {years.filter(y => y.id !== rollForwardTarget?.id).map(y => (
                    <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </form>
      </ResponsiveFormDialog>

      {/* Deactivate Confirm */}
      <DeactivateConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        entityName={deactivateTarget?.name ?? ""}
        onConfirm={handleDeactivate}
      />

      {/* CORE-6: activating a year switches the whole school — say so. */}
      <ConfirmDialog
        open={!!activateYearTarget}
        onOpenChange={(o) => !o && setActivateYearTarget(null)}
        title={`Aktifkan tahun ajaran ${activateYearTarget?.name ?? ""}?`}
        description={activateYearTarget ? activationDescription(activateYearTarget, years) : undefined}
        onConfirm={handleActivateYear}
        confirmLabel="Aktifkan"
      />

      <ConfirmDialog
        open={!!archiveYearTarget}
        onOpenChange={(o) => !o && setArchiveYearTarget(null)}
        title={`Arsipkan tahun ajaran ${archiveYearTarget?.name ?? ""}?`}
        description={archiveYearTarget ? archiveDescription(archiveYearTarget) : undefined}
        onConfirm={handleArchiveYear}
        confirmLabel="Arsipkan"
        destructive
      />

      {/* Reactivate Confirm */}
      <ConfirmDialog
        open={!!reactivateTarget}
        onOpenChange={(o) => !o && setReactivateTarget(null)}
        title="Aktifkan"
        description={`Aktifkan kembali "${reactivateTarget?.name}"?`}
        onConfirm={handleReactivate}
        confirmLabel="Aktifkan"
      />
    </>
  );
}
