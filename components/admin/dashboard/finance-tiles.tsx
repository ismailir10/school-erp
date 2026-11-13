import { DashboardRetry } from "@/components/admin/dashboard/admin-work-queue";
import { AlertTriangle, Wallet } from "lucide-react";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { StatTile } from "@/components/ui/stat-tile";
import { formatRupiah } from "@/lib/format";
import type { ReceivablesSummary } from "@/lib/dashboard/receivables";

export type FinanceTilesData =
  | ({ status: "ready" } & ReceivablesSummary)
  | { status: "unavailable" };

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
    <StatsCardsRow data-testid="dashboard-finance-tiles" cols={2} className="mb-0">
      <StatTile
        href="/admin/invoices?status=OVERDUE"
        ariaLabel={`${data.overdueCount} tagihan lewat tempo`}
        label="Tagihan lewat tempo"
        value={data.overdueCount}
        icon={AlertTriangle}
        tone={data.overdueCount > 0 ? "critical" : "default"}
        mono
      />
      <StatTile
        href="/admin/invoices"
        ariaLabel={`Total piutang ${formatRupiah(data.receivable)}`}
        label="Piutang (belum dibayar)"
        value={formatRupiah(data.receivable)}
        icon={Wallet}
        mono
      />
    </StatsCardsRow>
  );
}
