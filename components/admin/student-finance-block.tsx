"use client";

import { memo } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRupiah, formatDateShort, formatInvoicePeriod } from "@/lib/format";
import type { StudentInvoiceSummary } from "@/lib/finance/student-invoice-summary";
import type { InvoiceStatusGroup } from "@/lib/student/overview";
import { getStatusConfig } from "@/components/ui/status-badge";

/**
 * Keuangan block of the student dossier — read-only. Every write to an invoice
 * still belongs to the Tagihan module, so each row deep-links to
 * `/admin/invoices/[id]` rather than growing an edit affordance here.
 *
 * Presentational: the page owns the fetch, because the rail's Tunggakan tile
 * reads the same summary and must not wait on a section being opened.
 */

export type StudentInvoiceRow = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string;
  status: string;
  totalDue: number | string;
  totalPaid: number | string;
};

function SummaryFigure({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "outstanding";
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          tone === "outstanding"
            ? "mt-1 font-currency text-base font-bold tabular-nums text-destructive"
            : "mt-1 font-currency text-base font-semibold tabular-nums"
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Per-status split from the aggregate route (increment 3). The four figures
 * above it are totals; this is where the totals came from — "2 lewat tempo"
 * next to "6 lunas" is the shape of the problem, which a single Sisa Tagihan
 * number does not carry.
 *
 * Zero-count buckets are dropped, so a family with only paid invoices gets one
 * chip rather than a row of noughts.
 */
function StatusBreakdown({ groups }: { groups: InvoiceStatusGroup[] }) {
  const shown = groups.filter((g) => g.count > 0);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {shown.map((g) => (
        <li key={g.status} className="whitespace-nowrap">
          <span className="font-medium text-foreground">{g.count}</span>{" "}
          {getStatusConfig(g.status).label.toLowerCase()}
          {g.balance > 0 && (
            <span className="font-currency tabular-nums"> · {formatRupiah(g.balance)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export const StudentFinanceBlock = memo(function StudentFinanceBlock({
  invoices,
  summary,
  statusGroups,
  loading,
  error,
  forbidden,
  onRetry,
}: {
  invoices: StudentInvoiceRow[];
  summary: StudentInvoiceSummary;
  /** From `GET /api/students/[id]/overview`; null until it lands or on failure. */
  statusGroups: InvoiceStatusGroup[] | null;
  loading: boolean;
  error: boolean;
  forbidden: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (forbidden) {
    return <p className="text-sm text-muted-foreground">Anda tidak memiliki akses ke data tagihan.</p>;
  }

  // Fetch error contract: say what failed and offer the retry, never render an
  // empty state — "Belum ada tagihan" for a family that has ten is worse than
  // any error message.
  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Gagal memuat data tagihan.</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md text-sm text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  // Foot of the block, not a header action: at 390px a header link plus the
  // "N belum lunas" badge squeezed the section title down to "Keuan…".
  // Keringanan puts its module link in the same place.
  const invoicesLink = (
    <Link href="/admin/invoices" className="text-sm text-primary-text hover:underline">
      Buka modul Tagihan →
    </Link>
  );

  if (invoices.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          title="Belum ada tagihan"
          description="Tagihan siswa ini akan muncul di sini setelah dibuat di modul Tagihan."
        />
        <div className="text-center">{invoicesLink}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryFigure label="Total Ditagih" value={formatRupiah(summary.totalBilled)} />
        <SummaryFigure label="Sudah Dibayar" value={formatRupiah(summary.totalPaid)} />
        <SummaryFigure
          label="Sisa Tagihan"
          value={formatRupiah(summary.outstanding)}
          tone={summary.outstanding > 0 ? "outstanding" : undefined}
          hint={
            summary.nearestDue ? `Jatuh tempo ${formatDateShort(summary.nearestDue)}` : undefined
          }
        />
        <SummaryFigure
          label="Belum Lunas"
          value={String(summary.unpaidCount)}
          hint={summary.overdueCount > 0 ? `${summary.overdueCount} lewat tempo` : undefined}
        />
      </div>

      {statusGroups && <StatusBreakdown groups={statusGroups} />}

      <ul className="space-y-0">
        {invoices.map((inv) => {
          const due = Number(inv.totalDue) || 0;
          const paid = Number(inv.totalPaid) || 0;
          return (
            <li key={inv.id} className="border-b border-border/50 last:border-0">
              <Link
                href={`/admin/invoices/${inv.id}`}
                className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {formatInvoicePeriod(inv.periodLabel)}
                  </p>
                  <p className="mt-0.5 truncate font-currency text-xs text-muted-foreground">
                    {inv.invoiceNumber} · jatuh tempo {formatDateShort(inv.dueDate)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="font-currency text-sm font-medium tabular-nums">
                      {formatRupiah(due)}
                    </p>
                    {paid > 0 && paid < due && (
                      <p className="font-currency text-xs text-muted-foreground tabular-nums">
                        dibayar {formatRupiah(paid)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {invoicesLink}
    </div>
  );
});
