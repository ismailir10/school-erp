"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useWatch } from "react-hook-form";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { salaryComponentFormSchema } from "@/lib/validations/payroll";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

type Component = {
  id: string;
  code: string;
  label: string;
  category: string;
  calcType: string;
  isProRated: boolean;
  isEnabled: boolean;
  sortOrder: number;
};

type CalcType = "FIXED" | "PCT_OF_BASE" | "ATTENDANCE_BASED";

// Single source of truth for calcType copy — shared between the list column
// and the create/edit dialog's Select so the two never drift (was "Berbasis
// Kehadiran" in the dialog vs. "Kehadiran" in the list).
const CALC_LABELS: Record<string, string> = {
  FIXED: "Tetap",
  PCT_OF_BASE: "% Gaji Pokok",
  ATTENDANCE_BASED: "Kehadiran",
};

const EMPTY_FORM = {
  code: "", label: "",
  category: "INCOME" as "INCOME" | "DEDUCTION",
  calcType: "FIXED" as CalcType,
  isProRated: false, sortOrder: "0",
};

export default function SalaryComponentsPage() {
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Component | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const formId = useId();
  // Reused for both create and edit — `code` is required by the schema but
  // hidden once editing (not re-editable); defaultValues seeds it from the
  // existing row so it stays valid without a visible control.
  const form = useZodForm(salaryComponentFormSchema, { defaultValues: EMPTY_FORM });
  const watchedCalcType = useWatch({ control: form.control, name: "calcType" });
  const [confirmTarget, setConfirmTarget] = useState<Component | null>(null);

  const fetchComponents = useCallback(async () => {
    const res = await fetch("/api/salary-components");
    setComponents(await res.json());
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchComponents(); }, [fetchComponents]);

  function openNew() {
    setEditing(null);
    form.reset({ ...EMPTY_FORM, sortOrder: String(components.length + 1) });
    setDialogOpen(true);
  }

  const openEdit = useCallback((c: Component) => {
    setEditing(c);
    form.reset({
      code: c.code, label: c.label,
      category: c.category as "INCOME" | "DEDUCTION",
      calcType: c.calcType as CalcType,
      isProRated: c.isProRated, sortOrder: String(c.sortOrder),
    });
    setDialogOpen(true);
  }, [form]);

  const handleSave = form.handleSubmit(async (values) => {
    try {
      await sendJson(
        editing ? `/api/salary-components/${editing.id}` : "/api/salary-components",
        { method: editing ? "PUT" : "POST", body: values },
        "Gagal menyimpan komponen gaji. Periksa kolom yang ditandai.",
      );
      toast.success(editing ? "Komponen diperbarui" : "Komponen ditambahkan");
      setDialogOpen(false);
      fetchComponents();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan komponen gaji. Periksa kolom yang ditandai.");
    }
  });

  // Returns whether the toggle succeeded so callers (e.g. the deactivate
  // ConfirmDialog) can decide whether to keep their dialog open for retry.
  const toggleEnabled = useCallback(async (c: Component): Promise<boolean> => {
    const res = await fetch(`/api/salary-components/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: !c.isEnabled }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Gagal memperbarui komponen gaji. Coba lagi.");
      return false;
    }
    toast.success(c.isEnabled ? "Komponen dinonaktifkan" : "Komponen diaktifkan");
    fetchComponents();
    return true;
  }, [fetchComponents]);

  const filteredComponents = components.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      [c.code, c.label, CALC_LABELS[c.calcType] ?? c.calcType]
        .join(" ")
        .toLowerCase()
        .includes(q);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "ACTIVE" && c.isEnabled) ||
      (statusFilter === "INACTIVE" && !c.isEnabled);
    const matchesCategory = categoryFilter === "all" || c.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  });

  const columns = useMemo<ColumnDef<Component>[]>(() => [
    {
      accessorKey: "sortOrder",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="#" />
      ),
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.sortOrder}</span>
      ),
    },
    {
      accessorKey: "label",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Komponen" />
      ),
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div className={`whitespace-normal${!c.isEnabled ? " opacity-50" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{c.label}</span>
              <Badge variant="outline" className="hidden text-xs font-currency md:inline-flex">{c.code}</Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">{CALC_LABELS[c.calcType]}</span>
              {c.isProRated && <span className="text-xs text-muted-foreground">· Pro-rata</span>}
            </div>
            <DataTableMobileMeta className="mt-1">
              <Badge variant="outline" className="h-auto min-w-0 max-w-full shrink whitespace-normal break-all py-0.5 text-left text-xs font-currency">{c.code}</Badge>
              <StatusBadge
                status={c.category}
                label={c.category === "INCOME" ? "Pendapatan" : "Potongan"}
              />
            </DataTableMobileMeta>
          </div>
        );
      },
    },
    {
      accessorKey: "category",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Kategori" />
      ),
      meta: { priority: "low" },
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.category}
          label={row.original.category === "INCOME" ? "Pendapatan" : "Potongan"}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <DataTableRowActions
            onEdit={() => openEdit(c)}
            isActive={c.isEnabled}
            onDeactivate={() => setConfirmTarget(c)}
            onActivate={() => toggleEnabled(c)}
          />
        );
      },
    },
  ], [openEdit, toggleEnabled]);

  return (
    <>
      <PageHeader
        title="Komponen Gaji"
        description="Konfigurasi komponen pendapatan dan potongan"
        actions={
          <Button onClick={openNew} size="sm">
            <Plus size={16} className="mr-1.5" /> Tambah Komponen
          </Button>
        }
      />

      <DataTableToolbar
        value={search}
        onValueChange={setSearch}
        searchPlaceholder="Cari kode atau komponen..."
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            onChange: setStatusFilter,
            resetValue: "ACTIVE",
            options: [
              { value: "all", label: "Semua Status" },
              { value: "ACTIVE", label: "Aktif" },
              { value: "INACTIVE", label: "Tidak Aktif" },
            ],
          },
          {
            key: "category",
            label: "Kategori",
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: [
              { value: "all", label: "Semua Kategori" },
              { value: "INCOME", label: "Pendapatan" },
              { value: "DEDUCTION", label: "Potongan" },
            ],
          },
        ]}
      />

      <DataTable
        columns={columns}
        data={filteredComponents}
        pagination={{ page: 1, pageSize: 10, total: filteredComponents.length, totalPages: Math.max(1, Math.ceil(filteredComponents.length / 10)) }}
        loading={loading}
        defaultSort={{ field: "sortOrder", order: "asc" }}
        emptyTitle="Belum ada komponen gaji"
        emptyDescription="Ubah kata kunci atau filter, atau tambahkan komponen pendapatan dan potongan."
      />

      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit Komponen" : "Tambah Komponen"}
        description="Komponen gaji menentukan struktur penggajian"
        contentClassName="max-h-[90vh]"
        footer={
          <FormDialogFooter
            formId={formId}
            pending={form.formState.isSubmitting}
            onCancel={() => setDialogOpen(false)}
            submitLabel={editing ? "Simpan Perubahan" : "Tambah Komponen"}
          />
        }
      >
        <form id={formId} onSubmit={handleSave} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          {!editing && (
            <FormField
              control={form.control}
              name="code"
              label="Kode"
              required
              id="salary-component-code"
              description="Pengenal permanen. Huruf, angka, _ atau -, tanpa spasi."
              render={({ field, controlProps }) => <Input {...field} {...controlProps} placeholder="tunjangan_baru" />}
            />
          )}
          <FormField
            control={form.control}
            name="label"
            label="Label"
            required
            id="salary-component-label"
            render={({ field, controlProps }) => <Input {...field} {...controlProps} placeholder="Tunjangan Baru" />}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="category"
              label="Kategori"
              id="salary-component-category"
              render={({ field, controlProps }) => (
                <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)} items={{ INCOME: "Pendapatan", DEDUCTION: "Potongan" }}>
                  <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INCOME">Pendapatan</SelectItem>
                    <SelectItem value="DEDUCTION">Potongan</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <FormField
              control={form.control}
              name="calcType"
              label="Tipe Kalkulasi"
              id="salary-component-calc-type"
              render={({ field, controlProps }) => (
                <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)} items={CALC_LABELS}>
                  <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">{CALC_LABELS.FIXED}</SelectItem>
                    <SelectItem value="PCT_OF_BASE">{CALC_LABELS.PCT_OF_BASE}</SelectItem>
                    <SelectItem value="ATTENDANCE_BASED">{CALC_LABELS.ATTENDANCE_BASED}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="sortOrder"
            label="Urutan"
            id="salary-component-sort-order"
            description={
              watchedCalcType === "PCT_OF_BASE"
                ? "Harus lebih besar dari Urutan Gaji Pokok."
                : undefined
            }
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" />
            )}
          />
          <FormField
            control={form.control}
            name="isProRated"
            label="Pro-rata (dihitung berdasarkan hari hadir)"
            orientation="horizontal"
            id="salary-component-prorated"
            render={({ field, controlProps }) => (
              <Checkbox
                {...controlProps}
                aria-label="Pro-rata dihitung berdasarkan hari hadir"
                checked={!!field.value}
                onCheckedChange={(c) => field.onChange(!!c)}
                onBlur={field.onBlur}
              />
            )}
          />
        </form>
      </ResponsiveFormDialog>

      {/* Deactivate guard — activation stays single-click (non-destructive) */}
      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        title="Nonaktifkan komponen ini?"
        description={`${confirmTarget?.label ?? ""} tidak akan masuk perhitungan penggajian berikutnya. Bisa diaktifkan kembali kapan saja.`}
        confirmLabel="Ya, Nonaktifkan"
        destructive
        onConfirm={async () => {
          if (!confirmTarget) return;
          const ok = await toggleEnabled(confirmTarget);
          if (!ok) throw new Error("Gagal menonaktifkan komponen gaji");
        }}
      />
    </>
  );
}
