import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Aurora } from "@/components/reactbits/aurora";
import { CountUp } from "@/components/reactbits/count-up";
import { Spotlight } from "@/components/reactbits/spotlight";
import { StatTile } from "@/components/ui/stat-tile";
import type {
  AnalyticsSource,
  AttendanceAnalytics,
  FinanceAnalytics,
  JournalAnalytics,
} from "@/lib/dashboard/analytics";
import { formatRupiahCompact } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * The three numbers an admin reads first: attendance (30 days, with the change
 * against the 30 days before), this month's collection rate, and this week's
 * buku penghubung completion. Each tile opens its module. A hidden source is
 * not rendered; a failed or empty one shows "—", never a false zero.
 */
export function HeadlineBand({
  attendance,
  finance,
  journal,
}: {
  attendance: AnalyticsSource<AttendanceAnalytics>;
  finance: AnalyticsSource<FinanceAnalytics>;
  journal: AnalyticsSource<JournalAnalytics>;
}) {
  const tiles = [
    attendanceTile(attendance),
    finance.status === "hidden" ? null : financeTile(finance),
    journalTile(journal),
  ].filter((tile) => tile !== null);

  return (
    <div
      data-testid="analytics-headline"
      className="relative isolate overflow-hidden rounded-xl border bg-card p-3"
    >
      <Aurora />
      <div
        className={cn(
          "grid gap-3",
          tiles.length >= 3 ? "md:grid-cols-3" : tiles.length === 2 ? "md:grid-cols-2" : "",
        )}
      >
        {tiles}
      </div>
    </div>
  );
}

type Tile = {
  key: string;
  label: string;
  href: string;
  /** Integer percent, or null when there is nothing to show. */
  value: number | null;
  hint: React.ReactNode;
  ariaLabel: string;
  chip?: React.ReactNode;
};

function renderTile(tile: Tile) {
  return (
    <StatTile
      key={tile.key}
      href={tile.href}
      ariaLabel={tile.ariaLabel}
      label={tile.label}
      value={
        tile.value === null ? (
          "—"
        ) : (
          <>
            <CountUp value={tile.value} />%
          </>
        )
      }
      tone={tile.value === null ? "muted" : "default"}
      size="lg"
      mono
      hint={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {tile.chip}
          <span>{tile.hint}</span>
        </span>
      }
      className="min-h-11 bg-card/90 px-4 py-3"
    >
      <Spotlight />
    </StatTile>
  );
}

function attendanceTile(source: AnalyticsSource<AttendanceAnalytics>) {
  const base = { key: "attendance", label: "Kehadiran siswa", href: "/admin/student-attendance" };
  if (source.status !== "ready") {
    return renderTile({
      ...base,
      value: null,
      hint: "Data belum dapat dimuat",
      ariaLabel: "Kehadiran siswa belum dapat dimuat",
    });
  }
  const { rate, previousRate } = source.data;
  if (rate === null) {
    return renderTile({ ...base, value: null, hint: "Belum ada data", ariaLabel: "Kehadiran siswa belum ada data" });
  }
  const delta = previousRate === null ? null : rate - previousRate;
  return renderTile({
    ...base,
    value: rate,
    hint: "30 hari terakhir",
    ariaLabel: `Kehadiran siswa ${rate} persen, 30 hari terakhir${deltaSentence(delta)}`,
    chip: delta === null ? undefined : <DeltaChip delta={delta} />,
  });
}

function financeTile(source: AnalyticsSource<FinanceAnalytics>) {
  const base = { key: "finance", label: "Penagihan bulan ini", href: "/admin/invoices" };
  if (source.status !== "ready") {
    return renderTile({
      ...base,
      value: null,
      hint: "Data belum dapat dimuat",
      ariaLabel: "Penagihan bulan ini belum dapat dimuat",
    });
  }
  const { rate, paid, billed } = source.data.thisMonth;
  if (rate === null) {
    return renderTile({ ...base, value: null, hint: "Belum ada data", ariaLabel: "Penagihan bulan ini belum ada data" });
  }
  const hint = `${formatRupiahCompact(paid)} dari ${formatRupiahCompact(billed)}`;
  return renderTile({ ...base, value: rate, hint, ariaLabel: `Penagihan bulan ini ${rate} persen, ${hint}` });
}

function journalTile(source: AnalyticsSource<JournalAnalytics>) {
  const base = { key: "journal", label: "Buku penghubung", href: "/admin/student-journal/monitoring" };
  if (source.status !== "ready") {
    return renderTile({
      ...base,
      value: null,
      hint: "Data belum dapat dimuat",
      ariaLabel: "Buku penghubung belum dapat dimuat",
    });
  }
  const { thisWeekPct } = source.data;
  if (thisWeekPct === null) {
    return renderTile({ ...base, value: null, hint: "Belum ada data", ariaLabel: "Buku penghubung belum ada data" });
  }
  return renderTile({
    ...base,
    value: thisWeekPct,
    hint: "Kelengkapan minggu ini",
    ariaLabel: `Buku penghubung ${thisWeekPct} persen, kelengkapan minggu ini`,
  });
}

function deltaSentence(delta: number | null): string {
  if (delta === null) return "";
  if (delta === 0) return ", stabil dibanding 30 hari sebelumnya";
  return `, ${delta > 0 ? "naik" : "turun"} ${Math.abs(delta)} poin dibanding 30 hari sebelumnya`;
}

/** Change in percentage points against the previous window: green up, red down, muted flat. */
function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <Badge variant="neutral" className="text-caption font-semibold">
        Stabil
      </Badge>
    );
  }
  const up = delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <Badge
      variant={up ? "success" : "danger"}
      className="gap-0.5 text-caption font-semibold"
    >
      <Icon aria-hidden="true" className="size-3" />
      {up ? "+" : "−"}
      {Math.abs(delta)} poin
    </Badge>
  );
}
