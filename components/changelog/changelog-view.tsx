"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { BackLink } from "@/components/portal/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDate, formatMonthLabel } from "@/lib/format";
import {
  filterReleases,
  paginateReleases,
  releaseMonths,
  type ChangelogFilters,
  type ChangelogScope,
} from "@/lib/changelog/filter";
import { MODULE_LABELS, type ChangeAudience, type ChangeKind, type ChangeModule, type Release } from "@/lib/changelog/schema";

const KIND: Record<ChangeKind, { label: string; variant: "success" | "info" | "warning" }> = {
  baru: { label: "Baru", variant: "success" },
  "lebih-baik": { label: "Lebih baik", variant: "info" },
  diperbaiki: { label: "Diperbaiki", variant: "warning" },
};

const AUDIENCE_LABEL: Record<ChangeAudience, string> = {
  semua: "Semua",
  admin: "Admin",
  guru: "Guru",
  "orang-tua": "Orang tua",
};

export function ChangelogView({
  releases,
  audience,
  homeHref,
  homeLabel,
}: {
  releases: readonly Release[];
  /** The viewer's own portal; null shows everything with no filter row. */
  audience: ChangeAudience | null;
  homeHref: string;
  homeLabel: string;
}) {
  const [scope, setScope] = useState<ChangelogScope>("mine");
  const [filters, setFilters] = useState<ChangelogFilters>({});
  const [requestedPage, setRequestedPage] = useState(1);
  const filterId = useId();
  const monthSelect = useRef<HTMLSelectElement>(null);
  const firstReleaseTitle = useRef<HTMLHeadingElement>(null);
  const focusPageResults = useRef(false);

  const filtered = filterReleases(releases, audience, scope, filters);
  const { page, totalPages, releases: visible } = paginateReleases(filtered, requestedPage);
  const hasFilters = Boolean(filters.month || filters.module);

  useEffect(() => {
    if (focusPageResults.current) {
      focusPageResults.current = false;
      firstReleaseTitle.current?.focus();
    }
  }, [page]);

  function changeScope(nextScope: ChangelogScope) {
    if (nextScope === scope) return;
    setScope(nextScope);
    setRequestedPage(1);
  }

  function changeFilters(nextFilters: ChangelogFilters) {
    setFilters((previous) => ({ ...previous, ...nextFilters }));
    setRequestedPage(1);
  }

  function clearFilters() {
    setFilters({});
    setRequestedPage(1);
    monthSelect.current?.focus();
  }

  function goToPage(nextPage: number) {
    focusPageResults.current = true;
    setRequestedPage(nextPage);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4 sm:px-6">
      <BackLink href={homeHref} label={`Kembali ke ${homeLabel}`} />
      <header className="mt-2">
        <h1 className="text-h1 tracking-tight">Apa yang Baru</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pembaruan Talib, dari yang terbaru.</p>
      </header>

      {audience !== null && (
        <div className="mt-4 flex gap-2" role="group" aria-label="Tampilkan pembaruan">
          <Button
            type="button"
            size="sm"
            variant={scope === "mine" ? "selection" : "outline"}
            aria-pressed={scope === "mine"}
            onClick={() => changeScope("mine")}
          >
            Untuk {AUDIENCE_LABEL[audience].toLowerCase()}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={scope === "all" ? "selection" : "outline"}
            aria-pressed={scope === "all"}
            onClick={() => changeScope("all")}
          >
            Semua
          </Button>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${filterId}-month`}>Bulan</Label>
          <NativeSelect
            ref={monthSelect}
            id={`${filterId}-month`}
            className="w-full"
            value={filters.month ?? ""}
            onChange={(event) => changeFilters({ month: event.currentTarget.value || undefined })}
          >
            <NativeSelectOption value="">Semua bulan</NativeSelectOption>
            {releaseMonths(releases).map((period) => (
              <NativeSelectOption key={period} value={period}>
                {formatMonthLabel(Number(period.slice(0, 4)), Number(period.slice(5)))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${filterId}-module`}>Modul</Label>
          <NativeSelect
            id={`${filterId}-module`}
            className="w-full"
            value={filters.module ?? ""}
            onChange={(event) => changeFilters({ module: (event.currentTarget.value as ChangeModule) || undefined })}
          >
            <NativeSelectOption value="">Semua modul</NativeSelectOption>
            {Object.entries(MODULE_LABELS).map(([module, label]) => (
              <NativeSelectOption key={module} value={module}>{label}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <p role="status" className="sr-only">
        {filtered.length} rilis ditemukan.
      </p>
      {visible.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={hasFilters ? "Tidak ada pembaruan yang cocok" : "Belum ada pembaruan untuk peran ini"}
          description={hasFilters ? "Coba bulan atau modul lain." : "Pilih Semua untuk melihat seluruh pembaruan."}
          actionLabel={hasFilters ? "Hapus filter" : undefined}
          onAction={hasFilters ? clearFilters : undefined}
        />
      ) : (
        <ol className="mt-6 space-y-8">
          {visible.map((release, index) => (
            <li key={release.id}>
              <article aria-labelledby={`rel-${release.id}`}>
                <time dateTime={release.id.slice(0, 10)} className="text-xs tabular-nums text-muted-foreground">
                  {formatDate(release.id.slice(0, 10))}
                </time>
                <h2
                  ref={index === 0 ? firstReleaseTitle : undefined}
                  id={`rel-${release.id}`}
                  tabIndex={index === 0 ? -1 : undefined}
                  className="mt-0.5 scroll-mt-4 rounded-sm text-h2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {release.headline}
                </h2>
                <ul className="mt-3 space-y-3">
                  {release.items.map((item, i) => (
                    <li key={i} className="flex flex-col gap-1.5 rounded-lg border bg-card p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={KIND[item.kind].variant}>{KIND[item.kind].label}</Badge>
                        <Badge variant="neutral">{AUDIENCE_LABEL[item.audience]}</Badge>
                        <Badge variant="outline">{MODULE_LABELS[item.module]}</Badge>
                      </div>
                      <p className="text-sm leading-relaxed text-pretty">{item.text}</p>
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      )}

      {totalPages > 1 && (
        <nav aria-label="Halaman pembaruan" className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={page === 1} onClick={() => goToPage(page - 1)}>
            Sebelumnya
          </Button>
          <p className="text-small tabular-nums text-muted-foreground">Halaman {page} dari {totalPages}</p>
          <Button type="button" variant="outline" disabled={page === totalPages} onClick={() => goToPage(page + 1)}>
            Berikutnya
          </Button>
        </nav>
      )}
    </main>
  );
}
