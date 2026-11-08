"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { BackLink } from "@/components/portal/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import { filterReleases, type ChangelogScope } from "@/lib/changelog/filter";
import type { ChangeAudience, ChangeKind, Release } from "@/lib/changelog/schema";

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
  const visible = filterReleases(releases, audience, scope);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4 sm:px-6">
      <BackLink href={homeHref} label={`Kembali ke ${homeLabel}`} />
      <header className="mt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Apa yang Baru</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pembaruan Talib, dari yang terbaru.</p>
      </header>

      {audience !== null && (
        <div className="mt-4 flex gap-2" role="group" aria-label="Tampilkan pembaruan">
          <Button
            type="button"
            size="sm"
            variant={scope === "mine" ? "default" : "outline"}
            aria-pressed={scope === "mine"}
            onClick={() => setScope("mine")}
          >
            Untuk {AUDIENCE_LABEL[audience].toLowerCase()}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={scope === "all" ? "default" : "outline"}
            aria-pressed={scope === "all"}
            onClick={() => setScope("all")}
          >
            Semua
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Belum ada pembaruan untuk peran ini"
          description="Pilih Semua untuk melihat seluruh pembaruan."
        />
      ) : (
        <ol className="mt-6 space-y-8">
          {visible.map((release) => (
            <li key={release.id}>
              <article aria-labelledby={`rel-${release.id}`}>
                <time dateTime={release.id.slice(0, 10)} className="text-xs tabular-nums text-muted-foreground">
                  {formatDate(release.id.slice(0, 10))}
                </time>
                <h2 id={`rel-${release.id}`} className="mt-0.5 text-lg font-semibold">
                  {release.headline}
                </h2>
                <ul className="mt-3 space-y-3">
                  {release.items.map((item, i) => (
                    <li key={i} className="flex flex-col gap-1.5 rounded-lg border bg-card p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={KIND[item.kind].variant}>{KIND[item.kind].label}</Badge>
                        <Badge variant="neutral">{AUDIENCE_LABEL[item.audience]}</Badge>
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
    </main>
  );
}
