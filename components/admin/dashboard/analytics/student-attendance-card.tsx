"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartNoAxesColumnIncreasing } from "lucide-react";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { usePrefersReducedMotion } from "@/components/reactbits/use-prefers-reduced-motion";
import type { AnalyticsSource, AttendanceAnalytics, AttendanceDay } from "@/lib/dashboard/analytics";
import { formatDate } from "@/lib/format";
import { ANALYTICS_CHART_CLASS, AnalyticsCard, AnalyticsUnavailable } from "./analytics-card";
import { ClassRankList } from "./class-rank-list";
import { TooltipCard } from "./chart-tooltip";

const TESTID = "analytics-attendance";
const ATTENDANCE_HREF = "/admin/student-attendance";

const chartConfig = {
  rate: { label: "Kehadiran", color: "var(--status-present)" },
} satisfies ChartConfig;

/**
 * Daily student attendance rate for the last 30 days that have records, with
 * the present / izin / sakit / alpa breakdown on hover and the classes with
 * the lowest rate underneath.
 */
export function StudentAttendanceCard({ source }: { source: AnalyticsSource<AttendanceAnalytics> }) {
  if (source.status === "hidden") return null;
  if (source.status === "unavailable") {
    return (
      <AnalyticsUnavailable
        testId={TESTID}
        title="Kehadiran siswa"
        message="Data kehadiran siswa belum dapat dimuat."
      />
    );
  }

  const { days, rate, totalRecords, lowestClasses } = source.data;
  return (
    <AnalyticsCard
      testId={TESTID}
      title="Kehadiran siswa"
      description="30 hari terakhir"
      action={{ label: "Lihat kehadiran", href: ATTENDANCE_HREF }}
      summary={
        days.length === 0 || rate === null
          ? "Belum ada data kehadiran siswa dalam 30 hari terakhir."
          : `Rata-rata kehadiran ${rate} persen dalam 30 hari terakhir, dari ${totalRecords} catatan.`
      }
    >
      {days.length === 0 ? (
        <EmptyState
          icon={ChartNoAxesColumnIncreasing}
          title="Belum ada data kehadiran siswa"
          description="Grafik muncul setelah guru mencatat kehadiran."
        />
      ) : (
        <>
          <AttendanceAreaChart days={days} />
          <ClassRankList
            heading="Kelas perlu perhatian"
            items={lowestClasses.map((item) => ({
              key: item.classSectionId,
              name: item.name,
              percent: item.rate,
              caption: `${item.total.toLocaleString("id-ID")} catatan`,
              href: ATTENDANCE_HREF,
            }))}
          />
        </>
      )}
    </AnalyticsCard>
  );
}

const dayLabel = (date: string) => formatDate(date, { day: "numeric", month: "short" });

function AttendanceAreaChart({ days }: { days: AttendanceDay[] }) {
  const reducedMotion = usePrefersReducedMotion();
  // Cannot contain ":" (useId) inside url(#…).
  const gradientId = `attendance-fill-${useId().replace(/:/g, "")}`;

  // A rate chart pinned to 0–100 draws a 92–98% month as a flat line along the
  // top. Floor the axis at the nearest ten under the lowest day, minus a
  // margin, so the movement is visible while the top stays at 100%.
  const lowest = Math.min(...days.map((day) => day.rate));
  const floor = Math.max(0, Math.floor((lowest - 5) / 10) * 10);

  return (
    <ChartContainer config={chartConfig} className={ANALYTICS_CHART_CLASS}>
      <AreaChart accessibilityLayer data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-rate)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-rate)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.28} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          interval="preserveStartEnd"
          tickFormatter={dayLabel}
        />
        <YAxis
          width={40}
          domain={[floor, 100]}
          ticks={floor === 100 ? [100] : [floor, Math.round((floor + 100) / 2), 100]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${value}%`}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const day = payload?.[0]?.payload as AttendanceDay | undefined;
            if (!active || !day) return null;
            return (
              <TooltipCard
                title={formatDate(day.date, { weekday: "long", day: "numeric", month: "long" })}
                rows={[
                  { label: "Kehadiran", value: `${day.rate}%`, color: "var(--status-present)" },
                  { label: "Hadir", value: day.present },
                  { label: "Izin", value: day.permission },
                  { label: "Sakit", value: day.sick },
                  { label: "Alpa", value: day.absent },
                ]}
              />
            );
          }}
        />
        <Area
          dataKey="rate"
          type="monotone"
          stroke="var(--color-rate)"
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2 }}
          isAnimationActive={!reducedMotion}
          animationDuration={800}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ChartContainer>
  );
}
