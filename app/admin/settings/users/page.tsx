"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTIVE_STATUS_OPTIONS } from "@/lib/constants/filter-options";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { formatDateShort } from "@/lib/format";
import { toast } from "sonner";
import { getRoleLabel } from "./role-labels";
import { userEditFormSchema } from "@/lib/validations/user";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  customRoleId: string | null;
  customRole: { id: string; name: string; code: string } | null;
};

type RoleOption = {
  id: string;
  name: string;
  code: string;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

// ------------------------------------------------------------------
// Columns
// ------------------------------------------------------------------

function buildColumns(
  onEdit: (user: UserRow) => void,
  onRequestDeactivate: (user: UserRow) => void,
  onRequestActivate: (user: UserRow) => void
): ColumnDef<UserRow>[] {
  return [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Nama" />
      ),
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
              <span className="text-primary text-xs font-bold">
                {(u.name ?? u.email)[0].toUpperCase()}
              </span>
            </div>
            <div>
              <span className="text-sm font-medium">{u.name ?? "—"}</span>
              <p className="text-xs text-muted-foreground">{u.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: "role",
      header: "Peran",
      cell: ({ row }) => (
        <span className="text-sm">{getRoleLabel(row.original)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "lastLoginAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Login Terakhir" />
      ),
      meta: { priority: "low" },
      cell: ({ row }) => {
        const d = row.original.lastLoginAt;
        if (!d) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className="text-xs text-muted-foreground">
            {formatDateShort(d)}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <DataTableRowActions
            onEdit={() => onEdit(u)}
            onDeactivate={
              u.status === "ACTIVE" ? () => onRequestDeactivate(u) : undefined
            }
            onActivate={
              u.status === "INACTIVE" ? () => onRequestActivate(u) : undefined
            }
            isActive={u.status === "ACTIVE"}
          />
        );
      },
    },
  ];
}

// ------------------------------------------------------------------
// Page component
// ------------------------------------------------------------------

