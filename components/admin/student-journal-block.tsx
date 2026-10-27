"use client";

import { memo, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { WeekGrid } from "@/components/portal/week-grid";
import { NoteThreadPanel } from "@/components/student-journal/note-thread-panel";
import { weekStart } from "@/lib/student-journal/week";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { summarizeJournalWeek, shiftWeek } from "@/lib/student/journal-week";
import { formatDateShort } from "@/lib/format";

/**
 * Buku Penghubung block of the student dossier — one week of the school-scope
 * journal, read-only.
 *
 * Reuses `WeekGrid` rather than drawing a second grid: `editable` defaults to
 * false, so passing no `onToggle` is the whole of "read-only". Correcting a
 * tick, the "Di Rumah" scope and the audit trail all stay on
 * `/admin/student-journal/students/[id]`, which this deep-links to on the same
 * week the admin is looking at.
 *
 * Lazy, like Keringanan: `active` flips true when the section first opens.
 */

type Indicator = { id: string; label: string; order: number };
type Category = { id: string; name: string; scope: string; indicators: Indicator[] };
type Entry = { id?: string; indicatorId: string; date: string; checked: boolean };

type WeekData = {
  weekStart: string;
  dates: string[];
  schoolCategories: Category[];
  schoolEntries: Entry[];
  dayMarks?: Record<string, string>;
};

export const StudentJournalBlock = memo(function StudentJournalBlock({
  studentId,
  active,
}: {
  studentId: string;
  active: boolean;
}) {
  const [ws, setWs] = useState<string>(() => weekStart(getTodayInTimezone("Asia/Jakarta")));
  const [data, setData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (targetWeek: string) => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(
          `/api/student-journal/admin/students/${studentId}/week?weekStart=${targetWeek}`,
        );
        if (!res.ok) {
          setError(true);
          return;
        }
        const json = await res.json();
        setData(json?.data ?? null);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [studentId],
  );

  useEffect(() => {
    if (!active) return;
    load(ws);
  }, [active, ws, load]);

  if (!active) return null;

  if (loading && !data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Gagal memuat Buku Penghubung.</p>
        <button
          type="button"
          onClick={() => load(ws)}
          className="rounded-md text-sm text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  const dates = data?.dates ?? [];
  const categories = data?.schoolCategories ?? [];
  const entries = data?.schoolEntries ?? [];
  const summary = summarizeJournalWeek(categories, entries, dates);

  const weekLabel =
    dates.length > 0
      ? `${formatDateShort(dates[0])} – ${formatDateShort(dates[dates.length - 1])}`
      : formatDateShort(ws);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Pekan sebelumnya"
            disabled={loading}
            onClick={() => setWs((w) => shiftWeek(w, -1))}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </Button>
          <span className="text-sm font-medium">{weekLabel}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Pekan berikutnya"
            disabled={loading}
            onClick={() => setWs((w) => shiftWeek(w, 1))}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {summary.filledDays}/{summary.dayCount} hari terisi · {summary.checkedCount} centang
        </p>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title="Buku Penghubung belum disiapkan"
          description="Template Buku Penghubung belum dibuat untuk sekolah ini."
        />
      ) : (
        // The five day columns do not fit a 390px card — on the journal page
        // the grid owns the full width, here it sits inside a dossier section.
        // Without this the Jumat column is clipped at the card edge with
        // nothing to say it is there.
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="min-w-[520px]">
            <WeekGrid
              categories={categories}
              entries={entries}
              dates={dates}
              dayMarks={data?.dayMarks}
              emptyWeekMessage="Belum ada centang di pekan ini."
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Catatan
        </p>
        <NoteThreadPanel studentId={studentId} />
      </div>

      <Link
        href={`/admin/student-journal/students/${studentId}?weekStart=${ws}`}
        className="inline-block text-sm text-primary-text hover:underline"
      >
        Buka Buku Penghubung lengkap →
      </Link>
    </div>
  );
});
