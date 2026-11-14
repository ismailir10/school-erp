import { DashboardRetry } from "@/components/admin/dashboard/admin-work-queue";
import { CalendarClock, FileText, LinkIcon, MessageCircle, Wallet } from "lucide-react";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { StatTile } from "@/components/ui/stat-tile";
import type { QueueSummaryItem } from "@/lib/dashboard/admin-work-queue";

const tileLabel: Record<QueueSummaryItem["kind"], string> = {
  inquiry: "Pertanyaan pendaftaran baru",
  enrollment: "Formulir menunggu tinjauan",
  leave: "Pengajuan cuti menunggu",
  invoice: "Link pembayaran belum tersedia",
  payroll: "Draf penggajian",
};

const tileIcon = {
  inquiry: MessageCircle,
  enrollment: FileText,
  leave: CalendarClock,
  invoice: LinkIcon,
  payroll: Wallet,
};

/**
 * One compact tile per visible work-queue source, linking straight into the
 * filtered `/admin/work-queue` table. Replaces the old full DataTable on the
 * dashboard itself so the page fits one screen — the table lives at
 * `/admin/work-queue` now.
 */
export function QueueSummaryTiles({ items }: { items: QueueSummaryItem[] }) {
  if (items.length === 0) return null;

  const total = items.reduce((sum, item) => sum + item.count, 0);
  const allReady = items.every((item) => item.status === "ready");

  if (allReady && total === 0) {
    return (
      <p data-testid="dashboard-queue-tiles" className="text-body text-muted-foreground">
        Semua beres — tidak ada pekerjaan yang menunggu.
      </p>
    );
  }

  return (
    <StatsCardsRow data-testid="dashboard-queue-tiles" cols={5} className="mb-0 auto-rows-fr">
      {items.filter((item) => item.status === "unavailable" || item.count > 0).map((item) =>
        item.status === "unavailable" ? (
          <StatTile
            key={item.kind}
            label={tileLabel[item.kind]}
            icon={tileIcon[item.kind]}
            value="—"
            tone="muted"
            size="lg"
            mono
            hint="Belum dapat dimuat."
          >
            <DashboardRetry label="Coba lagi" />
          </StatTile>
        ) : (
          <StatTile
            key={item.kind}
            href={`/admin/work-queue?kind=${item.kind}`}
            ariaLabel={`${item.count} ${tileLabel[item.kind]}`}
            label={tileLabel[item.kind]}
            icon={tileIcon[item.kind]}
            value={item.count}
            size="lg"
            mono
          />
        ),
      )}
    </StatsCardsRow>
  );
}
