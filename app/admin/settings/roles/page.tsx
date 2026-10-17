"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Plus, Shield, ShieldCheck, Lock } from "lucide-react";
import { PERMISSION_GROUPS, getSystemRolePermissions, ALL_PERMISSIONS } from "@/lib/permissions";
import { toast } from "sonner";
import { roleFormSchema } from "@/lib/validations/role";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type RoleRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isSystem: boolean;
  permissions: string; // JSON string
  _count: { users: number };
};

// ------------------------------------------------------------------
// System role cards
// ------------------------------------------------------------------

const SYSTEM_ROLES = [
  {
    role: "SUPER_ADMIN",
    name: "Super Admin",
    description: "Akses penuh termasuk SDM, gaji, dan data karyawan",
    icon: ShieldCheck,
    color: "text-primary" as const,
  },
  {
    role: "SCHOOL_ADMIN",
    name: "Admin Sekolah",
    description: "Akses penuh kecuali modul SDM (karyawan, gaji, cuti, kehadiran)",
    icon: ShieldCheck,
    color: "text-primary" as const,
  },
  {
    role: "TEACHER",
    name: "Guru",
    description: "Akses kehadiran dan data siswa di kelas yang diajar",
    icon: Shield,
    color: "text-success" as const,
  },
  {
    role: "GUARDIAN",
    name: "Wali Murid",
    description: "Akses data anak, tagihan, kehadiran, dan rapor",
    icon: Shield,
    color: "text-warning" as const,
  },
];

