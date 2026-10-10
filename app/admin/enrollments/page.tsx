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
import { FileText, Send, CheckCircle2, Wallet, MessageCircle } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusChip } from "./status-chip";
import { formatDateShort, formatRupiah } from "@/lib/format";

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
  /** Pendaftaran fee; null when the program has none. */
  fee: { status: "UNPAID" | "PAID" | "WAIVED"; amount: number } | null;
  /** Only for editors, only while UNPAID: whether a WhatsApp number exists. */
  followUp: { canRemind: boolean } | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/**
 * Pembayaran column: the fee's status and amount, and for an unpaid row one tap
 * to WhatsApp the parent. The link is the reminder ENDPOINT, not a wa.me URL:
 * it builds the message (which carries the parent's form link) when pressed,
 * so no list response ever holds an access token.
 */
function PaymentCell({ row }: { row: Row }) {
  if (!row.fee) return <span className="text-sm text-muted-foreground">Tanpa biaya</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge status={row.fee.status} />
        {row.fee.status !== "WAIVED" && (
          <span className="text-xs tabular-nums text-muted-foreground">{formatRupiah(row.fee.amount)}</span>
        )}
      </div>
      {row.followUp &&
        (row.followUp.canRemind ? (
          <a
            href={`/api/enrollments/${row.id}/fee/reminder`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Ingatkan lewat WhatsApp: ${row.childName || "anak ini"}`}
            className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary-text underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(pointer:coarse)]:min-h-11"
          >
            <MessageCircle className="size-3.5" aria-hidden="true" />
            Ingatkan lewat WhatsApp
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">Belum ada nomor WhatsApp</span>
        ))}
    </div>
  );
}

export default function EnrollmentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>("all");
  const [payment, setPayment] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, submitted: 0, accepted: 0, unpaid: 0 });

  // Counts by status for the stat cards. Reuses the existing paginated
  // /api/enrollments endpoint (pageSize=1, status filter) rather than adding
  // a dedicated counts API — same pattern as /admin/admissions' fetchStats.
  const fetchStats = useCallback(() => {
    Promise.all([
      fetch("/api/enrollments?pageSize=1").then((r) => r.json()),
      fetch("/api/enrollments?pageSize=1&status=SUBMITTED").then((r) => r.json()),
      fetch("/api/enrollments?pageSize=1&status=ACCEPTED").then((r) => r.json()),
      fetch("/api/enrollments?pageSize=1&payment=unpaid").then((r) => r.json()),
    ])
      .then(([all, submitted, accepted, unpaid]) => {
        setStats({
          total: all.pagination?.total ?? 0,
          submitted: submitted.pagination?.total ?? 0,
          accepted: accepted.pagination?.total ?? 0,
          unpaid: unpaid.pagination?.total ?? 0,
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
      if (payment !== "all") params.set("payment", payment);
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
  }, [pagination.page, pagination.pageSize, search, status, payment]);

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
        id: "payment",
        header: "Pembayaran",
        cell: ({ row }) => <PaymentCell row={row.original} />,
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
        <StatsCardsRow cols={4}>
          <StatCard label="Total Formulir" value={stats.total} icon={FileText} color="primary" index={0} />
          <StatCard label="Terkirim" value={stats.submitted} icon={Send} color="warning" index={1} />
          <StatCard label="Diterima" value={stats.accepted} icon={CheckCircle2} color="success" index={2} />
          <StatCard label="Belum bayar" value={stats.unpaid} icon={Wallet} color="warning" index={3} />
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
            {
              key: "payment",
              label: "Pembayaran",
              value: payment,
              onChange: (value) => {
                setPayment(value);
                setPagination((current) => ({ ...current, page: 1 }));
              },
              options: [
                { value: "all", label: "Semua Pembayaran" },
                { value: "unpaid", label: "Belum bayar" },
                { value: "paid", label: "Lunas" },
                { value: "waived", label: "Dibebaskan" },
                { value: "none", label: "Tanpa biaya" },
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
