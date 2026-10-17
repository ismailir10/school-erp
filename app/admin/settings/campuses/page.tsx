"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { ACTIVE_STATUS_OPTIONS } from "@/lib/constants/filter-options";
import { LocateFixed, Plus } from "lucide-react";
import { toast } from "sonner";
import { createCampusSchema } from "@/lib/validations/campus";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

type Campus = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  _count: { employees: number };
};

// The API's `?status=` accepts ACTIVE | INACTIVE | ALL (default ACTIVE) —
// the toolbar filter uses the shared "all" value, translated below.
type StatusFilter = "all" | "ACTIVE" | "INACTIVE";

const EMPTY_FORM = { name: "", address: "", lat: "", lng: "" };

export default function CampusesPage() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Campus | null>(null);
  const formId = useId();
  const form = useZodForm(createCampusSchema, { defaultValues: EMPTY_FORM });
  const [deleteTarget, setDeleteTarget] = useState<Campus | null>(null);
  // FIND-004: surface deactivated campuses via an explicit filter so the
  // admin can reactivate them without dropping into SQL.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [query, setQuery] = useState("");

  const fetchCampuses = useCallback(async (filter: StatusFilter) => {
    setLoading(true);
    const param = filter === "all" ? "ALL" : filter;
    const res = await fetch(`/api/config/campuses?status=${param}`);
    setCampuses(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchCampuses(statusFilter); }, [fetchCampuses, statusFilter]);

  const handleReactivate = useCallback(
    async (c: Campus) => {
      const res = await fetch(`/api/config/campuses/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      });
      if (res.ok) {
        toast.success("Kampus diaktifkan kembali");
        fetchCampuses(statusFilter);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Gagal mengaktifkan kampus. Coba lagi.");
      }
    },
    [fetchCampuses, statusFilter],
  );

  const openNew = useCallback(() => {
    setEditing(null);
    form.reset(EMPTY_FORM);
    setDialogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = useCallback((c: Campus) => {
    setEditing(c);
    form.reset({
      name: c.name,
      address: c.address ?? "",
      lat: c.lat?.toString() ?? "",
      lng: c.lng?.toString() ?? "",
    });
    setDialogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = form.handleSubmit(async (values) => {
    try {
      await sendJson(
        editing ? `/api/config/campuses/${editing.id}` : "/api/config/campuses",
        {
          method: editing ? "PUT" : "POST",
          // The form drops blank optionals (undefined -> key omitted). PUT only
          // writes keys it receives, so an edit must send explicit nulls for
          // the fields the admin blanked, or they could never be cleared.
          body: editing
            ? { ...values, address: values.address ?? null, lat: values.lat ?? null, lng: values.lng ?? null }
            : values,
        },
        "Gagal menyimpan kampus. Periksa kolom yang ditandai.",
      );
      toast.success(editing ? "Kampus diperbarui" : "Kampus ditambahkan");
      setDialogOpen(false);
      fetchCampuses(statusFilter);
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan kampus. Periksa kolom yang ditandai.");
    }
  });

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/config/campuses/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Kampus dinonaktifkan");
      setDeleteTarget(null);
      fetchCampuses(statusFilter);
    } else {
      const data = await res.json();
      toast.error(data.error || "Gagal menonaktifkan kampus. Coba lagi.");
    }
  }

  function getCurrentLocation() {
    if (!navigator.geolocation) { toast.error("GPS tidak tersedia di perangkat ini. Isi koordinat manual."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.setValue("lat", pos.coords.latitude.toFixed(8), { shouldDirty: true, shouldValidate: true });
        form.setValue("lng", pos.coords.longitude.toFixed(8), { shouldDirty: true, shouldValidate: true });
        toast.success("Lokasi diperoleh");
      },
      () => toast.error("Gagal mendapatkan lokasi. Izinkan akses lokasi atau isi koordinat manual.")
    );
  }

  const filteredCampuses = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return campuses;
    return campuses.filter((c) =>
      [c.name, c.address ?? ""].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [campuses, query]);

  const columns = useMemo<ColumnDef<Campus>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nama" />,
        cell: ({ row }) => (
          <div className="min-w-0 whitespace-normal">
            <span className="text-sm font-medium">{row.original.name}</span>
            <p className="text-xs text-muted-foreground">
              {row.original._count.employees} karyawan
            </p>
          </div>
        ),
      },
      {
        accessorKey: "address",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Alamat" />,
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.address || "—"}</span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const c = row.original;
          const isActive = c.status === "ACTIVE";
          return (
            <DataTableRowActions
              rowLabel={c.name}
              onEdit={isActive ? () => openEdit(c) : undefined}
              onDeactivate={isActive ? () => setDeleteTarget(c) : undefined}
              onActivate={!isActive ? () => handleReactivate(c) : undefined}
              isActive={isActive}
            />
          );
        },
      },
    ],
    [openEdit, handleReactivate],
  );

  return (
    <>
      <PageHeader
        title="Kampus"
        description="Kelola lokasi kampus/cabang sekolah"
        actions={
          <Button onClick={openNew} size="sm">
            <Plus size={16} className="mr-1.5" /> Tambah Kampus
          </Button>
        }
      />

      <DataTableToolbar
        value={query}
        onValueChange={setQuery}
        searchPlaceholder="Cari nama atau alamat..."
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            onChange: (v) => setStatusFilter(v as StatusFilter),
            resetValue: "ACTIVE",
            options: ACTIVE_STATUS_OPTIONS,
          },
        ]}
      />

      <DataTable
        columns={columns}
        data={filteredCampuses}
        loading={loading}
        defaultSort={{ field: "name", order: "asc" }}
        emptyTitle={statusFilter === "INACTIVE" ? "Tidak ada kampus nonaktif" : "Belum ada kampus"}
        emptyDescription={
          statusFilter === "INACTIVE"
            ? "Semua kampus saat ini aktif."
            : "Tambahkan lokasi kampus/cabang untuk mulai mengelola karyawan per kampus."
        }
        // Same as the header's "Tambah Kampus" — no permission gate on this
        // page, so the empty-state CTA mirrors it unconditionally. Only
        // offered on the ACTIVE/default view; "Tidak ada kampus nonaktif"
        // isn't a place to create a new (active) campus from.
        emptyAction={statusFilter !== "INACTIVE" ? { label: "Tambah Kampus", onClick: openNew } : undefined}
      />

      {/* Add/Edit Dialog */}
      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit Kampus" : "Tambah Kampus"}
        description={editing ? "Perbarui informasi kampus" : "Tambahkan lokasi kampus baru"}
        footer={
          <FormDialogFooter
            formId={formId}
            pending={form.formState.isSubmitting}
            onCancel={() => setDialogOpen(false)}
            submitLabel={editing ? "Simpan Perubahan" : "Tambah Kampus"}
          />
        }
      >
        <form id={formId} onSubmit={handleSave} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          <FormField
            control={form.control}
            name="name"
            label="Nama"
            required
            id="campus-name"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} placeholder="Taman Aster" />
            )}
          />
          <FormField
            control={form.control}
            name="address"
            label="Alamat"
            id="campus-address"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Jl. Contoh No.1, Bekasi" />
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="lat"
              label="Latitude"
              id="campus-lat"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | number | undefined) ?? ""} placeholder="-6.2234" type="number" step="any" />
              )}
            />
            <FormField
              control={form.control}
              name="lng"
              label="Longitude"
              id="campus-lng"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | number | undefined) ?? ""} placeholder="106.8432" type="number" step="any" />
              )}
            />
          </div>
          <Button variant="outline" size="sm" onClick={getCurrentLocation} type="button">
            <LocateFixed size={14} className="mr-1.5" /> Ambil Lokasi Saat Ini
          </Button>
        </form>
      </ResponsiveFormDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Nonaktifkan Kampus"
        description={`Nonaktifkan "${deleteTarget?.name}"? Kampus akan disembunyikan dari daftar tetapi data historis tetap utuh. Kampus dengan karyawan aktif tidak bisa dinonaktifkan.`}
        onConfirm={handleDelete}
        confirmLabel="Nonaktifkan"
        destructive
      />
    </>
  );
}