function SystemRoleCards() {
  return (
    <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
      {SYSTEM_ROLES.map((sr) => {
        const perms = getSystemRolePermissions(sr.role);
        return (
          <div
            key={sr.role}
            className="bg-card border border-border rounded-xl p-5"
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                <sr.icon size={20} className={sr.color} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{sr.name}</h3>
                  <Badge variant="secondary" className="text-xs">
                    <Lock size={10} className="mr-1" />
                    Bawaan
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sr.description}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {perms.length === ALL_PERMISSIONS.length
                ? "Semua izin"
                : `${perms.length} izin`}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// Permission Checkboxes
// ------------------------------------------------------------------

function PermissionCheckboxes({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (perms: string[]) => void;
}) {
  const toggle = (code: string) => {
    if (selected.includes(code)) {
      onChange(selected.filter((p) => p !== code));
    } else {
      onChange([...selected, code]);
    }
  };

  const toggleGroup = (groupPerms: string[]) => {
    const allSelected = groupPerms.every((p) => selected.includes(p));
    if (allSelected) {
      onChange(selected.filter((p) => !groupPerms.includes(p)));
    } else {
      const newPerms = new Set([...selected, ...groupPerms]);
      onChange(Array.from(newPerms));
    }
  };

  return (
    <div className="space-y-5 max-h-80 overflow-y-auto pr-2">
      {Object.entries(PERMISSION_GROUPS).map(([key, group]) => {
        const groupPerms = Object.keys(group.permissions);
        const allSelected = groupPerms.every((p) => selected.includes(p));
        const someSelected =
          !allSelected && groupPerms.some((p) => selected.includes(p));

        return (
          <div key={key}>
            <div className="flex items-center gap-2 mb-2">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={() => toggleGroup(groupPerms)}
              />
              <span className="text-sm font-semibold">{group.label}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 ml-6">
              {Object.entries(group.permissions).map(([code, label]) => (
                <label
                  key={code}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Checkbox
                    checked={selected.includes(code)}
                    onCheckedChange={() => toggle(code)}
                  />
                  <span className="text-xs">{label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// Columns for custom roles
// ------------------------------------------------------------------

function buildColumns(
  onEdit: (role: RoleRow) => void,
  onDelete: (role: RoleRow) => void
): ColumnDef<RoleRow>[] {
  return [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Nama" />
      ),
      cell: ({ row }) => (
        <div className="min-w-0 whitespace-normal">
          <span className="text-sm font-medium">{row.original.name}</span>
          {row.original.description && (
            <p className="text-xs text-muted-foreground">
              {row.original.description}
            </p>
          )}
          <DataTableMobileMeta className="mt-1">
            <span className="font-mono">{row.original.code}</span>
            <span>{safeParsePermissions(row.original.permissions).length} izin</span>
          </DataTableMobileMeta>
        </div>
      ),
    },
    {
      accessorKey: "code",
      header: "Kode",
      meta: { priority: "low" },
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs font-mono">
          {row.original.code}
        </Badge>
      ),
    },
    {
      id: "permCount",
      header: "Jumlah Izin",
      meta: { priority: "low" },
      cell: ({ row }) => {
        const perms = safeParsePermissions(row.original.permissions);
        return <span className="text-sm">{perms.length}</span>;
      },
    },
    {
      id: "userCount",
      header: "Pengguna",
      cell: ({ row }) => (
        <span className="text-sm">{row.original._count.users}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DataTableRowActions
          onEdit={() => onEdit(row.original)}
          extraActions={[
            {
              label: "Hapus",
              destructive: true,
              onClick: () => onDelete(row.original),
            },
          ]}
        />
      ),
    },
  ];
}

function safeParsePermissions(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const EMPTY_ROLE_FORM = { name: "", code: "", description: "", permissions: [] as string[] };

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RoleRow | null>(null);
  const formId = useId();
  const form = useZodForm(roleFormSchema, { defaultValues: EMPTY_ROLE_FORM });

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/roles");
      if (!res.ok) {
        toast.error("Gagal memuat peran. Coba lagi sebentar.");
        return;
      }
      const json = await res.json();
      setRoles(json.data ?? []);
    } catch {
      toast.error("Gagal memuat peran. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  // Separate system and custom roles
  const customRoles = useMemo(
    () => roles.filter((r) => !r.isSystem),
    [roles]
  );

  const filteredCustomRoles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customRoles;
    return customRoles.filter((r) => r.name.toLowerCase().includes(needle));
  }, [customRoles, query]);

  // Open create dialog
  const openCreate = useCallback(() => {
    setEditTarget(null);
    form.reset(EMPTY_ROLE_FORM);
    setDialogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open edit dialog
  const openEdit = useCallback((role: RoleRow) => {
    setEditTarget(role);
    form.reset({
      name: role.name,
      code: role.code,
      description: role.description ?? "",
      permissions: safeParsePermissions(role.permissions),
    });
    setDialogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save (create or update)
  const handleSave = form.handleSubmit(async (values) => {
    const fallback = "Gagal menyimpan peran. Periksa kolom yang ditandai.";
    try {
      const url = editTarget ? `/api/roles/${editTarget.id}` : "/api/roles";
      const method = editTarget ? "PUT" : "POST";
      const body = editTarget
        ? { name: values.name, description: values.description, permissions: values.permissions }
        : { name: values.name, code: values.code, description: values.description, permissions: values.permissions };

      await sendJson(url, { method, body }, fallback);
      toast.success(editTarget ? "Peran diperbarui" : "Peran dibuat");
      setDialogOpen(false);
      fetchRoles();
    } catch (err) {
      applyServerErrors(form, err, fallback);
    }
  });

  // Delete
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/roles/${deleteTarget.id}`,
        { method: "DELETE" },
      ).catch((error) => {
        toast.error("Gagal menghapus peran. Periksa koneksi lalu coba lagi.");
        throw error;
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err.error || "Gagal menghapus peran. Coba lagi.";
        toast.error(message);
        throw new Error(message);
      }
      toast.success("Peran dihapus");
      setDeleteTarget(null);
      fetchRoles();
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, fetchRoles]);

  const columns = useMemo(
    () => buildColumns(openEdit, (role) => setDeleteTarget(role)),
    [openEdit]
  );

  // Dummy pagination for DataTable (client-side since custom roles will be few)
  const pagination = useMemo(
    () => ({
      page: 1,
      pageSize: 50,
      total: filteredCustomRoles.length,
      totalPages: 1,
    }),
    [filteredCustomRoles.length]
  );

  return (
    <>
      <PageHeader
        title="Peran & Izin"
        description="Kelola peran dan izin akses pengguna"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1.5" /> Tambah Peran
          </Button>
        }
      />

      {/* System Roles */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Peran Bawaan
      </h2>
      <SystemRoleCards />

      {/* Custom Roles */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Peran Kustom
      </h2>
      <DataTableToolbar
        value={query}
        onValueChange={setQuery}
        searchPlaceholder="Cari nama peran..."
      />
      <DataTable
        columns={columns}
        data={filteredCustomRoles}
        pagination={pagination}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        onSortChange={() => {}}
        defaultSort={{ field: "name", order: "asc" }}
        loading={loading}
        emptyTitle="Belum ada peran kustom"
        emptyDescription="Buat peran kustom untuk mengatur izin akses yang lebih spesifik."
      />

      {/* Create/Edit Dialog */}
      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editTarget ? "Edit Peran" : "Tambah Peran"}
        footer={
          <FormDialogFooter
            formId={formId}
            pending={form.formState.isSubmitting}
            onCancel={() => setDialogOpen(false)}
            submitLabel={editTarget ? "Simpan Perubahan" : "Tambah Peran"}
          />
        }
      >
        <form id={formId} onSubmit={handleSave} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          <FormField
            control={form.control}
            name="name"
            label="Nama Peran"
            required
            id="role-name"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} placeholder="Contoh: Admin Keuangan" />
            )}
          />

          <FormField
            control={form.control}
            name="code"
            label="Kode"
            required
            id="role-code"
            description="Huruf kapital, angka, dan underscore. Tidak bisa diubah setelah dibuat."
            render={({ field, controlProps }) => (
              <Input
                {...field}
                {...controlProps}
                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                placeholder="Contoh: FINANCE_ADMIN"
                disabled={!!editTarget}
              />
            )}
          />

          <FormField
            control={form.control}
            name="description"
            label="Deskripsi"
            id="role-description"
            render={({ field, controlProps }) => (
              <Textarea
                {...field}
                {...controlProps}
                value={field.value ?? ""}
                placeholder="Deskripsi singkat peran ini..."
                rows={2}
              />
            )}
          />

          <FormField
            control={form.control}
            name="permissions"
            label="Izin Akses"
            id="role-permissions"
            render={({ field }) => (
              <PermissionCheckboxes
                selected={field.value ?? []}
                onChange={field.onChange}
              />
            )}
          />
        </form>
      </ResponsiveFormDialog>

      {/* Delete confirm */}
      <DeactivateConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        entityName={deleteTarget?.name ?? ""}
        action="delete"
        extraWarning={
          deleteTarget && deleteTarget._count.users > 0
            ? `Peran ini dipakai oleh ${deleteTarget._count.users} pengguna dan menghapusnya akan melepas izin akses mereka.`
            : undefined
        }
        onConfirm={handleDelete}
        pending={deleting}
      />
    </>
  );
}
