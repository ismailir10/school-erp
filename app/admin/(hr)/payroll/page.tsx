"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "sonner";
import { PayrollGenerateBlockersAlert, type GenerateBlockers } from "@/components/admin/payroll/generate-blockers";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Plus, Banknote, FileCheck, Clock, Send } from "lucide-react";
import { generatePayrollSchema } from "@/lib/validations/payroll";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { ApiError } from "@/lib/api/client-errors";
import type { Control } from "react-hook-form";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type PayrollRun = {
  id: string;
  periodStart: string;
  periodEnd: string;
  actualWorkDays: number;
  status: string;
  approvedAt: string | null;
  _count: { items: number };
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type PayrollStats = { total: number; draft: number; approved: number; slipsSent: number };

// ------------------------------------------------------------------
// Columns
// ------------------------------------------------------------------

const columns: ColumnDef<PayrollRun>[] = [
  {
    id: "period",
    accessorKey: "periodStart",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Periode" />
    ),
    cell: ({ row }) => {
      const run = row.original;
      return (
        <DataTableLinkCell href={`/admin/payroll/${run.id}`}>
          {run.periodStart} — {run.periodEnd}
        </DataTableLinkCell>
      );
    },
  },
  {
    id: "employees",
    header: "Karyawan",
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-sm">{row.original._count.items} orang</span>
    ),
  },
  {
    accessorKey: "actualWorkDays",
    header: "Hari Kerja",
    meta: { priority: "low" },
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.actualWorkDays} hari</span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
];

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

function defaultPayrollPeriod() {
  const now = new Date();
  const endMonth = now.getMonth();
  const endYear = now.getFullYear();
  const startMonth = endMonth === 0 ? 11 : endMonth - 1;
  const startYear = endMonth === 0 ? endYear - 1 : endYear;
  return {
    periodStart: `${startYear}-${String(startMonth + 1).padStart(2, "0")}-21`,
    periodEnd: `${endYear}-${String(endMonth + 1).padStart(2, "0")}-20`,
  };
}

