"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { AdminLinkTabs } from "@/components/admin/admin-tabs";
import { FileText, Send, CheckCircle2 } from "lucide-react";
import { StatusChip } from "./status-chip";
import { formatDateShort } from "@/lib/format";

type Row = {
  id: string;
  childName: string;
  parentEmail: string | null;
  status: string;
  dcareAddon: boolean;
  submittedAt: string | null;
  createdAt: string;
  studentId: string | null;
  program: { name: string } | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export default function EnrollmentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, submitted: 0, accepted: 0 });

  // Counts by status for the stat cards. Reuses the existing paginated
  // /api/enrollments endpoint (pageSize=1, status filter) rather than adding
  // a dedicated counts API — same pattern as /admin/admissions' fetchStats.
  const fetchStats = useCallback(() => {
    Promise.all([
      fetch("/api/enrollments?pageSize=1").then((r) => r.json()),
      fetch("/api/enrollments?pageSize=1&status=SUBMITTED").then((r) => r.json()),
      fetch("/api/enrollments?pageSize=1&status=ACCEPTED").then((r) => r.json()),
    ])
      .then(([all, submitted, accepted]) => {
        setStats({
          total: all.pagination?.total ?? 0,
          submitted: submitted.pagination?.total ?? 0,
          accepted: accepted.pagination?.total ?? 0,
        });
      })
      .catch((err) => console.error("[enrollments] stats fetch failed", err));
  }, []);
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      if (status !== "all") params.set("status", status);
      if (search) params.set("search", search);
      try {
        const res = await fetch(`/api/enrollments?${params}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        setRows(json.data ?? []);
        if (json.pagination) setPagination(json.pagination);
      } catch {
        if (!controller.signal.aborted) {
          toast.error("Gagal memuat formulir pendaftaran. Coba lagi.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [pagination.page, pagination.pageSize, search, status]);

  const columns: ColumnDef<Row>[] = useMemo(
    () => [
      {
        accessorKey: "childName",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nama Anak" />,
        cell: ({ row }) =>
          row.original.childName ? (
            <DataTableLinkCell href={`/admin/enrollments/${row.original.id}`}>
              {row.original.childName}
            </DataTableLinkCell>
          ) : (
            <span className="font-medium">—</span>
          ),
      },
      {
        id: "program",
        header: "Program",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.program?.name ?? "—"}
            {row.original.dcareAddon ? " + Dcare" : ""}
          </span>
        ),
      },
      {
        accessorKey: "parentEmail",
        header: "Email Orang Tua",
        meta: { priority: "low" },
        cell: ({ row }) => <span className="text-sm">{row.original.parentEmail ?? "—"}</span>,
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusChip status={row.original.status} studentId={row.original.studentId} />,
      },
      {
        id: "submitted",
        header: "Dikirim",
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.submittedAt ? formatDateShort(row.original.submittedAt) : "—"}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Pendaftaran"
        description="Formulir pendaftaran yang dikirim wali."
      />

      <AdminLinkTabs
        items={[
          { href: "/admin/admissions", label: "Calon Siswa" },
          { href: "/admin/enrollments", label: "Formulir" },
        ]}
      />

      <div className="space-y-section">
        <StatsCardsRow cols={3}>
          <StatCard label="Total Formulir" value={stats.total} icon={FileText} color="primary" index={0} />
          <StatCard label="Terkirim" value={stats.submitted} icon={Send} color="warning" index={1} />
          <StatCard label="Diterima" value={stats.accepted} icon={CheckCircle2} color="success" index={2} />
        </StatsCardsRow>

        <DataTableToolbar
          value={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPagination((current) => ({ ...current, page: 1 }));
          }}
          searchPlaceholder="Cari nama anak atau email orang tua..."
          filters={[
            {
              key: "status",
              label: "Status",
              value: status,
              onChange: (value) => {
                setStatus(value);
                setPagination((current) => ({ ...current, page: 1 }));
              },
              options: [
                { value: "all", label: "Semua Status" },
                { value: "SUBMITTED", label: "Terkirim" },
                { value: "UNDER_REVIEW", label: "Ditinjau" },
                { value: "ACCEPTED", label: "Diterima" },
                { value: "REJECTED", label: "Ditolak" },
                { value: "INVITED", label: "Diundang" },
              ],
            },
          ]}
        />
        <DataTable
          columns={columns}
          data={rows}
          pagination={pagination}
          onPageChange={(page) => setPagination((current) => ({ ...current, page }))}
          onPageSizeChange={(pageSize) => setPagination((current) => ({ ...current, page: 1, pageSize }))}
          loading={loading}
          emptyTitle="Belum ada formulir masuk"
          emptyDescription="Formulir yang dikirim orang tua akan muncul di sini."
        />
      </div>
    </>
  );
}
