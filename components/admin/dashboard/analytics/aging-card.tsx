import { CircleCheckBig } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { AgingKey, AnalyticsSource, FinanceAnalytics } from "@/lib/dashboard/analytics";
import { formatNumber, formatRupiah } from "@/lib/format";
import { AnalyticsCard, AnalyticsUnavailable } from "./analytics-card";

const TESTID = "analytics-aging";

// Status tokens only. Blue while nothing is late, then amber to red as the debt ages.
const BUCKETS: Record<AgingKey, { label: string; bar: string }> = {
  current: { label: "Belum jatuh tempo", bar: "bg-status-leave" },
  d1_30: { label: "1–30 hari", bar: "bg-status-no-checkout" },
  d31_60: { label: "31–60 hari", bar: "bg-status-late" },
  d61_90: { label: "61–90 hari", bar: "bg-status-absent/70" },
  d90_plus: { label: "> 90 hari", bar: "bg-status-absent" },
};

/** Outstanding piutang by how long it has been due: one segmented bar, then the five buckets. */
export function AgingCard({
  source,
  className,
}: {
  source: AnalyticsSource<FinanceAnalytics>;
  className?: string;
}) {
  if (source.status === "hidden") return null;
  if (source.status === "unavailable") {
    return (
      <AnalyticsUnavailable
        testId={TESTID}
        title="Umur piutang"
        message="Data piutang belum dapat dimuat."
        className={className}
      />
    );
  }

  const { aging, outstandingTotal } = source.data;
  const total = aging.reduce((sum, bucket) => sum + bucket.amount, 0);
  const isEmpty = outstandingTotal <= 0 || total <= 0;
  const overdue = aging.filter((bucket) => bucket.key !== "current").reduce((sum, bucket) => sum + bucket.amount, 0);

  return (
    <AnalyticsCard
      testId={TESTID}
      title="Umur piutang"
      description={`Total ${formatRupiah(outstandingTotal)}`}
      action={{ label: "Lihat lewat tempo", href: "/admin/invoices?status=OVERDUE" }}
      className={className}
      summary={
        isEmpty
          ? "Tidak ada piutang."
          : `Piutang ${formatRupiah(outstandingTotal)}, ${formatRupiah(overdue)} di antaranya sudah lewat tempo.`
      }
    >
      {isEmpty ? (
        <EmptyState
          accent="celebration"
          icon={CircleCheckBig}
          title="Tidak ada piutang"
          description="Semua tagihan yang sudah terbit telah dibayar."
        />
      ) : (
        <>
          <div
            role="img"
            aria-label={aging
              .filter((bucket) => bucket.amount > 0)
              .map((bucket) => `${BUCKETS[bucket.key].label} ${Math.round((bucket.amount / total) * 100)} persen`)
              .join(", ")}
            className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
          >
            {aging
              .filter((bucket) => bucket.amount > 0)
              .map((bucket) => (
                <span
                  key={bucket.key}
                  data-bucket={bucket.key}
                  className={`min-w-1 ${BUCKETS[bucket.key].bar}`}
                  style={{ flexGrow: bucket.amount, flexBasis: 0 }}
                />
              ))}
          </div>
          <ul className="divide-y">
            {aging.map((bucket) => (
              <li key={bucket.key} data-bucket-row={bucket.key} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="flex min-w-0 flex-1 basis-36 items-center gap-3">
                  <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${BUCKETS[bucket.key].bar}`} />
                  <span className="min-w-0">
                    <span className="block text-body font-medium">{BUCKETS[bucket.key].label}</span>
                    <span className="block text-small text-muted-foreground">{formatNumber(bucket.count)} tagihan</span>
                  </span>
                </span>
                <span className="ms-auto shrink-0 whitespace-nowrap text-small font-medium tabular-nums font-currency">{formatRupiah(bucket.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </AnalyticsCard>
  );
}
