import { DashboardRetry } from "@/components/admin/dashboard/admin-work-queue";
import { CountUp } from "@/components/reactbits/count-up";
import { Spotlight } from "@/components/reactbits/spotlight";
import { StatTile } from "@/components/ui/stat-tile";
import type { QueueSummaryItem } from "@/lib/dashboard/admin-work-queue";

const tileLabel: Record<QueueSummaryItem["kind"], string> = {
  inquiry: "Pertanyaan pendaftaran baru",
  enrollment: "Formulir menunggu tinjauan",
  leave: "Pengajuan cuti menunggu",
  invoice: "Link pembayaran belum tersedia",
  payroll: "Draf penggajian",
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
    <div data-testid="dashboard-queue-tiles" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {items.map((item) =>
        item.status === "unavailable" ? (
          <StatTile
            key={item.kind}
            label={tileLabel[item.kind]}
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
            value={<CountUp value={item.count} />}
            size="lg"
            mono
          >
            <Spotlight />
          </StatTile>
        ),
      )}
    </div>
  );
}
