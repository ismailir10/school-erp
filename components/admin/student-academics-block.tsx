"use client";

import { memo, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateShort } from "@/lib/format";

/**
 * Akademik block of the student dossier — one row per triwulan: the raport's
 * state and how much of the child's IKTP indicator set has been assessed in it.
 *
 * Read-only, like Keuangan and Keringanan. Authoring a raport is a long form
 * with its own bank-narasi and publish workflow on `/admin/report-cards`, and
 * recording penilaian belongs to the teacher — so every row deep-links out
 * rather than growing an editor here. The dossier's job is to answer "where is
 * this child's raport, and is anyone assessing them".
 *
 * Owns its lazy fetch over `GET /api/students/[id]/academics`: `active` flips
 * true on first open and never back, so a second open costs nothing.
 */

type Penilaian = {
  entryCount: number;
  indicatorsAssessed: number;
  indicatorsTotal: number;
  coveragePct: number | null;
};

type AcademicsRow = {
  term: { id: string; number: number; semesterNumber: number; academicYear: string };
  label: string;
  status: "NONE" | "DRAFT" | "PUBLISHED";
  publishedAt: string | null;
  updatedAt: string | null;
  penilaian: Penilaian | null;
};

type AcademicsPayload = {
  ageGroup: "A" | "B" | null;
  currentTermId: string | null;
  tally: { published: number; draft: number; total: number };
  rows: AcademicsRow[];
};

/**
 * Coverage colour is deliberately not a pass/fail judgement — the school has
 * set no target. Below a third of the indicators is the one case worth
 * flagging, because it usually means nobody has assessed the child at all.
 */
function coverageTone(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct < 34) return "text-status-absent-text";
  return "text-foreground";
}

function raportHref(studentId: string, termId: string, classSectionId: string | null): string {
  const params = new URLSearchParams({ termId, studentId });
  if (classSectionId) params.set("classSectionId", classSectionId);
  return `/admin/report-cards?${params.toString()}`;
}

export const StudentAcademicsBlock = memo(function StudentAcademicsBlock({
  studentId,
  classSectionId,
  active,
}: {
  studentId: string;
  /** Current class, so the raport deep link lands on a selected roster. */
  classSectionId: string | null;
  active: boolean;
}) {
  const [data, setData] = useState<AcademicsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/academics`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const json = await res.json();
      const payload = json?.data as AcademicsPayload | undefined;
      if (!payload) {
        setError(true);
        return;
      }
      setData(payload);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (!active || data !== null || loading || error) return;
    load();
    // `data`/`loading`/`error` are the guard, not inputs to re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const penilaianLink = (
    <Link href="/admin/assessments" className="text-sm text-primary-text hover:underline">
      Buka monitor Penilaian →
    </Link>
  );

  if (loading || (active && data === null && !error)) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  // Fetch error contract: name the failure and offer the retry. An empty state
  // here would read as "this child has no raport", which is a different fact.
  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Gagal memuat data akademik.</p>
        <button
          type="button"
          onClick={load}
          className="rounded-md text-sm text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          title="Belum ada triwulan"
          description="Raport dan penilaian akan muncul di sini setelah triwulan dibuat di Semester & Triwulan."
        />
        <div className="text-center">{penilaianLink}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.ageGroup === null && (
        <p className="text-xs text-muted-foreground">
          Siswa belum terdaftar di kelas aktif, jadi cakupan penilaian belum bisa dihitung.
        </p>
      )}

      <ul className="space-y-0">
        {data.rows.map((row) => {
          const p = row.penilaian;
          return (
            <li
              key={row.term.id}
              className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b border-border/50 py-2.5 last:border-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {row.label}
                  {row.term.id === data.currentTermId && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      berjalan
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p === null ? (
                    // Older academic years are outside the aggregate's query
                    // budget — say so rather than print a 0% that would read as
                    // "nobody assessed this child".
                    "Cakupan penilaian tidak dihitung untuk tahun ajaran lampau"
                  ) : (
                    <>
                      {p.entryCount} penilaian ·{" "}
                      <span className={coverageTone(p.coveragePct)}>
                        {p.coveragePct === null
                          ? "cakupan —"
                          : `${p.indicatorsAssessed}/${p.indicatorsTotal} indikator (${p.coveragePct}%)`}
                      </span>
                    </>
                  )}
                  {row.status === "PUBLISHED" && row.publishedAt
                    ? ` · terbit ${formatDateShort(row.publishedAt)}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {row.status === "NONE" ? (
                  <span className="text-xs text-muted-foreground">Belum dibuat</span>
                ) : (
                  <StatusBadge status={row.status} />
                )}
                <Link
                  href={raportHref(studentId, row.term.id, classSectionId)}
                  className="whitespace-nowrap text-sm text-primary-text hover:underline"
                >
                  {row.status === "NONE" ? "Buat raport →" : "Buka raport →"}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      {penilaianLink}
    </div>
  );
});
