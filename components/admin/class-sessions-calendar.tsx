"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodStepper } from "@/components/ui/period-stepper";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Month grid for the class-detail "Kalender Sesi" dossier section
 * (`app/admin/classes/[id]/client.tsx`). Split out of the client component
 * because it is the one section with real hand-rolled layout logic (month
 * math, a 7-column grid, per-day session chips) rather than a DataTable —
 * everything else in the dossier is thin enough to stay inline.
 *
 * On a phone the 7-column grid leaves each cell ~44px wide, too small to tap a
 * session in, so below `md` the same data renders as a day-by-day list.
 *
 * Entity-local on purpose (unlike `dossier-section.tsx` / `detail-rail.tsx`):
 * nothing else in the app renders a session calendar today, so there is no
 * reuse pressure yet.
 */

export type SessionRow = {
  id: string;
  classSectionId: string;
  semesterId: string;
  date: string;
  slot: string;
  teacherId: string | null;
  defaultTeacherId: string | null;
  substituteReason: string | null;
  isBackfilled: boolean;
  teacher: { id: string; nama: string } | null;
  defaultTeacher: { id: string; nama: string } | null;
};

const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export const SLOT_LABELS: Record<string, string> = {
  FULL_DAY: "Sehari Penuh",
  MORNING: "Pagi",
  AFTERNOON: "Siang",
};

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function ClassSessionsCalendar({
  year,
  month,
  onPrevMonth,
  onNextMonth,
  sessions,
  loading,
  error,
  onRetry,
  onOpenSession,
}: {
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  sessions: SessionRow[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onOpenSession: (session: SessionRow) => void;
}) {
  const isMobile = useIsMobile();
  const monthLabel = new Date(year, month - 1).toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  });

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, SessionRow[]>();
    for (const s of sessions) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return map;
  }, [sessions]);

  const days = useMemo(
    () =>
      [...sessionsByDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dateStr, daySessions]) => ({
          dateStr,
          daySessions,
          label: new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
        })),
    [sessionsByDate],
  );

  const cells = useMemo(() => {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    return arr;
  }, [year, month]);

  return (
    <>
      <PeriodStepper
        label={monthLabel}
        onPrev={onPrevMonth}
        onNext={onNextMonth}
        prevLabel="Bulan sebelumnya"
        nextLabel="Bulan berikutnya"
        className="mb-4"
        labelClassName="capitalize"
      />

      {!isMobile && <div className="mb-1 grid grid-cols-7 gap-1">
        {DAY_NAMES.map((d) => (
          <div
            key={d}
            className="py-1 text-center text-xs font-semibold text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>}

      {loading ? (
        <div className={isMobile ? "space-y-2" : "grid grid-cols-7 gap-1"}>
          {Array.from({ length: isMobile ? 6 : 35 }).map((_, i) => (
            <Skeleton key={i} className={isMobile ? "h-11 rounded-lg" : "aspect-square rounded-lg"} />
          ))}
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Gagal memuat sesi kelas.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Coba lagi
          </Button>
        </div>
      ) : (
        <>
          {isMobile ? (
            <ul className="space-y-3">
              {days.map(({ dateStr, label, daySessions }) => (
                <li key={dateStr}>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">{label}</p>
                  <div className="space-y-1">
                    {daySessions.map((s) => (
                      <Button
                        key={s.id}
                        variant="outline"
                        className="h-auto w-full justify-between gap-2 py-2 text-left font-normal"
                        onClick={() => onOpenSession(s)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{SLOT_LABELS[s.slot] ?? s.slot}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {s.teacher?.nama ?? "Belum ada guru"}
                          </span>
                        </span>
                        {s.teacherId !== s.defaultTeacherId && (
                          <Badge variant="outline" className="shrink-0">Pengganti</Badge>
                        )}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (day === null) return <div key={i} />;
                const dateStr = ymd(year, month, day);
                const daySessions = sessionsByDate.get(dateStr) ?? [];
                return (
                  <div
                    key={i}
                    className="flex aspect-square min-h-[64px] flex-col gap-0.5 overflow-hidden rounded-lg border border-border p-1"
                  >
                    <span className="text-xs font-medium text-muted-foreground">
                      {day}
                    </span>
                    {daySessions.map((s) => {
                      const isSubstitute = s.teacherId !== s.defaultTeacherId;
                      return (
                        <button
                          key={s.id}
                          onClick={() => onOpenSession(s)}
                          className="rounded-md bg-accent/60 px-1 py-0.5 text-left transition-colors hover:bg-accent"
                        >
                          <span className="block truncate text-caption font-medium text-foreground">
                            {SLOT_LABELS[s.slot] ?? s.slot}
                          </span>
                          <span className="block truncate text-caption text-muted-foreground">
                            {s.teacher?.nama ?? "Belum ada guru"}
                          </span>
                          {isSubstitute && (
                            <Badge
                              variant="outline"
                              className="mt-0.5 px-1 py-0 text-caption leading-tight"
                            >
                              Pengganti
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          {sessions.length === 0 && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Belum ada sesi kelas pada bulan ini.
            </p>
          )}
        </>
      )}
    </>
  );
}
