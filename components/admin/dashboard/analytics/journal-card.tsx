"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { BookOpen } from "lucide-react";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/ui/stat-tile";
import { CountUp } from "@/components/reactbits/count-up";
import { usePrefersReducedMotion } from "@/components/reactbits/use-prefers-reduced-motion";
import type { AnalyticsSource, JournalAnalytics, JournalWeek } from "@/lib/dashboard/analytics";
import { formatDate, formatWeekRangeLabel } from "@/lib/format";
import { ANALYTICS_CHART_CLASS, AnalyticsCard, AnalyticsUnavailable } from "./analytics-card";
import { ClassRankList } from "./class-rank-list";
import { TooltipCard } from "./chart-tooltip";

const TESTID = "analytics-journal";
const MONITORING_HREF = "/admin/student-journal/monitoring";

const chartConfig = {
  completion: { label: "Kelengkapan", color: "var(--primary)" },
} satisfies ChartConfig;

/** Friday of the Monday-start week, for the "24 Agu – 28 Agu 2026" tooltip range. */
function weekEnd(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4);
  return date.toISOString().slice(0, 10);
}

/**
 * Buku penghubung completion for the last 8 weeks (Mon–Fri, SCHOOL scope,
 * Monitoring's definition; the current week counts only the school days so
 * far), the notes teachers and wali wrote over the
 * same weeks, and the classes least complete this week.
 */
export function JournalCard({ source }: { source: AnalyticsSource<JournalAnalytics> }) {
  if (source.status === "hidden") return null;
  if (source.status === "unavailable") {
    return (
      <AnalyticsUnavailable
        testId={TESTID}
        title="Buku penghubung"
        message="Data buku penghubung belum dapat dimuat."
      />
    );
  }

  const { weeks, thisWeekPct, teacherNotes, guardianNotes, leastCompleteClasses } = source.data;
  const isEmpty =
    teacherNotes + guardianNotes === 0 && weeks.every((week) => !week.completionPct);
  const currentWeekStart = weeks[weeks.length - 1]?.weekStart;

  return (
    <AnalyticsCard
      testId={TESTID}
      title="Buku penghubung"
      description="Kelengkapan 8 minggu terakhir"
      action={{ label: "Lihat monitoring", href: MONITORING_HREF }}
      summary={
        isEmpty
          ? "Belum ada data buku penghubung dalam 8 minggu terakhir."
          : `Kelengkapan buku penghubung minggu ini ${thisWeekPct === null ? "belum ada data" : `${thisWeekPct} persen`}. Dalam 8 minggu terakhir guru menulis ${teacherNotes} catatan dan wali ${guardianNotes} catatan.`
      }
    >
      {isEmpty ? (
        <EmptyState
          icon={BookOpen}
          title="Belum ada data buku penghubung"
          description="Grafik muncul setelah guru mengisi buku penghubung."
        />
      ) : (
        <>
          <JournalBarChart weeks={weeks} />
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Catatan guru"
              value={<CountUp value={teacherNotes} />}
              hint="8 minggu terakhir"
              mono
              className="bg-muted/30"
            />
            <StatTile
              label="Catatan wali"
              value={<CountUp value={guardianNotes} />}
              hint="8 minggu terakhir"
              mono
              className="bg-muted/30"
            />
          </div>
          <ClassRankList
            heading="Kelas paling tertinggal minggu ini"
            items={leastCompleteClasses.map((item) => ({
              key: item.classSectionId,
              name: item.name,
              percent: item.completionPct,
              href: currentWeekStart
                ? `/admin/student-journal/classes/${item.classSectionId}?weekStart=${currentWeekStart}`
                : MONITORING_HREF,
            }))}
          />
        </>
      )}
    </AnalyticsCard>
  );
}

const weekLabel = (weekStart: string) => formatDate(weekStart, { day: "numeric", month: "short" });

function JournalBarChart({ weeks }: { weeks: JournalWeek[] }) {
  const reducedMotion = usePrefersReducedMotion();
  const data = weeks.map((week, index) => ({ ...week, completion: week.completionPct ?? 0, current: index === weeks.length - 1 }));

  return (
    <ChartContainer config={chartConfig} className={ANALYTICS_CHART_CLASS}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.28} />
        <XAxis dataKey="weekStart" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={weekLabel} />
        <YAxis
          width={40}
          domain={[0, 100]}
          ticks={[0, 50, 100]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${value}%`}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={({ active, payload }) => {
            const week = payload?.[0]?.payload as (JournalWeek & { current: boolean }) | undefined;
            if (!active || !week) return null;
            return (
              <TooltipCard
                title={`${formatWeekRangeLabel(week.weekStart, weekEnd(week.weekStart))}${week.current ? " (minggu ini, s.d. hari ini)" : ""}`}
                rows={
                  week.completionPct === null
                    ? [{ label: "Kelengkapan", value: "Belum ada data" }]
                    : [
                        { label: "Kelengkapan", value: `${week.completionPct}%`, color: "var(--primary)" },
                        { label: "Butir terisi", value: `${week.checked.toLocaleString("id-ID")} dari ${week.possible.toLocaleString("id-ID")}` },
                        { label: "Catatan guru", value: week.teacherNotes },
                        { label: "Catatan wali", value: week.guardianNotes },
                      ]
                }
              />
            );
          }}
        />
        <Bar
          dataKey="completion"
          fill="var(--color-completion)"
          radius={[6, 6, 0, 0]}
          maxBarSize={36}
          isAnimationActive={!reducedMotion}
          animationDuration={800}
          animationEasing="ease-out"
        >
          {data.map((week) => (
            <Cell key={week.weekStart} fillOpacity={week.current ? 1 : 0.45} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
