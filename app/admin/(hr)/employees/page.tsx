"use client";

import { UserAvatar } from "@/components/ui/user-avatar";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Control } from "react-hook-form";
import type * as z4 from "zod/v4/core";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "sonner";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { ACTIVE_STATUS_OPTIONS } from "@/lib/constants/filter-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Plus, Users, UserCheck, UserX } from "lucide-react";
import { DISPLAY_TIME_ZONE, formatDateShort } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { createEmployeeSchema } from "@/lib/validations/employee";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type Employee = {
  id: string;
  kode: string;
  nama: string;
  email: string;
  jabatan: string;
  status: string;
  campusId: string;
  bankAccountNo: string | null;
  bpjsEnrolled: boolean;
  createdAt: string;
  campus: { name: string };
};

type Campus = { id: string; name: string };

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

// ------------------------------------------------------------------
// Columns
// ------------------------------------------------------------------

const columns: ColumnDef<Employee>[] = [
  {
    accessorKey: "nama",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Nama" />
    ),
    cell: ({ row }) => {
      const e = row.original;
      return (
        <div className="flex items-center gap-3">
          <UserAvatar name={e.nama} size="sm" className="shrink-0" />
          <DataTableLinkCell
            href={`/admin/employees/${e.id}`}
            className="min-w-0 whitespace-normal"
            description={
              <>
                <span className="hidden md:inline">{e.email}</span>
                <DataTableMobileMeta>
                  <span className="font-currency">{e.kode}</span>
                  <span>{e.jabatan}</span>
                  <StatusBadge status={e.status} />
                </DataTableMobileMeta>
              </>
            }
          >
            {e.nama}
            {/* Code sits under the name below `md` (DataTableMobileMeta). The
                link is inline-flex, so a plain space collapses — margin keeps the gap. */}
            <span className="ml-2 hidden font-currency text-xs text-muted-foreground md:inline">{e.kode}</span>
          </DataTableLinkCell>
        </div>
      );
    },
  },
  {
    accessorKey: "jabatan",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Jabatan" />
    ),
    // Position sits under the name below `md` (DataTableMobileMeta above).
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-sm">{row.original.jabatan}</span>
    ),
  },
  {
    id: "campus",
    header: "Kampus",
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-sm">{row.original.campus.name}</span>
    ),
  },
  {
    id: "bank",
    header: "Rekening",
    meta: { priority: "low" },
    cell: ({ row }) => {
      if (!row.original.bankAccountNo) {
        return <StatusBadge status="UNFILLED" />;
      }
      return (
        <span className="text-xs text-muted-foreground font-currency">
          ••• {row.original.bankAccountNo.slice(-4)}
        </span>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Dibuat" />
    ),
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {formatDateShort(row.original.createdAt)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    // Status sits under the name below `md` (DataTableMobileMeta above).
    meta: { priority: "low" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
];

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

const INDONESIAN_BANKS = ["Bank BSI", "BRI", "BCA", "Bank Mandiri", "BNI", "CIMB Niaga", "BJB", "Bank Muamalat", "Bank Mega", "Bank Permata", "Lainnya"];

// F-26: `role` controls the auto-created User row. `TEACHER` is the legacy
// default; `SCHOOL_ADMIN` covers non-teaching staff (admin/finance/etc).
const EMPTY_CREATE_FORM = {
  nama: "", formalName: "", email: "", noHp: "",
  jabatan: "", campusId: "", hireDate: "",
  bankName: "Bank BSI", bankAccountNo: "", bpjsEnrolled: false,
  // Saldo cuti awal — blank falls back to the schema default (12 / 14).
  leaveBalanceAnnual: "", leaveBalanceSick: "",
  role: "TEACHER" as "TEACHER" | "SCHOOL_ADMIN",
};

export default function EmployeesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Employee[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [campusFilter, setCampusFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0 });
  const [deactivateTarget, setDeactivateTarget] = useState<Employee | null>(null);
  // F-18: restore confirmation target. Symmetrical to deactivate — uses
  // the dedicated POST /restore endpoint, which is idempotent and audited.
  const [restoreTarget, setRestoreTarget] = useState<Employee | null>(null);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const formId = useId();
  const form = useZodForm(createEmployeeSchema, { defaultValues: EMPTY_CREATE_FORM });
  const [customPosition, setCustomPosition] = useState(false);

  const openCreate = useCallback(() => {
    form.reset(EMPTY_CREATE_FORM);
    setCustomPosition(false);
    setCreateOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open dialog when arriving via ?create=1 (from dashboard quick-action).
  useEffect(() => {
    if (searchParams?.get("create") === "1") {
      openCreate();
      router.replace("/admin/employees");
    }
  }, [searchParams, openCreate, router]);

  const handleCreate = form.handleSubmit(async (values) => {
    try {
      const emp = await sendJson<{ id: string; kode: string }>(
        "/api/employees",
        { method: "POST", body: values },
        "Gagal menambahkan",
      );
      toast.success(`Karyawan ditambahkan (Kode: ${emp.kode})`);
      setCreateOpen(false);
      router.push(`/admin/employees/${emp.id}`);
    } catch (err) {
      applyServerErrors(form, err, "Gagal menambahkan");
    }
  });

  // F-6 collapse: single /api/employees/stats endpoint replaces the two
  // pageSize=1 filtered list calls. Also re-run after deactivate / restore
  // (HR-13) — the cards used to keep the mount-time counts until a reload.
  const fetchStats = useCallback(() => {
    fetch("/api/employees/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) =>
        setStats({
          total: s.total ?? 0,
          active: s.active ?? 0,
          inactive: s.inactive ?? 0,
        }),
      )
      .catch(() => toast.error("Gagal memuat ringkasan karyawan"));
  }, []);

  // Fetch campuses + positions + stats once
  useEffect(() => {
    fetch("/api/config/campuses")
      .then((r) => r.json())
      .then((c) => setCampuses(Array.isArray(c) ? c : []))
      .catch(() => toast.error("Gagal memuat daftar kampus"));
    fetch("/api/employees/positions")
      .then((r) => r.json())
      .then((p) => {
        const arr = Array.isArray(p) ? p : [];
        // FIND-007: on a fresh tenant `Employee` has zero rows so the
        // `distinct jabatan` query returns []. The Karyawan create dialog
        // then offered only "+ Tambah jabatan baru" with no presets, which
        // looked broken even though inline-add worked. Lazy-bootstrap a
        // sensible default list so the first admin sees actionable options
        // immediately. Custom values they add still flow through the inline
        // path and become real `Employee.jabatan` strings.
        const DEFAULT_POSITIONS = ["Guru Kelas", "Guru Pendamping", "Kepala Sekolah", "Admin Sekolah"];
        setPositions(arr.length === 0 ? DEFAULT_POSITIONS : arr);
      })
      .catch(() => toast.error("Gagal memuat daftar jabatan"));
    fetchStats();
  }, [fetchStats]);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortOrder,
      });
      if (search) params.set("search", search);
      if (campusFilter !== "all") params.set("campusId", campusFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/employees?${params}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("Gagal memuat data karyawan");
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, campusFilter, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setPagination((p) => ({ ...p, page }));
  }, []);

  const handlePageSizeChange = useCallback((pageSize: number) => {
    setPagination((p) => ({ ...p, page: 1, pageSize }));
  }, []);

  const handleSortChange = useCallback((field: string, order: "asc" | "desc") => {
    setSortBy(field);
    setSortOrder(order);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handleDeactivate = useCallback(async () => {
    if (!deactivateTarget) return;
    const res = await fetch(`/api/employees/${deactivateTarget.id}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      toast.success(`${deactivateTarget.nama} dinonaktifkan`);
      setDeactivateTarget(null);
      fetchEmployees();
      fetchStats();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal menonaktifkan karyawan");
    }
  }, [deactivateTarget, fetchEmployees, fetchStats]);

  const handleRestore = useCallback(async () => {
    if (!restoreTarget) return;
    const res = await fetch(`/api/employees/${restoreTarget.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      toast.success(`${restoreTarget.nama} diaktifkan kembali`);
      setRestoreTarget(null);
      fetchEmployees();
      fetchStats();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal mengaktifkan karyawan");
    }
  }, [restoreTarget, fetchEmployees, fetchStats]);

  const columnsWithActions = useMemo<ColumnDef<Employee>[]>(
    () => [
      ...columns,
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <DataTableRowActions
            onEdit={() => router.push(`/admin/employees/${row.original.id}`)}
            onDeactivate={
              row.original.status === "ACTIVE"
                ? () => setDeactivateTarget(row.original)
                : undefined
            }
            // F-18: restore (Aktifkan) shown when employee is INACTIVE.
            // Calls the dedicated POST /restore endpoint added in Task 8.
            onActivate={
              row.original.status === "INACTIVE"
                ? () => setRestoreTarget(row.original)
                : undefined
            }
            isActive={row.original.status === "ACTIVE"}
          />
        ),
      },
    ],
    [router],
  );

  // Build campus filter options dynamically
  const campusOptions = [
    { value: "all", label: "Semua Kampus" },
    ...campuses.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <>
      <PageHeader
        title="Karyawan"
        description="Data karyawan dan akun staf sekolah"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1.5" /> Tambah
          </Button>
        }
      />

      {/* Stats */}
      <StatsCardsRow cols={3}>
        <StatCard label="Total Karyawan" value={stats.total} icon={Users} color="primary" index={0} />
        <StatCard label="Aktif" value={stats.active} icon={UserCheck} color="success" index={1} />
        <StatCard label="Tidak Aktif" value={stats.inactive} icon={UserX} color="error" index={2} />
      </StatsCardsRow>

      <DataTableToolbar
        searchPlaceholder="Cari nama, kode, atau email..."
        onSearchChange={handleSearchChange}
        filters={[
          {
            key: "campus",
            label: "Kampus",
            value: campusFilter,
            onChange: (v) => {
              setCampusFilter(v);
              setPagination((p) => ({ ...p, page: 1 }));
            },
            options: campusOptions,
          },
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            onChange: (v) => {
              setStatusFilter(v);
              setPagination((p) => ({ ...p, page: 1 }));
            },
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
        defaultSort={{ field: "createdAt", order: "desc" }}
        loading={loading}
        emptyTitle="Belum ada karyawan"
        emptyDescription="Tambahkan karyawan baru untuk memulai."
      />

      <DeactivateConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        entityName={deactivateTarget?.nama ?? ""}
        onConfirm={handleDeactivate}
      />

      {/* F-18: restore confirm — non-destructive, simple ConfirmDialog */}
      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title={`Aktifkan "${restoreTarget?.nama ?? ""}"?`}
        description="Karyawan akan kembali masuk daftar aktif dan bisa login lagi."
        confirmLabel="Aktifkan"
        onConfirm={handleRestore}
      />

      {/* Create Employee */}
      <ResponsiveFormDialog
        open={createOpen}
        onOpenChange={(o) => { setCreateOpen(o); if (!o) { form.reset(EMPTY_CREATE_FORM); setCustomPosition(false); } }}
        title="Tambah Karyawan"
        description="Kode karyawan akan digenerate otomatis."
        size="2xl"
        footer={
          <FormDialogFooter
            formId={formId}
            pending={form.formState.isSubmitting}
            onCancel={() => setCreateOpen(false)}
            submitLabel="Tambah Karyawan"
          />
        }
      >
        <form id={formId} onSubmit={handleCreate} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          <CreateEmployeeFormBody
            control={form.control}
            positions={positions}
            campuses={campuses}
            customPosition={customPosition}
            setCustomPosition={setCustomPosition}
          />
        </form>
      </ResponsiveFormDialog>
    </>
  );
}

type CreateEmployeeFormValues = z4.input<typeof createEmployeeSchema>;
type CreateEmployeeFormOutput = z4.output<typeof createEmployeeSchema>;

function CreateEmployeeFormBody({
  control,
  positions,
  campuses,
  customPosition,
  setCustomPosition,
}: {
  control: Control<CreateEmployeeFormValues, unknown, CreateEmployeeFormOutput>;
  positions: string[];
  campuses: Campus[];
  customPosition: boolean;
  setCustomPosition: (v: boolean) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-field">
        <FormField
          control={control}
          name="nama"
          label="Nama"
          required
          id="employee-nama"
          className="col-span-2 sm:col-span-1"
          render={({ field, controlProps }) => <Input {...field} {...controlProps} />}
        />
        <FormField
          control={control}
          name="formalName"
          label="Nama Formal"
          id="employee-formal-name"
          className="col-span-2 sm:col-span-1"
          render={({ field, controlProps }) => <Input {...field} {...controlProps} value={field.value ?? ""} />}
        />
      </div>
      <div className="grid grid-cols-2 gap-field">
        <FormField
          control={control}
          name="email"
          label="Email"
          required
          id="employee-email"
          render={({ field, controlProps }) => <Input {...field} {...controlProps} type="email" />}
        />
        <FormField
          control={control}
          name="noHp"
          label="No. HP"
          id="employee-phone"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={field.value ?? ""} placeholder="081234567890" />
          )}
        />
      </div>
      <div className="grid grid-cols-2 gap-field">
        <FormField
          control={control}
          name="jabatan"
          label="Jabatan"
          required
          id="employee-position"
          render={({ field, controlProps }) =>
            customPosition ? (
              <div className="flex gap-2">
                <Input {...field} {...controlProps} placeholder="Jabatan baru..." autoFocus />
                <Button type="button" variant="outline" size="sm" onClick={() => setCustomPosition(false)} className="shrink-0">Batal</Button>
              </div>
            ) : (
              <Select
                value={field.value}
                onValueChange={(v) => {
                  if (v === "__custom__") { setCustomPosition(true); field.onChange(""); }
                  else if (v != null) field.onChange(v);
                }}
                items={{ ...Object.fromEntries(positions.map((p) => [p, p])), __custom__: "+ Tambah jabatan baru" }}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih jabatan" /></SelectTrigger>
                <SelectContent>
                  {positions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  <SelectItem value="__custom__">+ Tambah jabatan baru</SelectItem>
                </SelectContent>
              </Select>
            )
          }
        />
        <FormField
          control={control}
          name="campusId"
          label="Kampus"
          required
          id="employee-campus"
          render={({ field, controlProps }) => (
            <Select
              value={field.value}
              onValueChange={(v) => v != null && field.onChange(v)}
              items={campuses.map((c) => ({ label: c.name, value: c.id }))}
            >
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih kampus" /></SelectTrigger>
              <SelectContent>
                {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <div className="grid grid-cols-2 gap-field">
        <FormField
          control={control}
          name="hireDate"
          label="Tanggal Masuk"
          required
          id="employee-hire-date"
          render={({ field, controlProps }) => (
            <DatePicker {...controlProps} value={field.value} onChange={field.onChange} required max={getTodayInTimezone(DISPLAY_TIME_ZONE)} />
          )}
        />
        <FormField
          control={control}
          name="role"
          label="Peran Akun"
          required
          id="employee-role"
          render={({ field, controlProps }) => (
            <Select
              value={field.value}
              onValueChange={(v) => v != null && field.onChange(v)}
              items={{ TEACHER: "Guru", SCHOOL_ADMIN: "Admin Sekolah" }}
            >
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih peran" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TEACHER">Guru</SelectItem>
                <SelectItem value="SCHOOL_ADMIN">Admin Sekolah</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <div className="grid grid-cols-2 gap-field">
        <FormField
          control={control}
          name="bankName"
          label="Bank"
          id="employee-bank"
          render={({ field, controlProps }) => (
            <Select value={field.value ?? ""} onValueChange={(v) => v != null && field.onChange(v)}>
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
              <SelectContent>
                {INDONESIAN_BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <FormField
        control={control}
        name="bankAccountNo"
        label="No. Rekening"
        id="employee-bank-account"
        render={({ field, controlProps }) => <Input {...field} {...controlProps} value={field.value ?? ""} />}
      />
      <div className="grid grid-cols-2 gap-field">
        <FormField
          control={control}
          name="leaveBalanceAnnual"
          label="Saldo Cuti Tahunan"
          id="employee-annual-leave"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" min={0} max={365} placeholder="12" />
          )}
        />
        <FormField
          control={control}
          name="leaveBalanceSick"
          label="Saldo Cuti Sakit"
          id="employee-sick-leave"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" min={0} max={365} placeholder="14" />
          )}
        />
      </div>
      <FormField
        control={control}
        name="bpjsEnrolled"
        label="BPJS Terdaftar"
        orientation="horizontal"
        id="employee-bpjs"
        render={({ field, controlProps }) => (
          <Checkbox {...controlProps} checked={!!field.value} onCheckedChange={(c) => field.onChange(!!c)} onBlur={field.onBlur} />
        )}
      />
    </>
  );
}
