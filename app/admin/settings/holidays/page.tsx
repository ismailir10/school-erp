"use client";

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
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
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort } from "@/lib/format";
import { holidaySchema } from "@/lib/validations/holiday";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

type Holiday = {
  id: string;
  date: string;
  name: string;
  type: string;
  isHalfDay: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  NATIONAL: "Nasional",
  ISLAMIC: "Keagamaan",
  SCHOOL_CLOSURE: "Penutupan Sekolah",
};

const EMPTY_FORM = { date: "", name: "", type: "NATIONAL", isHalfDay: false };

export default function HolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const formId = useId();
  const form = useZodForm(holidaySchema, { defaultValues: EMPTY_FORM });
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [query, setQuery] = useState("");

  async function fetchHolidays() {
    const res = await fetch("/api/config/holidays");
    setHolidays(await res.json());
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchHolidays(); }, []);

  function openNew() {
    setEditing(null);
    form.reset(EMPTY_FORM);
    setDialogOpen(true);
  }

  const openEdit = useCallback(
    (h: Holiday) => {
      setEditing(h);
      form.reset({ date: h.date, name: h.name, type: h.type, isHalfDay: h.isHalfDay });
      setDialogOpen(true);
    },
    [form],
  );

  const handleSave = form.handleSubmit(async (values) => {
    try {
      await sendJson(
        editing ? `/api/config/holidays/${editing.id}` : "/api/config/holidays",
        { method: editing ? "PUT" : "POST", body: values },
        MESSAGES.saveFailed,
      );
      toast.success(editing ? "Hari libur diperbarui" : "Hari libur ditambahkan");
      setDialogOpen(false);
      fetchHolidays();
    } catch (err) {
      applyServerErrors(form, err, MESSAGES.saveFailed);
    }
  });

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/config/holidays/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Hari libur dihapus"); setDeleteTarget(null); fetchHolidays(); }
    else toast.error(MESSAGES.deleteFailed);
  }

  const filteredHolidays = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return holidays;
    return holidays.filter((h) =>
      [h.name, formatDateShort(h.date)].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [holidays, query]);

  // Memoised — a fresh array every render would remount row cells and close
  // any open row-action menu (Cycle 3 T7).
  const columns: ColumnDef<Holiday>[] = useMemo(() => [
    {
      accessorKey: "date",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Tanggal" />
      ),
      cell: ({ row }) => (
        <span className="text-sm">
          {formatDateShort(row.original.date)}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Nama" />
      ),
      cell: ({ row }) => (
        <div className="min-w-0 whitespace-normal">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{row.original.name}</span>
            {row.original.isHalfDay && <Badge variant="outline" className="text-xs">½ Hari</Badge>}
          </div>
          <DataTableMobileMeta className="mt-1">
            <StatusBadge
              status={row.original.type}
              label={TYPE_LABELS[row.original.type] ?? row.original.type}
            />
          </DataTableMobileMeta>
        </div>
      ),
    },
    {
      accessorKey: "type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Tipe" />
      ),
      meta: { priority: "low" },
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.type}
          label={TYPE_LABELS[row.original.type] ?? row.original.type}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DataTableRowActions
          onEdit={() => openEdit(row.original)}
          extraActions={[
            {
              label: "Hapus",
              icon: <Trash2 size={14} />,
              destructive: true,
              onClick: () => setDeleteTarget(row.original),
            },
          ]}
        />
      ),
    },
  ], [openEdit]);

  return (
    <>
      <PageHeader
        title="Hari Libur"
        description="Kelola tanggal libur untuk perhitungan hari kerja"
        actions={
          <Button onClick={openNew} size="sm">
            <Plus size={16} className="mr-1.5" /> Tambah Hari Libur
          </Button>
        }
      />

      <DataTableToolbar
        value={query}
        onValueChange={setQuery}
        searchPlaceholder="Cari nama atau tanggal..."
      />

      <DataTable
        columns={columns}
        data={filteredHolidays}
        loading={loading}
        defaultSort={{ field: "date", order: "asc" }}
        emptyTitle="Belum ada hari libur"
        emptyDescription="Tambahkan hari libur untuk perhitungan hari kerja."
      />

      {/* Delete confirm */}
      <DeactivateConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        entityName={deleteTarget?.name ?? ""}
        action="delete"
        onConfirm={handleDelete}
      />

      {/* Add/Edit Dialog */}
      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit Hari Libur" : "Tambah Hari Libur"}
        description="Hari libur mempengaruhi perhitungan hari kerja"
        footer={
          <FormDialogFooter
            formId={formId}
            pending={form.formState.isSubmitting}
            onCancel={() => setDialogOpen(false)}
            submitLabel={editing ? "Simpan Perubahan" : "Tambah Hari Libur"}
          />
        }
      >
        <form id={formId} onSubmit={handleSave} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          <FormField
            control={form.control}
            name="date"
            label="Tanggal"
            required
            id="holiday-date"
            render={({ field, controlProps }) => (
              <DatePicker {...controlProps} value={field.value} onChange={field.onChange} required />
            )}
          />
          <FormField
            control={form.control}
            name="name"
            label="Nama"
            required
            id="holiday-name"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} placeholder="Hari Raya Idul Fitri" />
            )}
          />
          <FormField
            control={form.control}
            name="type"
            label="Tipe"
            id="holiday-type"
            render={({ field, controlProps }) => (
              <Select value={field.value} onValueChange={(v) => v && field.onChange(v)} items={TYPE_LABELS}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NATIONAL">Nasional</SelectItem>
                  <SelectItem value="ISLAMIC">Islam</SelectItem>
                  <SelectItem value="SCHOOL_CLOSURE">Penutupan Sekolah</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="isHalfDay"
            label="Setengah hari"
            orientation="horizontal"
            render={({ field, controlProps }) => (
              <Checkbox {...controlProps} checked={!!field.value} onCheckedChange={(c) => field.onChange(!!c)} onBlur={field.onBlur} />
            )}
          />
        </form>
      </ResponsiveFormDialog>
    </>
  );
}
