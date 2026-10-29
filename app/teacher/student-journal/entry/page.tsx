"use client";

import { MESSAGES } from "@/lib/feedback";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRef } from "react";
import { useSearchParams } from "next/navigation";
import { SaveStatus } from "@/components/portal/save-status";
import { Button } from "@/components/ui/button";
import { getJournalProgress, resolveTeacherDate } from "@/lib/teacher/home-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ClassDayGrid } from "@/components/student-journal/class-day-grid";
import { NoteComposeDialog } from "@/components/student-journal/note-compose-dialog";
import { DayMarkDialog } from "@/components/student-journal/day-mark-dialog";
import { isMarkableDate } from "@/lib/student-journal/day-mark-rules";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import {
  ClassBulkSheet,
  isBulkAbsenceStatus,
  type BulkAbsences,
  type BulkApply,
} from "@/components/student-journal/class-bulk-sheet";
import { CalendarOff, ListChecks, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/portal/page-header";
import { BackLink } from "@/components/portal/back-link";
import { weekStart, weekDates } from "@/lib/student-journal/week";
import {
  getJournalCellKey,
  applyJournalCellValue,
  shouldApplyJournalSaveResult,
  type GridState,
} from "@/lib/student-journal/optimistic-save";
import {
  JournalWriteCoalescer,
  KEEPALIVE_BUDGET_BYTES,
  bindFlushOnPageHide,
  type FlushBatch,
} from "@/lib/student-journal/coalesce-writes";
import {
  JOURNAL_BATCH_CHUNK,
  chunkItems,
  planBulkUndo,
  type BulkCell,
  type BulkPlan,
} from "@/lib/student-journal/bulk";

type Student = {
  id: string;
  name: string;
  nickname: string | null;
};

type Indicator = {
  id: string;
  label: string;
  order: number;
};

type Category = {
  id: string;
  name: string;
  order: number;
  indicators: Indicator[];
};

type ClassSection = {
  id: string;
  name: string;
};

type EntryRow = {
  id: string;
  studentId: string;
  indicatorId: string;
  checked: boolean;
};

/** How long the grid waits for the (optional) attendance lookup before showing without it. */
const ABSENCE_LOOKUP_MS = 3000;

/**
 * Today's Sakit/Izin/Alpa children, keyed by student id (TCHX-7). One extra
 * request, and strictly best-effort: on any failure the bulk sheet falls back
 * to selecting everyone, exactly as before.
 */
async function fetchAbsences(classId: string, date: string): Promise<BulkAbsences> {
  try {
    const res = await fetch(
      `/api/student-attendance?classSectionId=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}`,
    );
    if (!res.ok) return {};
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return {};
    const absences: BulkAbsences = {};
    for (const row of rows as Array<{ student?: { id?: string }; attendance?: { status?: string } | null }>) {
      const id = row?.student?.id;
      const status = row?.attendance?.status;
      if (id && isBulkAbsenceStatus(status)) absences[id] = status;
    }
    return absences;
  } catch {
    return {};
  }
}

export default function StudentJournalEntryPage() {
  const searchParams = useSearchParams();
  const classId = searchParams.get("classId") ?? "";
  const date = resolveTeacherDate(searchParams.get("date"), "");
  const context = `${classId}:${date}`;
  const contextToken = useMemo(() => ({context}), [context]);
  const activeContext = useRef<typeof contextToken | null>(contextToken);
  useEffect(() => { activeContext.current = contextToken; return () => { activeContext.current = null; }; }, [contextToken]);
  const sequence = useRef(0);
  const [failedCells, setFailedCells] = useState<Record<string, {studentId:string;indicatorId:string;checked:boolean}>>({});
  const [hasSaved, setHasSaved] = useState(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [classSection, setClassSection] = useState<ClassSection | null>(null);
  const [absences, setAbsences] = useState<BulkAbsences>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  /** state[studentId][indicatorId] = checked */
  const [gridState, setGridState] = useState<GridState>({});
  const gridStateRef = useRef<GridState>({});
  const confirmedGrid = useRef<GridState>({});
  const latestSaveRequestIds = useRef<Record<string, number | undefined>>({});
  const coalescerRef = useRef<JournalWriteCoalescer | null>(null);
  const [pendingCells, setPendingCells] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadRequestId = useRef(0);

  // Class-level bulk fill (TCH-7): the sheet, and the last bulk gesture so it can be undone.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkUndo, setBulkUndo] = useState<{ plan: BulkPlan; label: string } | null>(null);

  // "Hari tanpa buku penghubung": the keterangan when this class-day is marked, else null.
  const [dayMark, setDayMark] = useState<string | null>(null);
  const [dayMarkOpen, setDayMarkOpen] = useState(false);

  // Add-note dialog state + optimistic per-student note counter (resets each grid load)
  const [noteStudent, setNoteStudent] = useState<Student | null>(null);
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const noteDialogOpen = noteStudent !== null;
  const noteWeekDates = useMemo(
    () => (date ? weekDates(weekStart(date)) : []),
    [date],
  );

  const loadGrid = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!classId || !date) { setLoading(false); return; }
    setLoading(true);
    setLoadError(false);
    setFailedCells({}); setHasSaved(false); setBulkUndo(null);
    try {
    const gridFetch = fetch(
      `/api/student-journal/class-grid?classSectionId=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}`
    );
    // Started alongside the grid so it adds no latency; never rejects.
    const absencesPromise = fetchAbsences(classId, date);
    const res = await gridFetch;
    if (requestId !== loadRequestId.current) return;
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (requestId !== loadRequestId.current) return;
      toast.error(err.error || MESSAGES.loadFailed("Data kelas"));
      setLoadError(true); setLoading(false);
      return;
    }

    const { data } = await res.json();
    if (requestId !== loadRequestId.current) return;
    const loadedStudents: Student[] = data.students;
    const loadedCategories: Category[] = data.categories;
    const loadedEntries: EntryRow[] = data.entries;

    // Bounded wait: attendance is a nicety, the grid is the page.
    let lookupTimer: ReturnType<typeof setTimeout> | undefined;
    const loadedAbsences = await Promise.race([
      absencesPromise,
      new Promise<BulkAbsences>((resolve) => {
        lookupTimer = setTimeout(() => resolve({}), ABSENCE_LOOKUP_MS);
      }),
    ]);
    clearTimeout(lookupTimer);
    if (requestId !== loadRequestId.current) return;

    setAbsences(loadedAbsences);
    setStudents(loadedStudents);
    setCategories(loadedCategories);
    setClassSection(data.classSection ?? null);
    setUnreadCounts(data.unreadNoteCounts ?? {});
    setDayMark(data.dayMark?.reason ?? null);

    // Build initial grid state from pre-filled entries
    const initial: Record<string, Record<string, boolean>> = {};
    for (const student of loadedStudents) {
      initial[student.id] = {};
    }
    for (const entry of loadedEntries) {
      if (initial[entry.studentId] && loadedCategories.some(c => c.indicators.some(i => i.id === entry.indicatorId))) initial[entry.studentId][entry.indicatorId] = entry.checked;
    }
    gridStateRef.current = initial;
    confirmedGrid.current = initial;
    latestSaveRequestIds.current = {};
    setPendingCells(new Set());
    setGridState(initial);
    setLoading(false);
    } catch {
      if (requestId !== loadRequestId.current) return;
      setLoadError(true);
      toast.error(MESSAGES.loadFailed("Data kelas"));
      setLoading(false);
    }
  }, [classId, date]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGrid();
  }, [loadGrid]);

  function setGridStateNow(next: GridState) {
    gridStateRef.current = next;
    setGridState(next);
  }

  // Deliberately NOT aborted on unmount: an in-flight save finishing after the
  // teacher navigates away is exactly what makes taps survive navigation (T8).
  // Post-unmount setState calls are harmless no-ops in React 18+.
  const flushBatch = useCallback(
    async (batch: FlushBatch) => {
      // A class-level bulk fill can carry hundreds of cells. Post them in
      // bounded chunks (the endpoint caps a request), one after another, and
      // track failure per cell: a chunk that fails rolls back only its own
      // cells, and the chunks that landed stay saved.
      const failedKeys = new Set<string>();
      const postChunk = async (
        chunk: FlushBatch["entries"],
        keepalive: boolean,
      ): Promise<boolean> => {
        try {
          const res = await fetch("/api/student-journal/entries/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              classSectionId: classId,
              date,
              entries: chunk,
            }),
            ...(keepalive ? { keepalive: true } : {}),
          });
          return !res.ok;
        } catch {
          return true;
        }
      };
      const chunks = chunkItems(batch.entries, JOURNAL_BATCH_CHUNK);
      const failedChunks: FlushBatch["entries"][] = [];

      if (batch.keepalive) {
        // The page is going away (TCHX-17): nothing after the first await is
        // guaranteed to run, so fire every chunk at once with `keepalive`.
        // Browsers cap the combined keepalive body at 64KB — chunks past the
        // budget go out as ordinary requests, best effort, rather than making
        // fetch throw.
        let budget = KEEPALIVE_BUDGET_BYTES;
        const sizeOf = (chunk: FlushBatch["entries"]) =>
          JSON.stringify({ classSectionId: classId, date, entries: chunk }).length;
        const results = await Promise.all(
          chunks.map((chunk) => {
            const size = sizeOf(chunk);
            const keepalive = size <= budget;
            if (keepalive) budget -= size;
            return postChunk(chunk, keepalive).then((failed) => ({ chunk, failed }));
          }),
        );
        for (const r of results) if (r.failed) failedChunks.push(r.chunk);
      } else {
        for (const chunk of chunks) {
          if (await postChunk(chunk, false)) failedChunks.push(chunk);
        }
      }
      for (const chunk of failedChunks) {
        for (const e of chunk) failedKeys.add(getJournalCellKey(e.studentId, e.indicatorId));
      }

      if (activeContext.current !== contextToken) return;
      // Roll back every failed cell this flush carried, skipping any the
      // teacher has retapped since — that newer tap owns the cell now and is
      // already buffered for the next flush.
      if (failedKeys.size > 0) {
        let next = gridStateRef.current;
        let rolledBack = false;
        const failedNow: Record<string, { studentId: string; indicatorId: string; checked: boolean }> = {};
        for (const [cellKey, w] of batch.writes) {
          if (!failedKeys.has(cellKey)) continue;
          if (
            !shouldApplyJournalSaveResult(
              latestSaveRequestIds.current,
              cellKey,
              w.requestId,
            )
          ) {
            continue;
          }
          next = applyJournalCellValue(
            next,
            w.studentId,
            w.indicatorId,
            confirmedGrid.current[w.studentId]?.[w.indicatorId] ?? false,
          );
          failedNow[cellKey] = { studentId: w.studentId, indicatorId: w.indicatorId, checked: w.checked };
          rolledBack = true;
        }
        if (rolledBack) {
          setFailedCells((prev) => ({ ...prev, ...failedNow }));
          setGridStateNow(next);
          // One toast for the batch, not one per cell.
          toast.error("Catatan belum tersimpan. Ketuk ulang ya.");
        }
      }

      let savedAny = false;
      for (const [cellKey, w] of batch.writes) {
        if (failedKeys.has(cellKey)) continue;
        confirmedGrid.current = applyJournalCellValue(confirmedGrid.current, w.studentId, w.indicatorId, w.checked);
        savedAny = true;
      }
      if (savedAny) setHasSaved(true);
      const settled: string[] = [];
      for (const [cellKey, w] of batch.writes) {
        if (
          shouldApplyJournalSaveResult(
            latestSaveRequestIds.current,
            cellKey,
            w.requestId,
          )
        ) {
          delete latestSaveRequestIds.current[cellKey];
          settled.push(cellKey);
        }
      }
      if (settled.length > 0) {
        setPendingCells((prev) => {
          const next = new Set(prev);
          for (const key of settled) next.delete(key);
          return next;
        });
      }
    },
    [classId, date, contextToken],
  );

  // One coalescer per class-day. Rebuilding it on a date change would strand
  // buffered taps, so flush the old one first.
  useEffect(() => {
    const previous = coalescerRef.current;
    if (previous?.hasPending) void previous.flushNow();
    const coalescer = new JournalWriteCoalescer(flushBatch);
    coalescerRef.current = coalescer;
    // Closing the tab inside the 500ms window must not lose the last tap (TCHX-17).
    const unbindPageHide = bindFlushOnPageHide(coalescer);
    return () => {
      unbindPageHide();
      const c = coalescerRef.current;
      if (c?.hasPending) void c.flushNow();
    };
  }, [flushBatch]);

  function handleToggle(studentId: string, indicatorId: string) {
    const previousChecked = gridStateRef.current[studentId]?.[indicatorId] ?? false;
    setCell(studentId, indicatorId, !previousChecked);
  }

  /**
   * Mark every indicator for one student at once.
   *
   * Nine students × seven indicators is 63 taps a day; "hari ini semua lancar"
   * is the common case and cost the same as a bad day. Each cell still goes
   * through the coalescer, so the whole gesture folds into one batched request
   * and rolls back cell-by-cell exactly like individual taps — no second write
   * path to keep in sync.
   */
  function handleBulkSet(studentId: string, checked: boolean) {
    const cells: BulkCell[] = [];
    for (const category of categories) {
      for (const indicator of category.indicators) {
        const current = gridStateRef.current[studentId]?.[indicator.id] ?? false;
        if (current === checked) continue;
        cells.push({ studentId, indicatorId: indicator.id, checked });
      }
    }
    setCells(cells);
  }

  function setCell(studentId: string, indicatorId: string, checked: boolean) {
    setCells([{ studentId, indicatorId, checked }]);
  }

  /**
   * The one write path: every tap, per-student bulk, class-level bulk and undo
   * goes through here. State is updated once for the whole gesture (a class
   * fill is hundreds of cells), then each cell is buffered in the coalescer,
   * which folds the burst into chunked batch requests.
   */
  function setCells(cells: BulkCell[]) {
    if (cells.length === 0) return;
    let nextGrid = gridStateRef.current;
    const keys: string[] = [];
    const writes = cells.map(({ studentId, indicatorId, checked }) => {
      const previousChecked = nextGrid[studentId]?.[indicatorId] ?? false;
      const cellKey = getJournalCellKey(studentId, indicatorId);
      const requestId = ++sequence.current;
      latestSaveRequestIds.current[cellKey] = requestId;
      nextGrid = applyJournalCellValue(nextGrid, studentId, indicatorId, checked);
      keys.push(cellKey);
      return { studentId, indicatorId, checked, previousChecked, requestId };
    });
    setFailedCells((prev) => {
      if (keys.every((k) => !(k in prev))) return prev;
      const copy = { ...prev };
      for (const k of keys) delete copy[k];
      return copy;
    });
    setPendingCells((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
    setGridStateNow(nextGrid);

    // Buffered, not posted: a burst of taps folds into one batch request.
    // Display stays immediate — only the network call is deferred.
    for (const write of writes) coalescerRef.current?.add(write);
  }

  function applyClassBulk({ plan, checked, studentCount }: BulkApply) {
    setCells(plan.cells);
    setBulkOpen(false);
    setBulkUndo({
      plan,
      label: `${checked ? "Ditandai" : "Dikosongkan"}: ${plan.cells.length} centang untuk ${studentCount} siswa.`,
    });
  }

  function undoClassBulk() {
    if (!bulkUndo) return;
    setCells(planBulkUndo(gridStateRef.current, bulkUndo.plan));
    setBulkUndo(null);
  }

  const dateLabel = date
    ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";
  // Class first, then the day: which roster is on screen is the question a guru
  // with two classes asks, and the header answered only the second half of it.
  const headerSubtitle =
    [classSection?.name, dateLabel].filter(Boolean).join(" · ") || undefined;

  // How far along the class is, derived from live grid state rather than the
  // loaded payload — the guru is looking at this number precisely while they
  // tap, and a figure that only moved on reload would be worse than none.
  const progress = getJournalProgress({
    studentIds: students.map(s => s.id), excludedStudentIds: Object.keys(absences), dayMarkReason: dayMark, indicatorIds: categories.flatMap(c => c.indicators.map(i => i.id)),
    entries: Object.entries(gridState).flatMap(([studentId, row]) => Object.entries(row).map(([indicatorId, checked]) => ({studentId, indicatorId, checked}))),
  });
  const completeStudents = progress.completeStudents;

  const canMarkDay = Boolean(date) && isMarkableDate(date, getTodayInTimezone("Asia/Jakarta"));

  const pickerHref = `/teacher/student-journal?pick=1&classId=${encodeURIComponent(classId)}&date=${date}`;
  const changePicker = (
    <Link
      href={pickerHref}
      className="tap-target inline-flex items-center rounded-md px-3 text-xs font-medium text-primary-text transition-colors hover:bg-primary/10 active:bg-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      Ganti kelas atau tanggal
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <PageHeader title="Isi Buku Penghubung" subtitle={headerSubtitle} />
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!classId || !date) {
    return (
      <div>
        <PageHeader title="Isi Buku Penghubung" subtitle={headerSubtitle} />
        <EmptyState
          icon={Users}
          title="Kelas dan tanggal belum dipilih"
          description="Pilih kelas dan tanggal dulu untuk mengisi Buku Penghubung."
          actionLabel="Pilih kelas dan tanggal"
          actionHref="/teacher/student-journal?pick=1"
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <div><PageHeader title="Isi Buku Penghubung" subtitle={headerSubtitle} /><EmptyState
        icon={Users}
        title="Data kelas tidak bisa dimuat"
        description="Periksa koneksi, lalu coba lagi."
        actionLabel="Coba lagi"
        onAction={loadGrid}
      /></div>
    );
  }

  if (students.length === 0) {
    return (
      <div>
        <PageHeader title="Isi Buku Penghubung" subtitle={headerSubtitle} />
        <EmptyState
          icon={Users}
          title="Belum ada siswa di kelas ini"
          description="Minta admin untuk mendaftarkan siswa ke kelas ini."
        />
      </div>
    );
  }

  return (
    <div>
      <BackLink href={pickerHref} />

      <PageHeader
        title="Isi Buku Penghubung"
        subtitle={headerSubtitle}
        actions={changePicker}
      />

      <p className="-mt-4 mb-4 text-xs text-muted-foreground" data-testid="class-progress">
        {progress.configured ? `${completeStudents}/${progress.totalStudents} siswa lengkap${progress.absentCount ? ` · ${progress.absentCount} tidak hadir` : ""}` : "Indikator sekolah belum disiapkan. Hubungi admin."}
      </p>

      {progress.configured ? (
        <Button
          type="button"
          variant="outline"
          className="mb-4 min-h-11 w-full"
          data-testid="bulk-open"
          onClick={() => setBulkOpen(true)}
        >
          <ListChecks aria-hidden="true" />
          Isi cepat satu kelas
        </Button>
      ) : null}

      {dayMark ? (
        <div
          role="status"
          data-testid="day-mark-banner"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Hari tanpa buku penghubung</p>
            <p className="text-sm font-semibold [overflow-wrap:anywhere]">{dayMark}</p>
          </div>
          {canMarkDay ? (
            <Button type="button" variant="outline" className="min-h-11" data-testid="day-mark-edit" onClick={() => setDayMarkOpen(true)}>
              <Pencil aria-hidden="true" />
              Ubah
            </Button>
          ) : null}
        </div>
      ) : canMarkDay ? (
        <Button
          type="button"
          variant="ghost"
          className="mb-4 min-h-11 w-full text-muted-foreground"
          data-testid="day-mark-open"
          onClick={() => setDayMarkOpen(true)}
        >
          <CalendarOff aria-hidden="true" />
          Hari tanpa buku penghubung
        </Button>
      ) : null}

      {bulkUndo ? (
        <div
          role="status"
          data-testid="bulk-undo"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3"
        >
          <p className="min-w-0 text-sm">{bulkUndo.label}</p>
          <Button type="button" variant="outline" className="min-h-11" data-testid="bulk-undo-button" onClick={undoClassBulk}>
            Batalkan
          </Button>
        </div>
      ) : null}

      {/* Height is reserved so "Jurnal tersimpan" appearing never shifts the grid mid-tap (TCH-8). */}
      <div className="mb-4 flex min-h-6 flex-wrap items-center justify-between gap-2" data-testid="journal-save-state">
        {pendingCells.size > 0 || Object.keys(failedCells).length > 0 || hasSaved ? <>
        <SaveStatus state={Object.keys(failedCells).length > 0 ? "error" : pendingCells.size > 0 ? "saving" : "saved"} message={Object.keys(failedCells).length > 0 ? "Sebagian perubahan belum tersimpan." : pendingCells.size > 0 ? "Menyimpan jurnal…" : "Jurnal tersimpan"} />
        {Object.keys(failedCells).length > 0 ? <Button variant="outline" className="min-h-11" onClick={() => Object.values(failedCells).forEach(cell => setCell(cell.studentId, cell.indicatorId, cell.checked))}>Coba simpan lagi</Button> : null}
        </> : null}
      </div>

      <ClassDayGrid
        students={students}
        categories={categories}
        state={gridState}
        onToggle={handleToggle}
        onBulkSet={handleBulkSet}
        onAddNote={(s) => setNoteStudent(s)}
        noteCounts={noteCounts}
        unreadCounts={unreadCounts}
        pendingCells={pendingCells}
        absences={absences}
        visibleDate={date}
      />

      <ClassBulkSheet
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        students={students}
        categories={categories}
        state={gridState}
        absences={absences}
        onApply={applyClassBulk}
      />

      <DayMarkDialog
        open={dayMarkOpen}
        onOpenChange={setDayMarkOpen}
        classSectionId={classId}
        date={date}
        initialReason={dayMark}
        onSaved={setDayMark}
      />

      {noteStudent && (
        <NoteComposeDialog
          open={noteDialogOpen}
          onOpenChange={(o) => {
            if (!o) setNoteStudent(null);
          }}
          mode="create"
          studentId={noteStudent.id}
          weekDates={noteWeekDates}
          initialDate={date}
          title={`Tulis catatan untuk ${noteStudent.name}`}
          audience="teacher"
          placeholder={`Tulis catatan untuk ${noteStudent.name}…`}
          onSaved={() => {
            setNoteCounts((prev) => ({
              ...prev,
              [noteStudent.id]: (prev[noteStudent.id] ?? 0) + 1,
            }));
            setNoteStudent(null);
          }}
        />
      )}

    </div>
  );
}
