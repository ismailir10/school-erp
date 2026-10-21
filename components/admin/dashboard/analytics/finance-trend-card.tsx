"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Wallet } from "lucide-react";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { usePrefersReducedMotion } from "@/components/reactbits/use-prefers-reduced-motion";
import type { AnalyticsSource, FinanceAnalytics } from "@/lib/dashboard/analytics";
import { formatDate, formatRupiah, formatRupiahCompact } from "@/lib/format";
import { ANALYTICS_CHART_CLASS, AnalyticsCard, AnalyticsUnavailable } from "./analytics-card";
import { TooltipCard } from "./chart-tooltip";

const TESTID = "analytics-finance-trend";

// Billed is the neutral reference, collected is the brand colour: the eye goes
// to what came in. Both are tokens; the gray is the muted text colour mixed
// down so the legend swatch and the bar are the same colour.
const chartConfig = {
  billed: { label: "Ditagihkan", color: "color-mix(in oklch, var(--muted-foreground) 55%, transparent)" },
  collected: { label: "Terkumpul", color: "var(--primary)" },
} satisfies ChartConfig;

type MonthRow = FinanceAnalytics["months"][number];

/** Billed vs collected per month for the last 6 months. */
export function FinanceTrendCard({
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
        title="Tagihan vs terkumpul"
        message="Data keuangan belum dapat dimuat."
        className={className}
      />
    );
  }

  const { months } = source.data;
  const isEmpty = months.every((month) => month.billed === 0 && month.collected === 0);
  const billed = months.reduce((sum, month) => sum + month.billed, 0);
  const collected = months.reduce((sum, month) => sum + month.collected, 0);

  return (
    <AnalyticsCard
      testId={TESTID}
      title="Tagihan vs terkumpul"
      description="6 bulan terakhir"
      action={{ label: "Lihat tagihan", href: "/admin/invoices" }}
      className={className}
      summary={
        isEmpty
          ? "Belum ada tagihan dalam 6 bulan terakhir."
          : `Dalam 6 bulan terakhir tagihan ${formatRupiah(billed)} dan terkumpul ${formatRupiah(collected)}.`
      }
    >
      {isEmpty ? (
        <EmptyState
          icon={Wallet}
          title="Belum ada tagihan"
          description="Grafik muncul setelah tagihan diterbitkan."
        />
      ) : (
        <FinanceBarChart months={months} />
      )}
    </AnalyticsCard>
  );
}

const monthLabel = (month: string) => formatDate(`${month}-01`, { month: "short" });

function FinanceBarChart({ months }: { months: MonthRow[] }) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <ChartContainer config={chartConfig} className={ANALYTICS_CHART_CLASS}>
      <BarChart accessibilityLayer data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.28} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={monthLabel} />
        <YAxis
          width={64}
          tickLine={false}
          axisLine={false}
          tickCount={4}
          tickFormatter={(value: number) => formatRupiahCompact(value)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as MonthRow | undefined;
            if (!active || !row) return null;
            return (
              <TooltipCard
                title={formatDate(`${row.month}-01`, { month: "long", year: "numeric" })}
                rows={[
                  { label: "Ditagihkan", value: formatRupiah(row.billed), color: chartConfig.billed.color },
                  { label: "Terkumpul", value: formatRupiah(row.collected), color: chartConfig.collected.color },
                ]}
              />
            );
          }}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="billed"
          fill="var(--color-billed)"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={!reducedMotion}
          animationDuration={800}
          animationEasing="ease-out"
        />
        <Bar
          dataKey="collected"
          fill="var(--color-collected)"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={!reducedMotion}
          animationDuration={800}
          animationEasing="ease-out"
        />
      </BarChart>
    </ChartContainer>
  );
}
