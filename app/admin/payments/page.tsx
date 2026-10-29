"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { toast } from "sonner";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { formatRupiah } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { PAYMENT_METHODS, paymentMethodLabel } from "@/lib/constants/payment-methods";
import { Wallet, Receipt, Download, AlertCircle, RefreshCw } from "lucide-react";

type LedgerRow = {
  id: string;
  invoiceId: string;
  paidAt: string;
  amount: number;
  method: string;
  methodLabel: string;
  reference: string | null;
  invoiceNumber: string;
  studentName: string;
};

type Summary = {
  totalAmount: number;
  totalCount: number;
  byMethod: { method: string; methodLabel: string; amount: number; count: number }[];
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function formatJakartaDateTime(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function PaymentsLedgerPage() {
  const today = getTodayInTimezone("Asia/Jakarta");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [method, setMethod] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalAmount: 0, totalCount: 0, byMethod: [] });
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [sortBy, setSortBy] = useState("paidAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const buildParams = useCallback((includePaging = true) => {
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (method !== "all") params.set("method", method);
    if (search.trim()) params.set("search", search.trim());
    params.set("sortBy", sortBy);
    params.set("sortOrder", sortOrder);
    if (includePaging) {
      params.set("page", String(pagination.page));
      params.set("pageSize", String(pagination.pageSize));
    }
    return params;
  }, [dateFrom, dateTo, method, pagination.page, pagination.pageSize, search, sortBy, sortOrder]);

  const fetchLedger = useCallback(
    async (signal: { cancelled: boolean }) => {
      setLoading(true);
      setFetchError(false);
      try {
        const res = await fetch(`/api/payments?${buildParams()}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new ApiError(err.error || "Gagal memuat penerimaan");
        }
        const json = await res.json();
        if (!signal.cancelled) {
          setRows(json.data ?? []);
          setSummary(json.summary ?? { totalAmount: 0, totalCount: 0, byMethod: [] });
          if (json.pagination) setPagination(json.pagination);
        }
      } catch (e) {
        if (!signal.cancelled) {
          setRows([]);
          setSummary({ totalAmount: 0, totalCount: 0, byMethod: [] });
          setPagination((p) => ({ ...p, total: 0, totalPages: 1 }));
          setFetchError(true);
          toast.error(userMessage(e, "Gagal memuat penerimaan"));
        }
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    },
    [buildParams],
  );

  useEffect(() => {
    if (!dateFrom || !dateTo) return;
    const signal = { cancelled: false };
    fetchLedger(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [dateFrom, dateTo, fetchLedger]);

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handleMethodChange = useCallback((value: string) => {
    setMethod(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handleSortChange = useCallback((field: string, order: "asc" | "desc") => {
    if (field !== "paidAt" && field !== "amount") return;
    setSortBy(field);
    setSortOrder(order);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const columns = useMemo<ColumnDef<LedgerRow>[]>(
    () => [
      {
        accessorKey: "paidAt",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tanggal" />,
        // The date follows the student's name below `md` (FIN-21).
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap">{formatJakartaDateTime(row.original.paidAt)}</span>
        ),
      },
      {
        id: "student",
        accessorFn: (row) => row.studentName,
        header: "Siswa",
        cell: ({ row }) => (
          <DataTableLinkCell
            href={`/admin/invoices/${row.original.invoiceId}`}
            className="whitespace-normal"
            description={
              <>
                {row.original.invoiceNumber}
                <DataTableMobileMeta className="mt-0.5">
                  <span>{`${formatJakartaDateTime(row.original.paidAt)} · ${row.original.methodLabel}`}</span>
                </DataTableMobileMeta>
              </>
            }
          >
            {row.original.studentName}
          </DataTableLinkCell>
        ),
      },
      {
        accessorKey: "methodLabel",
        header: "Metode",
        meta: { priority: "low" },
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">{row.original.methodLabel}</Badge>
        ),
      },
      {
        accessorKey: "reference",
        header: "Referensi",
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.reference ?? "—"}</span>
        ),
      },
      {
        accessorKey: "amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Jumlah" />,
        cell: ({ row }) => (
          <span className="text-sm font-medium tabular-nums">{formatRupiah(row.original.amount)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Penerimaan"
        description="Pembayaran masuk per rentang tanggal — rekap kas harian dan bulanan."
      />

      <StatsCardsRow cols={2}>
        <StatCard
          label="Total Penerimaan"
          value={formatRupiah(summary.totalAmount)}
          icon={Wallet}
          color="success"
          index={0}
        />
        <StatCard
          label="Jumlah Transaksi"
          value={summary.totalCount}
          icon={Receipt}
          color="primary"
          index={1}
        />
      </StatsCardsRow>

      {summary.byMethod.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {summary.byMethod.map((m) => (
            <Badge key={m.method} variant="secondary" className="text-xs font-normal">
              {m.methodLabel}: {formatRupiah(m.amount)} ({m.count})
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <label htmlFor="payments-date-from" className="text-xs text-muted-foreground whitespace-nowrap">Dari</label>
          <DatePicker
            id="payments-date-from"
            max={dateTo || undefined}
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="h-9 w-40 text-base md:text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="payments-date-to" className="text-xs text-muted-foreground whitespace-nowrap">Sampai</label>
          <DatePicker
            id="payments-date-to"
            min={dateFrom || undefined}
            value={dateTo}
            onChange={(v) => {
              setDateTo(v);
              setPagination((p) => ({ ...p, page: 1 }));
            }}
            className="h-9 w-40 text-base md:text-sm"
          />
        </div>
      </div>

      <DataTableToolbar
        value={search}
        onValueChange={handleSearchChange}
        searchPlaceholder="Cari siswa, tagihan, referensi..."
        filters={[
          {
            key: "method",
            label: "Metode",
            value: method,
            onChange: handleMethodChange,
            options: [
              { value: "all", label: "Semua Metode" },
              ...PAYMENT_METHODS.map((m) => ({ value: m, label: paymentMethodLabel(m) })),
            ],
          },
        ]}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={loading || summary.totalCount === 0}
            onClick={() => window.open(`/api/payments/export?${buildParams(false)}`, "_blank")}
          >
            <Download size={14} className="mr-1" /> Ekspor CSV
          </Button>
        }
      />

      {fetchError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive-subtle p-6 flex items-start gap-3">
          <AlertCircle className="size-5 shrink-0 text-destructive mt-0.5" />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-sm font-semibold text-foreground">Gagal memuat penerimaan</p>
            <p className="text-sm text-muted-foreground">Coba lagi sebentar. Jika tetap gagal, hubungi tim teknis.</p>
            <Button size="sm" variant="outline" onClick={() => fetchLedger({ cancelled: false })}>
              <RefreshCw size={14} className="mr-1.5" /> Coba lagi
            </Button>
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          pagination={pagination}
          onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
          onPageSizeChange={(pageSize) => setPagination((p) => ({ ...p, page: 1, pageSize }))}
          onSortChange={handleSortChange}
          defaultSort={{ field: "paidAt", order: "desc" }}
          loading={loading}
          emptyTitle="Belum ada penerimaan"
          emptyDescription="Pembayaran yang tercatat pada rentang tanggal ini akan tampil di sini. Coba ubah rentang atau filter metode."
        />
      )}
    </>
  );
}