export default function UsersPage() {
  const [data, setData] = useState<UserRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Roles for the edit dialog
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const editFormId = useId();
  const editForm = useZodForm(userEditFormSchema, {
    defaultValues: { customRoleId: "none", status: "ACTIVE" },
  });

  // Fetch roles once
  useEffect(() => {
    fetch("/api/roles")
      .then((r) => r.json())
      .then((json) => setRoles(json.data ?? []))
      .catch((err) => console.error("[users] roles fetch failed", err));
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortOrder,
      });
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      if (roleFilter !== "all") params.set("role", roleFilter);

      const res = await fetch(`/api/users?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Terjadi kesalahan");
        return;
      }
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("Gagal memuat data pengguna");
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, status, roleFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handleStatusChange = useCallback((value: string) => {
    setStatus(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handleRoleFilterChange = useCallback((value: string) => {
    setRoleFilter(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setPagination((p) => ({ ...p, page }));
  }, []);

  const handlePageSizeChange = useCallback((pageSize: number) => {
    setPagination((p) => ({ ...p, page: 1, pageSize }));
  }, []);

  const handleSortChange = useCallback(
    (field: string, order: "asc" | "desc") => {
      setSortBy(field);
      setSortOrder(order);
      setPagination((p) => ({ ...p, page: 1 }));
    },
    []
  );

  // Edit dialog
  const openEdit = useCallback((user: UserRow) => {
    setEditTarget(user);
    editForm.reset({
      customRoleId: user.customRoleId ?? "none",
      status: user.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deactivate/activate confirm — a bare dropdown click used to fire the PUT
  // immediately with no confirmation, unlike every sibling settings page
  // (Employees, Campuses, Holidays, Roles). A misclick locked a user out of
  // login with zero warning.
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [activateTarget, setActivateTarget] = useState<UserRow | null>(null);
  const [togglePending, setTogglePending] = useState(false);

  const putStatus = useCallback(
    async (user: UserRow, newStatus: "ACTIVE" | "INACTIVE") => {
      setTogglePending(true);
      try {
        const res = await fetch(`/api/users/${user.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || "Gagal mengubah status");
          return;
        }
        toast.success(
          newStatus === "ACTIVE"
            ? "Pengguna diaktifkan"
            : "Pengguna dinonaktifkan"
        );
        fetchUsers();
      } finally {
        setTogglePending(false);
      }
    },
    [fetchUsers]
  );

  const handleConfirmDeactivate = useCallback(async () => {
    if (!deactivateTarget) return;
    await putStatus(deactivateTarget, "INACTIVE");
    setDeactivateTarget(null);
  }, [deactivateTarget, putStatus]);

  const handleConfirmActivate = useCallback(async () => {
    if (!activateTarget) return;
    await putStatus(activateTarget, "ACTIVE");
    setActivateTarget(null);
  }, [activateTarget, putStatus]);

  const handleSaveEdit = editForm.handleSubmit(async (values) => {
    if (!editTarget) return;
    try {
      await sendJson(
        `/api/users/${editTarget.id}`,
        {
          method: "PUT",
          body: {
            customRoleId: values.customRoleId === "none" ? null : values.customRoleId,
            status: values.status,
          },
        },
        "Gagal menyimpan",
      );
      toast.success("Pengguna diperbarui");
      setEditTarget(null);
      fetchUsers();
    } catch (err) {
      applyServerErrors(editForm, err, "Gagal menyimpan");
    }
  });

  const columns = useMemo(
    () => buildColumns(openEdit, setDeactivateTarget, setActivateTarget),
    [openEdit]
  );

  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Kelola akun admin, guru, dan wali murid serta peran aksesnya"
      />

      <DataTableToolbar
        searchPlaceholder="Cari nama atau email..."
        onSearchChange={handleSearchChange}
        filters={[
          {
            key: "role",
            label: "Peran",
            value: roleFilter,
            onChange: handleRoleFilterChange,
            options: [
              { value: "all", label: "Semua Peran" },
              { value: "SUPER_ADMIN", label: "Super Admin" },
              { value: "SCHOOL_ADMIN", label: "Admin" },
              { value: "TEACHER", label: "Guru" },
              { value: "GUARDIAN", label: "Wali Murid" },
            ],
          },
          {
            key: "status",
            label: "Status",
            value: status,
            onChange: handleStatusChange,
            options: ACTIVE_STATUS_OPTIONS,
          },
        ]}
      />

      <DataTable
        columns={columns}
        data={data}
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onSortChange={handleSortChange}
        defaultSort={{ field: "name", order: "asc" }}
        loading={loading}
        emptyTitle="Belum ada pengguna"
        emptyDescription="Pengguna akan muncul setelah login pertama kali."
      />

      {/* Edit Dialog */}
      <ResponsiveFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title="Edit Pengguna"
        footer={
          <FormDialogFooter
            formId={editFormId}
            pending={editForm.formState.isSubmitting}
            onCancel={() => setEditTarget(null)}
            submitLabel="Simpan Perubahan"
          />
        }
      >
        <form id={editFormId} onSubmit={handleSaveEdit} noValidate className="space-y-field">
          <FormRootError formState={editForm.formState} />
          <div>
            <p className="text-sm font-medium">{editTarget?.name ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {editTarget?.email}
            </p>
          </div>

          <FormField
            control={editForm.control}
            name="customRoleId"
            label="Peran Kustom"
            id="user-role"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && field.onChange(v)}
                items={[{ label: "Tanpa peran kustom", value: "none" }, ...roles.map((r) => ({ label: r.name, value: r.id }))]}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue placeholder="Pilih peran" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tanpa peran kustom</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />

          <FormField
            control={editForm.control}
            name="status"
            label="Status"
            id="user-status"
            render={({ field, controlProps }) => (
              <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Aktif</SelectItem>
                  <SelectItem value="INACTIVE">Tidak Aktif</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </form>
      </ResponsiveFormDialog>

      <DeactivateConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        entityName={deactivateTarget?.name ?? deactivateTarget?.email ?? ""}
        onConfirm={handleConfirmDeactivate}
        pending={togglePending}
      />

      <ConfirmDialog
        open={!!activateTarget}
        onOpenChange={(o) => !o && setActivateTarget(null)}
        title={`Aktifkan "${activateTarget?.name ?? activateTarget?.email ?? ""}"?`}
        description="Pengguna akan kembali masuk daftar aktif dan bisa login lagi."
        confirmLabel="Aktifkan"
        onConfirm={handleConfirmActivate}
        loading={togglePending}
      />
    </>
  );
}
