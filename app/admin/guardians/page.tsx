"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { Control } from "react-hook-form";
import type * as z4 from "zod/v4/core";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { ACTIVE_STATUS_OPTIONS } from "@/lib/constants/filter-options";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormRootError } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Users, UserCheck, UserX } from "lucide-react";
import { GuardianFormBody, type GuardianFieldValues } from "@/components/admin/guardian-edit-dialog";
import { parentFormSchema } from "@/lib/validations/parent";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

type ParentFormValues = z4.input<typeof parentFormSchema>;

const EMPTY_PARENT_FORM: ParentFormValues = {
  name: "",
  phone: "",
  email: "",
  whatsapp: "",
  address: "",
  parentNik: "",
  education: "",
  occupation: "",
  employer: "",
  employerAddress: "",
  employerCity: "",
  incomeRange: "",
  childrenTotal: "",
};

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type Guardian = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  status: string;
  _count: { guardians: number };
  guardians: { student: { id: string; name: string } }[];
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

const columns: ColumnDef<Guardian>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Nama" />,
    cell: ({ row }) => (
      <span className="text-sm font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "phone",
    header: "Telepon",
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.phone || "—"}</span>
    ),
  },
  {
    accessorKey: "email",
    header: "Email",
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.email || "—"}</span>
    ),
  },
  {
    id: "students",
    header: "Siswa",
    cell: ({ row }) => {
      const total = row.original._count.guardians;
      // The API sends the first two children by name; the count stays
      // authoritative. Naming them lets an admin recognise the family without
      // opening the row.
      const names = (row.original.guardians ?? []).map((g) => g.student.name);
      if (total === 0) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <div className="text-sm">
          <span>{total} siswa</span>
          {names.length > 0 && (
            <span className="text-xs text-muted-foreground ml-1.5">
              {names.join(", ")}
              {total > names.length ? ` +${total - names.length}` : ""}
            </span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
];

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function GuardiansPage() {
  const [data, setData] = useState<Guardian[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0 });

  const [editTarget, setEditTarget] = useState<Guardian | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Guardian | null>(null);
  const editFormId = useId();
  const editForm = useZodForm(parentFormSchema, { defaultValues: EMPTY_PARENT_FORM });

  // Stats — re-fetched after any mutation (edit / status toggle) so the
  // cards don't go stale.
  const fetchStats = useCallback(() => {
    return Promise.all([
      fetch("/api/guardians?pageSize=1").then(r => r.json()),
      fetch("/api/guardians?pageSize=1&status=ACTIVE").then(r => r.json()),
      fetch("/api/guardians?pageSize=1&status=INACTIVE").then(r => r.json()),
    ]).then(([all, active, inactive]) => {
      setStats({
        total: all.pagination?.total ?? 0,
        active: active.pagination?.total ?? 0,
        inactive: inactive.pagination?.total ?? 0,
      });
    }).catch(() => toast.error("Gagal memuat data"));
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const fetchGuardians = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pagination.page), pageSize: String(pagination.pageSize), sortBy, sortOrder });
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/guardians?${params}`);
      if (!res.ok) { toast.error("Gagal memuat data wali"); return; }
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("Gagal memuat data wali");
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, status, sortBy, sortOrder]);

  useEffect(() => { fetchGuardians(); }, [fetchGuardians]);

  const handleSearchChange = useCallback((value: string) => { setSearch(value); setPagination(p => ({ ...p, page: 1 })); }, []);
  const handleStatusChange = useCallback((value: string) => { setStatus(value); setPagination(p => ({ ...p, page: 1 })); }, []);
  const handlePageChange = useCallback((page: number) => { setPagination(p => ({ ...p, page })); }, []);
  const handlePageSizeChange = useCallback((pageSize: number) => { setPagination(p => ({ ...p, page: 1, pageSize })); }, []);
  const handleSortChange = useCallback((field: string, order: "asc" | "desc") => { setSortBy(field); setSortOrder(order); setPagination(p => ({ ...p, page: 1 })); }, []);

  async function openEditDialog(g: Guardian) {
    setEditTarget(g);
    editForm.reset({
      ...EMPTY_PARENT_FORM,
      name: g.name,
      email: g.email || "",
      phone: g.phone || "",
      whatsapp: g.whatsapp || "",
    });
    try {
      const res = await fetch(`/api/parents/${g.id}`);
      if (res.ok) {
        const parent = await res.json();
        editForm.reset({
          ...EMPTY_PARENT_FORM,
          name: parent.name || g.name,
          email: parent.email || "",
          phone: parent.phone || "",
          whatsapp: parent.whatsapp || "",
          address: parent.address || "",
          parentNik: parent.nik || "",
          education: parent.education || "",
          occupation: parent.occupation || "",
          employer: parent.employer || "",
          employerAddress: parent.employerAddress || "",
          employerCity: parent.employerCity || "",
          incomeRange: parent.incomeRange || "",
          childrenTotal: parent.childrenTotal != null ? String(parent.childrenTotal) : "",
        });
      }
    } catch { /* use basic fields from list */ }
  }

  // /admin/guardians is a Parent-list page despite its URL; mutations go to
  // /api/parents/[id]. The /api/guardians/[id] tree edits StudentGuardian
  // junction rows (used from the Student detail page).
  const handleEditSave = editForm.handleSubmit(async (values) => {
    if (!editTarget) return;
    try {
      await sendJson(`/api/parents/${editTarget.id}`, { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("Data wali diperbarui");
      setEditTarget(null);
      fetchGuardians();
      fetchStats();
    } catch (err) {
      applyServerErrors(editForm, err, "Gagal menyimpan");
    }
  });

  async function handleStatusToggle() {
    if (!deactivateTarget) return;
    const newStatus = deactivateTarget.status === "INACTIVE" ? "ACTIVE" : "INACTIVE";
    const res = await fetch(`/api/parents/${deactivateTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); toast.error(e.error || "Gagal mengubah status"); return; }
    toast.success(newStatus === "ACTIVE" ? "Wali diaktifkan" : "Wali dinonaktifkan");
    setDeactivateTarget(null);
    fetchGuardians();
    fetchStats();
  }

  const columnsWithActions = useMemo<ColumnDef<Guardian>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nama" />,
        cell: ({ row }) => (
          <DataTableLinkCell href={`/admin/guardians/${row.original.id}`}>
            {row.original.name}
          </DataTableLinkCell>
        ),
      },
      ...columns.slice(1),
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const g = row.original;
          return (
            <DataTableRowActions
              rowLabel={g.name}
              onEdit={() => openEditDialog(g)}
              onDeactivate={g.status !== "INACTIVE" ? () => setDeactivateTarget(g) : undefined}
              onActivate={g.status === "INACTIVE" ? () => setDeactivateTarget(g) : undefined}
              isActive={g.status !== "INACTIVE"}
            />
          );
        },
      },
    ],
    // Intentionally []: the columns must keep one identity or every row cell
    // remounts and closes its open action menu. openEditDialog only calls state setters,
    // `editForm.reset` and `toast`, all stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (loading && data.length === 0) return <Skeleton className="h-96 rounded-xl" />;

  return (
    <>
      <PageHeader title="Wali Murid" description="Kelola data wali murid dan hubungannya dengan siswa." />

      <StatsCardsRow cols={3}>
        <StatCard label="Total Wali" value={stats.total} icon={Users} color="primary" index={0} />
        <StatCard label="Aktif" value={stats.active} icon={UserCheck} color="success" index={1} />
        <StatCard label="Tidak Aktif" value={stats.inactive} icon={UserX} color="warning" index={2} />
      </StatsCardsRow>

      <DataTableToolbar
        searchPlaceholder="Cari nama, email, atau telepon..."
        onSearchChange={handleSearchChange}
        filters={[
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
        columns={columnsWithActions}
        data={data}
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onSortChange={handleSortChange}
        defaultSort={{ field: "name", order: "asc" }}
        loading={loading}
        emptyTitle="Belum ada wali terdaftar"
        emptyDescription="Wali murid akan otomatis muncul saat mendaftarkan siswa."
      />

      {/* Edit */}
      <ResponsiveFormDialog
        open={!!editTarget}
        onOpenChange={(o) => { if (!editForm.formState.isSubmitting && !o) setEditTarget(null); }}
        title="Edit Wali"
        size="xl"
        footer={
          <FormDialogFooter
            formId={editFormId}
            pending={editForm.formState.isSubmitting}
            onCancel={() => setEditTarget(null)}
            submitLabel="Simpan Perubahan"
          />
        }
      >
        <form id={editFormId} onSubmit={handleEditSave} noValidate className="space-y-field">
          <FormRootError formState={editForm.formState} />
          {/* Boundary cast: `parentFormSchema`'s parsed values don't line up
              1:1 with `GuardianFieldValues` field-by-field (e.g. its
              preprocessed `email`/`childrenTotal` are typed `unknown`, not
              optional), which RHF's `Control` can't unify generically —
              see the identical cast inside GuardianFormBody itself. */}
          <GuardianFormBody
            control={editForm.control as unknown as Control<GuardianFieldValues, unknown, GuardianFieldValues>}
            showRelationship={false}
          />
        </form>
      </ResponsiveFormDialog>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        title={deactivateTarget?.status === "INACTIVE" ? "Aktifkan Wali" : "Nonaktifkan Wali"}
        description={deactivateTarget?.status === "INACTIVE" ? `"${deactivateTarget?.name}" akan muncul kembali di daftar wali aktif.` : `"${deactivateTarget?.name}" tidak akan muncul di daftar aktif. Bisa diaktifkan kembali kapan saja.`}
        confirmLabel={deactivateTarget?.status === "INACTIVE" ? "Aktifkan" : "Nonaktifkan"}
        onConfirm={handleStatusToggle}
        destructive={deactivateTarget?.status !== "INACTIVE"}
      />
    </>
  );
}
