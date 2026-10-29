"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WeekGrid } from "@/components/portal/week-grid";
import { WeekNavigator } from "@/components/portal/week-navigator";
import { BackLink } from "@/components/portal/back-link";
import { PageHeader } from "@/components/portal/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NoteThreadPanel } from "@/components/student-journal/note-thread-panel";
import { NoteComposeDialog } from "@/components/student-journal/note-compose-dialog";
import { NoteDeleteDialog } from "@/components/student-journal/note-delete-dialog";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { BookHeart, Plus } from "lucide-react";
import { toast } from "sonner";
import { weekStart } from "@/lib/student-journal/week";
import { JOURNAL_FORBIDDEN_MSG } from "@/lib/student-journal/messages";
import Link from "next/link";
import { formatDate, formatWeekRangeLabel } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { resolveTeacherDate } from "@/lib/teacher/home-progress";
import { computeDefaultNoteDate } from "./note-date";

type Indicator = { id: string; label: string; order: number };
type Category = { id: string; name: string; scope: string; indicators: Indicator[] };
type Entry = {
  id?: string;
  indicatorId: string;
  date: string;
  checked: boolean;
  lastAdminEdit?: { changedAt: string; changedByName: string } | null;
};
type Note = {
  id: string;
  date: string;
  authorRole: string;
  authorUserId?: string;
  authorName?: string;
  body: string;
  createdAt: string;
};

type Student = {
  id: string;
  name: string;
  nickname: string | null;
  classNames: string[];
  /** Active class sections, with ids — the jump into the fill grid needs one. */
  classes?: Array<{ id: string; name: string }>;
};

type WeekData = {
  weekStart: string;
  dates: string[];
  /** Null when the payload carries no identity — the grid still renders. */
  student?: Student | null;
  categories: Category[];
  entries: Entry[];
  /** The wali's "Di rumah" checklist for the same week — read-only here (X-5). */
  homeCategories?: Category[];
  homeEntries?: Entry[];
  notes: Note[];
  /** `YYYY-MM-DD → keterangan` for class-days marked "tanpa buku penghubung". */
  dayMarks?: Record<string, string>;
};

/** "Abdullah · DCARE" — nickname first (what the guru actually calls them), class second. */
function studentSubtitle(student: Student): string | undefined {
  const parts = [student.nickname?.trim(), student.classNames.join(" · ")].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  return formatWeekRangeLabel(dates[0], dates[dates.length - 1]);
}

