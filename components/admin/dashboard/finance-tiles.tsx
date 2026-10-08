import Link from "next/link";
import { DashboardRetry } from "@/components/admin/dashboard/admin-work-queue";
import { formatRupiah } from "@/lib/format";
import type { ReceivablesSummary } from "@/lib/dashboard/receivables";

export type FinanceTilesData =
  | ({ status: "ready" } & ReceivablesSummary)
  | { status: "unavailable" };

const tileClass =
  "flex flex-wrap items-baseline gap-x-2 rounded-lg border px-card py-3 outline-none transition-shadow hover:shadow-sm hover:ring-1 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Cash position on the front page: invoices past due and total piutang
 * (unpaid balance). Both open the invoice list; the overdue card pre-filters it.
 */
export function FinanceTiles({ data }: { data: FinanceTilesData }) {
  if (data.status === "unavailable") {
    return (
      <div data-testid="dashboard-finance-tiles" className="flex flex-wrap items-center gap-3 rounded-lg border p-card">
        <p className="text-body text-muted-foreground">Ringkasan tagihan belum dapat dimuat.</p>
        <DashboardRetry />
      </div>
    );
  }

  return (
    <div data-testid="dashboard-finance-tiles" className="grid grid-cols-2 gap-3">
      <Link
        href="/admin/invoices?status=OVERDUE"
        aria-label={`${data.overdueCount} tagihan lewat tempo`}
        className={tileClass}
      >
        <p className="font-currency text-xl font-bold tabular-nums">{data.overdueCount}</p>
        <p className="text-small text-muted-foreground">Tagihan lewat tempo</p>
      </Link>
      <Link
        href="/admin/invoices"
        aria-label={`Total piutang ${formatRupiah(data.receivable)}`}
        className={tileClass}
      >
        <p className="font-currency text-xl font-bold tabular-nums">{formatRupiah(data.receivable)}</p>
        <p className="text-small text-muted-foreground">Piutang (belum dibayar)</p>
      </Link>
    </div>
  );
}