export default function PayrollListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<PayrollRun[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const createFormId = useId();
  const [blockers, setBlockers] = useState<GenerateBlockers | null>(null);
  const createForm = useZodForm(generatePayrollSchema, { defaultValues: defaultPayrollPeriod() });

  const openCreate = useCallback(() => {
    createForm.reset(defaultPayrollPeriod());
    setBlockers(null);
    setCreateOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open dialog when arriving via ?create=1 (from dashboard quick-action).
  useEffect(() => {
    if (searchParams?.get("create") === "1") {
      openCreate();
      router.replace("/admin/payroll");
    }
  }, [searchParams, openCreate, router]);

  const handleGenerate = createForm.handleSubmit(async (values) => {
    const fallback = "Draf penggajian belum bisa dibuat. Coba lagi sebentar.";
    setBlockers(null);
    try {
      const res = await fetch("/api/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        const d = await res.json();
        toast.success("Draf penggajian dibuat");
        setCreateOpen(false);
        router.push(`/admin/payroll/${d.id}`);
        return;
      }
      const d = await res.json().catch(() => ({}));
      // 422 with an `employees` array (missing Rekening / salary structure /
      // negative net): a domain-shaped error the standard `{ error, errors[] }`
      // envelope doesn't carry. Keep it on screen inside the dialog, with a link
      // per employee, instead of a toast that vanishes (HR-3).
      if (res.status === 422 && Array.isArray(d.employees) && d.employees.length > 0) {
        setBlockers({ error: String(d.error ?? fallback), employees: d.employees });
        return;
      }
      applyServerErrors(createForm, new ApiError(d.error || fallback, { status: res.status }), fallback);
    } catch (err) {
      applyServerErrors(createForm, err, fallback);
    }
  });

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("periodStart");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [stats, setStats] = useState<PayrollStats | null>(null);
  const [statsStatus, setStatsStatus] = useState<"loading" | "ready" | "error">("loading");

  const loadStats = useCallback(async () => {
    setStatsStatus("loading");
    try {
      const res = await fetch("/api/payroll/stats");
      if (!res.ok) throw new Error("Payroll stats unavailable");
      const data = (await res.json()) as PayrollStats;
      if (![data.total, data.draft, data.approved, data.slipsSent].every(
        (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
      )) throw new Error("Invalid payroll stats");
      setStats(data);
      setStatsStatus("ready");
    } catch {
      setStats(null);
      setStatsStatus("error");
    }
  }, []);

  // Stats use one groupBy endpoint; retry is available without reloading the table.
  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortOrder,
      });
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/payroll?${params}`);
      const json = await res.json();
      setData(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      toast.error("Data penggajian belum bisa dimuat. Coba lagi sebentar.");
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

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

  return (
    <>
      <PageHeader
        title="Penggajian"
        description="Kelola periode penggajian dan slip gaji karyawan"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1.5" /> Buat Penggajian
          </Button>
        }
      />

      {statsStatus === "error" && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <span>Ringkasan penggajian tidak bisa dimuat.</span>
          <Button variant="outline" size="sm" onClick={() => void loadStats()}>Coba lagi</Button>
        </div>
      )}
      <StatsCardsRow>
        <StatCard label="Total Penggajian" value={statsStatus === "ready" ? stats!.total : statsStatus === "loading" ? "…" : "—"} icon={Banknote} color="primary" index={0} />
        <StatCard label="Draf" value={statsStatus === "ready" ? stats!.draft : statsStatus === "loading" ? "…" : "—"} icon={Clock} color="warning" index={1} />
        <StatCard label="Disetujui" value={statsStatus === "ready" ? stats!.approved : statsStatus === "loading" ? "…" : "—"} icon={FileCheck} color="success" index={2} />
        <StatCard label="Slip Terkirim" value={statsStatus === "ready" ? stats!.slipsSent : statsStatus === "loading" ? "…" : "—"} icon={Send} color="primary" index={3} />
      </StatsCardsRow>

      <DataTableToolbar
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            onChange: (v) => {
              setStatusFilter(v);
              setPagination((p) => ({ ...p, page: 1 }));
            },
            options: [
              { value: "all", label: "Semua Status" },
              { value: "DRAFT", label: "Draf" },
              { value: "APPROVED", label: "Disetujui" },
              // F-22: `EXPORTED` removed — no code path produces this status.
              { value: "SLIPS_SENT", label: "Slip Terkirim" },
            ],
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
        defaultSort={{ field: "periodStart", order: "desc" }}
        loading={loading}
        emptyTitle="Belum ada penggajian"
        emptyDescription="Mulai dengan membuat penggajian baru."
      />

      {/* Create Payroll */}
      <ResponsiveFormDialog
        open={createOpen}
        onOpenChange={(o) => { setCreateOpen(o); if (!o) { createForm.reset(defaultPayrollPeriod()); setBlockers(null); } }}
        title="Buat Penggajian Baru"
        size="lg"
        footer={
          <FormDialogFooter
            formId={createFormId}
            pending={createForm.formState.isSubmitting}
            onCancel={() => setCreateOpen(false)}
            submitLabel="Buat Draf Penggajian"
            pendingLabel="Memproses..."
          />
        }
      >
        <form id={createFormId} onSubmit={handleGenerate} noValidate className="space-y-field">
          <FormRootError formState={createForm.formState} />
          {blockers && <PayrollGenerateBlockersAlert blockers={blockers} />}
          <PayrollPeriodBody control={createForm.control} />
        </form>
      </ResponsiveFormDialog>
    </>
  );
}

type PayrollPeriodFormValues = { periodStart: string; periodEnd: string };

function PayrollPeriodBody({
  control,
}: {
  control: Control<PayrollPeriodFormValues, unknown, PayrollPeriodFormValues>;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="periodStart"
          label="Tanggal Mulai"
          id="payroll-run-period-start"
          render={({ field, controlProps }) => (
            <DatePicker {...controlProps} value={field.value} onChange={field.onChange} />
          )}
        />
        <FormField
          control={control}
          name="periodEnd"
          label="Tanggal Selesai"
          id="payroll-run-period-end"
          render={({ field, controlProps }) => (
            <DatePicker {...controlProps} value={field.value} onChange={field.onChange} />
          )}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Sistem akan menghitung hari kerja aktual, kehadiran per karyawan, dan semua komponen gaji.
      </p>
    </>
  );
}