export default function TeacherStudentWeekPage() {
  const { id: studentId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const today = getTodayInTimezone("Asia/Jakarta");
  // Honor `?week=YYYY-MM-DD` from the entry-grid chevron so the week view
  // opens scoped to the picker's selected date (UAT 2026-05-01 cycle T2).
  const initialAnchor = resolveTeacherDate(searchParams.get("week"), today);
  const [ws, setWs] = useState<string>(() => weekStart(initialAnchor));
  const [data, setData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestId = useRef(0);

  // Note composer: create, or edit one of the teacher's own notes (X-4)
  const [noteDialog, setNoteDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; noteId: string; date: string; body: string }
    | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Bumped after a save so the thread refetches from its first page.
  const [noteReloadToken, setNoteReloadToken] = useState(0);
  const [noteDate, setNoteDate] = useState(today);

  const loadWeek = useCallback(async (weekStartYmd: string) => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/student-journal/students/${studentId}/week?weekStart=${weekStartYmd}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string }));
        // Prefer server JSON body; fall back to the Indonesian remediation copy on 403
        // (UAT 2026-05-01 — raw "Forbidden" toast was unhelpful to Bu Sari).
        const fallback = res.status === 403 ? JOURNAL_FORBIDDEN_MSG : "Gagal memuat data";
        throw new ApiError((err as { error?: string }).error || fallback);
      }
      const json = await res.json();
      if (requestId !== loadRequestId.current) return;
      setData(json.data);
    } catch (error) {
      if (requestId !== loadRequestId.current) return;
      const message = userMessage(error, "Gagal memuat data");
      setLoadError(message);
      toast.error(message);
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    loadWeek(ws);
  }, [loadWeek, ws]);

  // Who am I — edit/delete are offered on the teacher's own notes only. The API
  // enforces authorship (403); this only decides whether to show the controls.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { id?: string } | null) => {
        if (json?.id) setCurrentUserId(json.id);
      })
      .catch(() => {
        // Non-fatal: without an id the controls simply do not render.
      });
  }, []);

  function prevWeek() {
    setWs((prev) => addDays(prev, -7));
  }

  function nextWeek() {
    setWs((prev) => addDays(prev, 7));
  }

  const weekLabel = data ? formatWeekLabel(data.dates) : "";
  const isCurrentWeek = ws === weekStart(today);

  const student = data?.student;

  // Which day the jump fills: today when the current week is on screen,
  // otherwise the last school day of the week being viewed — the day a guru
  // paging back is most likely to be fixing.
  const fillDate = isCurrentWeek ? today : (data?.dates?.[data.dates.length - 1] ?? null);
  const fillClassId = student?.classes?.[0]?.id ?? null;
  const fillHref =
    fillClassId && fillDate
      ? `/teacher/student-journal/entry?classId=${fillClassId}&date=${fillDate}`
      : null;
  const fillDayLabel = isCurrentWeek
    ? "hari ini"
    : fillDate
      ? formatDate(fillDate, { day: "numeric", month: "short" })
      : "";

  const showNotesFirst = searchParams.get("view") === "notes";
  const notesSection = (
          <section id="catatan" className="my-6" aria-label="Catatan siswa">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-h2">Catatan</h2>
              <Button
                size="sm"
                variant="outline"
                className="tap-target"
                onClick={() => {
                  setNoteDate(computeDefaultNoteDate(ws, today));
                  setNoteDialog({ mode: "create" });
                }}
              >
                <Plus size={14} className="mr-1" aria-hidden="true" />
                Tambah catatan
              </Button>
            </div>
            <NoteThreadPanel
              studentId={studentId}
              audience="teacher"
              reloadToken={noteReloadToken}
              canEdit={(note) =>
                note.authorRole === "TEACHER" &&
                !!currentUserId &&
                note.authorUserId === currentUserId
              }
              onEdit={(noteId, n) =>
                setNoteDialog({ mode: "edit", noteId, date: n.date, body: n.body })
              }
              onDelete={(noteId) => setDeleteTarget(noteId)}
            />
          </section>
  );

  return (
    <div>
      <BackLink href="/teacher/student-journal" className="mb-4" />

      {/*
        The page used to open on a bare week grid: no name, no nickname, no
        class. A guru arriving from the class grid's chevron — or from a link in
        chat — had no way to tell whose penghubung was on screen. Identity comes
        from the same week payload, so it appears as soon as the week resolves.
      */}
      {student ? (
        <PageHeader title={student.name} subtitle={studentSubtitle(student)} />
      ) : loading ? (
        <div className="mb-6 space-y-2">
          <Skeleton className="h-7 w-48 rounded-md" />
          <Skeleton className="h-4 w-32 rounded-md" />
        </div>
      ) : <PageHeader title="Buku Penghubung siswa" />}

      {/*
        Was a hand-rolled navigator with "Minggu sebelumnya"/"Minggu berikutnya"
        labels and a static "Minggu ini" caption above the range — so a teacher
        paging back three weeks still read "this week". Shared control now, and
        the caption is derived instead of asserted.
      */}
      {!loading && !loadError && showNotesFirst ? notesSection : null}
      <WeekNavigator
        className="mb-4"
        label={
          weekLabel
            ? isCurrentWeek
              ? `${weekLabel} · pekan ini`
              : weekLabel
            : ws
        }
        onPrev={prevWeek}
        onNext={nextWeek}
        // A journal week in the future holds nothing by construction: WeekGrid
        // locks future cells and the picker caps at today. Paging into one was
        // possible all the way into 2027 and looked exactly like an unfilled
        // real week.
        nextDisabled={isCurrentWeek}
        onToday={isCurrentWeek ? undefined : () => setWs(weekStart(today))}
      />

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          icon={BookHeart}
          title="Data penghubung tidak bisa dimuat"
          // `loadError` already ends in a period, so the old
          // "{loadError}. Coba lagi" rendered "…kelas aktif.. Coba lagi".
          description={loadError.replace(/\.$/, "")}
          actionLabel="Coba lagi"
          onAction={() => loadWeek(ws)}
        />
      ) : (
        <>
          {/*
            Read-only stays read-only, but "read-only" used to mean "go back to
            the picker and retype the date" for a guru who spotted a missed day
            here. The jump carries the class and the day with it.
          */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Riwayat penghubung — hanya bisa dilihat di sini
            </p>
            {fillHref ? (
              <Link
                href={fillHref}
                data-testid="fill-day-link"
                className="tap-target inline-flex items-center rounded-md px-3 text-xs font-medium text-primary-text transition-colors hover:bg-primary/10 active:bg-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Isi {fillDayLabel}
              </Link>
            ) : null}
          </div>
          <WeekGrid
            categories={data?.categories ?? []}
            entries={data?.entries ?? []}
            dates={data?.dates ?? []}
            dayMarks={data?.dayMarks}
            emptyWeekMessage="Belum ada centang di pekan ini."
          />

          {/*
            What the wali ticked at home. The parent tab tells her it is there
            "to help Ustadzah keep an eye on ibadah and routines at home", and
            until now the class teacher could not see it (X-5). Read-only: the
            teacher records the school day, never the home one.
          */}
          {(data?.homeCategories?.length ?? 0) > 0 ? (
            <section className="mt-6" aria-label="Di rumah" data-testid="home-section">
              <h2 className="text-h2">Di rumah</h2>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">
                Diisi wali murid di rumah — hanya bisa dilihat di sini.
              </p>
              <WeekGrid
                categories={data?.homeCategories ?? []}
                entries={data?.homeEntries ?? []}
                dates={data?.dates ?? []}
                emptyWeekMessage="Belum ada centang dari wali di pekan ini."
                featureLabel="Di rumah"
              />
            </section>
          ) : null}

          {/*
            The thread is NOT week-scoped, unlike the grid above it: a catatan
            is a message, and it used to vanish the Monday after it was written
            because this section read `weekData.notes`.
          */}
          {!showNotesFirst ? notesSection : null}
        </>
      )}

      <NoteComposeDialog
        open={noteDialog !== null}
        onOpenChange={(open) => {
          if (!open) setNoteDialog(null);
        }}
        mode={noteDialog?.mode ?? "create"}
        studentId={studentId}
        weekDates={data?.dates ?? [noteDate]}
        initialDate={noteDialog?.mode === "edit" ? noteDialog.date : noteDate}
        initialBody={noteDialog?.mode === "edit" ? noteDialog.body : undefined}
        noteId={noteDialog?.mode === "edit" ? noteDialog.noteId : undefined}
        title={
          noteDialog?.mode === "edit"
            ? "Ubah catatan"
            : student
              ? `Tambah catatan untuk ${student.name}`
              : "Tambah catatan"
        }
        audience="teacher"
        placeholder="Tulis catatan di sini…"
        onSaved={() => {
          setNoteDialog(null);
          setNoteDate(computeDefaultNoteDate(ws, today));
          setNoteReloadToken((n) => n + 1);
        }}
      />

      <NoteDeleteDialog
        noteId={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => setNoteReloadToken((n) => n + 1)}
      />
    </div>
  );
}
