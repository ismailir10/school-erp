"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, NotebookPen, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/portal/page-header";
import { BackLink } from "@/components/portal/back-link";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurriculumElement } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import {
  LEVEL_LABEL_SHORT,
  LEVEL_CHIP_CLASS,
  LEVEL_CHIP_CLASS_OFF,
  LEVEL_ORDER,
  type Level,
} from "@/lib/curriculum/level-presentation";

const JAKARTA_TZ = "Asia/Jakarta";
const MAX_PICKED_INDICATORS = 4;

type Student = {
  id: string;
  name: string;
  nickname: string | null;
  status: string;
  // Optional: older payloads carry no class info; then no label / no filter.
  classSectionId?: string;
  className?: string;
};

type Indicator = {
  id: string;
  content: string;
  order: number;
  objective: { id: string; ageGroup: string; element: string };
};

type Entry = {
  id: string;
  studentId: string;
  indicatorId: string;
  level: Level | string;
  note: string | null;
  activity: string | null;
};

type Payload =
  | {
      ok: true;
      week: { id: string; number: number; subTheme: { name: string }; theme: { name: string } };
      center: string;
      date: string;
      ageGroup: "A" | "B";
      students: Student[];
      myClassSectionIds?: string[];
      indicators: Indicator[];
      entries: Entry[];
      lastActivity: string | null;
      writable: boolean;
    }
  | { ok: false; status: number; error: string; reason?: string };

type Cell = { level: Level | null; note: string };

function cellKey(studentId: string, indicatorId: string): string {
  return `${studentId}::${indicatorId}`;
}

export function CenterSessionClient({
  center,
  centerLabel,
}: {
  center: string;
  centerLabel: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState<string>(() =>
    getTodayInTimezone(JAKARTA_TZ),
  );
  const [ageGroup, setAgeGroup] = useState<"A" | "B">("A");
  const [activity, setActivity] = useState<string>("");
  const [pickedIndicatorIds, setPickedIndicatorIds] = useState<string[]>([]);
  const [cells, setCells] = useState<Map<string, Cell>>(new Map());
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  // R2-T-7: the roster is every same-age child in the school. Default to the
  // teacher's own class(es); view state only, never marks the form dirty.
  const [showAllClasses, setShowAllClasses] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const loadRequestId = useRef(0);
  // TCHX-3: set by any teacher edit (activity, IKTP pick, level, note), cleared
  // when a payload hydrates or a save succeeds. Drives the leave guard and the
  // date / age-group confirm below.
  const [dirty, setDirty] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const guard = useUnsavedChangesGuard(dirty);
  const today = getTodayInTimezone(JAKARTA_TZ);

  // Fetch payload whenever date/ageGroup changes.
  useEffect(() => {
    let cancelled = false;
    const requestId = ++loadRequestId.current;
    async function load() {
      setLoading(true);
      // Reset session-scoped state before fetching so stale picks from a
      // previous (date, ageGroup) pair don't bleed into the new payload.
      // Indicators differ across ageGroups (and across weeks for date
      // changes); without this reset the roster grid silently goes empty
      // because the new payload's indicators don't match the old IDs.
      setPickedIndicatorIds([]);
      setCells(new Map());
      setOpenNotes(new Set());
      setDirty(false);
      try {
        const res = await fetch(
          `/api/teacher/assessment-entries/center/${center}?date=${date}&ageGroup=${ageGroup}`,
        );
        const body = await res.json();
        if (cancelled || requestId !== loadRequestId.current) return;
        if (!res.ok) {
          setPayload({
            ok: false,
            status: res.status,
            error: body.error ?? "Gagal memuat data sentra.",
            reason: body.reason,
          });
        } else {
          setPayload({ ok: true, ...body });
          // Hydrate cells + activity from existing entries (shared activity
          // for all entries in a session). When no entries yet, fall back to
          // lastActivity (server-supplied prefill) or keep the user's draft.
          const next = new Map<string, Cell>();
          const picked = new Set<string>();
          for (const e of body.entries as Entry[]) {
            picked.add(e.indicatorId);
            next.set(cellKey(e.studentId, e.indicatorId), {
              level: e.level as Level,
              note: e.note ?? "",
            });
          }
          setCells(next);
          setPickedIndicatorIds((curr) =>
            curr.length > 0 ? curr : Array.from(picked).slice(0, MAX_PICKED_INDICATORS),
          );
          setActivity((curr) => curr || body.lastActivity || "");
        }
      } catch (err) {
        if (cancelled || requestId !== loadRequestId.current) return;
        setPayload({
          ok: false,
          status: 0,
          error:
            userMessage(err, "Tidak bisa terhubung ke server."),
        });
      } finally {
        if (!cancelled && requestId === loadRequestId.current) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [center, date, ageGroup, reloadKey]);

  /**
   * Changing date or age group reloads the grid and drops every unsaved pick,
   * so with unsaved work it asks first (same wording family as the leave guard).
   */
  function switchGrid(apply: () => void): void {
    if (dirty) setPendingSwitch(() => apply);
    else apply();
  }

  function handleDateChange(value: string): void {
    // A future day cannot be assessed and would load a future week (TCHX-12).
    // `max` stops the native picker; this covers typed input. An empty value
    // (field cleared mid-typing) keeps the current date.
    if (!value || value > today || value === date) return;
    switchGrid(() => setDate(value));
  }

  function handleAgeGroupChange(next: "A" | "B"): void {
    if (next === ageGroup) return;
    switchGrid(() => setAgeGroup(next));
  }

  const indicators = useMemo(() => (payload?.ok ? payload.indicators : []), [payload]);
  const students = useMemo(() => (payload?.ok ? payload.students : []), [payload]);
  const isWritable = payload?.ok && payload.writable;
  const myClassIds = useMemo(
    () => new Set(payload?.ok ? (payload.myClassSectionIds ?? []) : []),
    [payload],
  );
  // The class filter only means something when the teacher has a class and the
  // roster actually has children outside it.
  const hasClassFilter =
    myClassIds.size > 0 &&
    students.some((s) => !s.classSectionId || !myClassIds.has(s.classSectionId));
  const visibleStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return students.filter((s) => {
      if (hasClassFilter && !showAllClasses && !(s.classSectionId && myClassIds.has(s.classSectionId))) {
        return false;
      }
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.nickname?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [students, hasClassFilter, showAllClasses, myClassIds, studentQuery]);

  function handleAgeGroupKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ): void {
    const values: Array<"A" | "B"> = ["A", "B"];
    const currentIndex = values.indexOf(ageGroup);
    let nextIndex = currentIndex;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % values.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + values.length) % values.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = values.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = values[nextIndex]!;
    handleAgeGroupChange(next);
    event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelector<HTMLInputElement>(`input[value="${next}"]`)
      ?.focus();
  }

  /**
   * Arrow / Home / End for the level radiogroup. These are `role="radio"`
   * buttons rather than native inputs, so nothing gave them keyboard semantics
   * — every chip was its own tab stop and the arrow keys did nothing, while the
   * walas page one tap away had the full roving-tabindex behaviour.
   */
  function handleLevelKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    studentId: string,
    indicatorId: string,
    currentLevel: Level | null,
  ): void {
    const currentIndex = currentLevel ? LEVEL_ORDER.indexOf(currentLevel) : -1;
    let nextIndex = currentIndex;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % LEVEL_ORDER.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex =
          currentIndex === -1
            ? LEVEL_ORDER.length - 1
            : (currentIndex - 1 + LEVEL_ORDER.length) % LEVEL_ORDER.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = LEVEL_ORDER.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = LEVEL_ORDER[nextIndex]!;
    setCellLevel(studentId, indicatorId, next);
    event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelector<HTMLButtonElement>(`button[data-level="${next}"]`)
      ?.focus();
  }

  const pickedIndicators = useMemo(
    () => indicators.filter((i) => pickedIndicatorIds.includes(i.id)),
    [indicators, pickedIndicatorIds],
  );

  /** Why Simpan is disabled, in the teacher's words. `null` = it is enabled. */
  const saveBlockedReason: string | null =
    pickedIndicators.length === 0
      ? "Pilih minimal satu IKTP dulu."
      : !activity.trim()
        ? "Isi kegiatan dulu."
        : null;

  function toggleIndicator(id: string): void {
    setDirty(true);
    setPickedIndicatorIds((curr) => {
      if (curr.includes(id)) return curr.filter((x) => x !== id);
      if (curr.length >= MAX_PICKED_INDICATORS) {
        toast.error(`Maksimum ${MAX_PICKED_INDICATORS} IKTP per sesi.`);
        return curr;
      }
      return [...curr, id];
    });
  }

  function setCellLevel(
    studentId: string,
    indicatorId: string,
    level: Level,
  ): void {
    const key = cellKey(studentId, indicatorId);
    setDirty(true);
    setCells((curr) => {
      const next = new Map(curr);
      const existing = next.get(key);
      next.set(key, { level, note: existing?.note ?? "" });
      return next;
    });
  }

  function setCellNote(
    studentId: string,
    indicatorId: string,
    note: string,
  ): void {
    const key = cellKey(studentId, indicatorId);
    setDirty(true);
    setCells((curr) => {
      const next = new Map(curr);
      const existing = next.get(key);
      next.set(key, { level: existing?.level ?? null, note });
      return next;
    });
  }

  function toggleNoteOpen(key: string): void {
    setOpenNotes((curr) => {
      const next = new Set(curr);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save(): Promise<void> {
    if (!payload?.ok || !payload.writable) return;
    if (!activity.trim()) {
      toast.error("Isi kegiatan dulu sebelum menyimpan.");
      return;
    }
    const entries: Array<{
      studentId: string;
      indicatorId: string;
      level: Level;
      note?: string;
    }> = [];
    for (const student of students) {
      for (const indicator of pickedIndicators) {
        const cell = cells.get(cellKey(student.id, indicator.id));
        if (!cell?.level) continue;
        entries.push({
          studentId: student.id,
          indicatorId: indicator.id,
          level: cell.level,
          note: cell.note?.trim() ? cell.note.trim() : undefined,
        });
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/teacher/assessment-entries/center", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          center,
          date,
          activity: activity.trim(),
          entries,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body.error ?? "Gagal menyimpan sesi sentra.");
      }
      const body = await res.json();
      toast.success(`Penilaian tersimpan · ${body.written} entri`);
      setDirty(false);
      router.refresh();
    } catch (err) {
      const message = userMessage(
        err,
        "Gagal menyimpan sesi sentra. Coba lagi sebentar ya.",
      );
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <BackLink href="/teacher/assessments" />

      <PageHeader
        title={centerLabel}
        // The payload has carried `week` all along and never rendered it, so a
        // teacher could not tell which pekan or tema a sentra session belonged
        // to. Falls back to the generic line while the first fetch is in flight.
        subtitle={
          payload?.ok
            ? `Penilaian harian · pekan ${payload.week.number} · tema ${payload.week.theme.name}`
            : "Penilaian harian sentra"
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="center-date" required>
            Tanggal
          </FieldLabel>
          {/*
            Deliberately NOT disabled on a read-only session. Disabling it made
            the read-only state a trap: the only control that could move you to
            a writable date was the one the read-only state switched off.
          */}
          <Input
            id="center-date"
            data-testid="center-date"
            className="tap-target"
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            max={today}
            required
          />
        </Field>
        <Field>
          <FieldLabel>
            Kelompok usia
          </FieldLabel>
          <div
            className="grid grid-cols-2 gap-2"
            role="radiogroup"
            aria-label="Kelompok usia"
          >
            {(["A", "B"] as const).map((g) => (
              <label
                key={g}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-center rounded-lg border text-sm transition-colors",
                  "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2",
                  ageGroup === g
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground border-input",
                )}
              >
                <input
                  className="sr-only"
                  type="radio"
                  name="center-age-group"
                  value={g}
                  checked={ageGroup === g}
                  onChange={() => handleAgeGroupChange(g)}
                  onKeyDown={handleAgeGroupKeyDown}
                  data-testid={`agegroup-${g}`}
                  aria-label={`TK ${g}`}
                />
                TK {g}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="center-activity" required>
          Kegiatan
        </FieldLabel>
        <Input
          id="center-activity"
          data-testid="center-activity"
          className="tap-target"
          type="text"
          value={activity}
          onChange={(e) => {
            setActivity(e.target.value);
            setDirty(true);
          }}
          disabled={!isWritable}
          maxLength={200}
          placeholder="Doa pagi dan asmaul husna"
          required
        />
      </Field>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : payload && !payload.ok ? (
        payload.reason === "no_active_week" ? (
          // Expected state (weekend, holiday, before the first Pekan), not a
          // failure: say it once and offer no retry — only another date helps.
          <div role="status">
            <EmptyState
              icon={CalendarOff}
              title="Belum ada pekan aktif untuk tanggal ini"
              description="Pilih hari sekolah lain. Bila hari ini hari sekolah, minta admin menyiapkan pekan belajarnya."
            />
          </div>
        ) : (
          <div role="alert" className="space-y-3">
            <EmptyState
              icon={CalendarOff}
              title="Tidak bisa memuat sentra"
              description={payload.error}
            />
            <Button
              type="button"
              variant="outline"
              className="tap-target"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Coba lagi
            </Button>
          </div>
        )
      ) : (
        <>
          {!isWritable && (
            <p
              role="status"
              className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            >
              Sesi ini hanya bisa dilihat. Ganti tanggal untuk mengisi penilaian baru.
            </p>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Pilih indikator ketercapaian (IKTP) — maksimal {MAX_PICKED_INDICATORS}
            </p>
            {indicators.length === 0 ? (
              <EmptyState
                icon={NotebookPen}
                title="Belum ada IKTP untuk tema pekan ini"
                description="Hubungi admin agar indikator ketercapaian dihubungkan ke tema pekan ini."
              />
            ) : (
              <ul className="space-y-1.5" data-testid="center-indicator-picker">
                {indicators.map((ind) => {
                  const picked = pickedIndicatorIds.includes(ind.id);
                  return (
                    <li key={ind.id}>
                      <button
                        type="button"
                        onClick={() => toggleIndicator(ind.id)}
                        aria-pressed={picked}
                        disabled={!isWritable}
                        className={cn(
                          "tap-target w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                          "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          picked
                            // text-primary-text, not text-primary: the brand teal
                            // is a fill colour and measures 2.24:1 on this tint.
                            ? "border-primary bg-primary/10 text-primary-text"
                            : "border-input bg-background text-foreground",
                        )}
                      >
                        <span className="block font-medium">
                          {formatCurriculumElement(ind.objective.element)}
                        </span>
                        <span className="block text-muted-foreground">
                          {ind.content}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {pickedIndicators.length > 0 && students.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="search"
                className="tap-target sm:flex-1"
                data-testid="center-student-search"
                aria-label="Cari nama siswa"
                placeholder="Cari nama siswa"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
              />
              {hasClassFilter && (
                <Button
                  type="button"
                  variant={showAllClasses ? "default" : "outline"}
                  className="tap-target"
                  aria-pressed={showAllClasses}
                  data-testid="center-all-classes"
                  onClick={() => setShowAllClasses((v) => !v)}
                >
                  Semua kelas
                </Button>
              )}
            </div>
          )}

          {pickedIndicators.length > 0 &&
            students.length > 0 &&
            visibleStudents.length === 0 && (
              <p role="status" className="text-sm text-muted-foreground" data-testid="center-no-match">
                {studentQuery.trim()
                  ? "Tidak ada siswa dengan nama itu."
                  : "Belum ada siswa dari kelas Anda di kelompok usia ini. Ketuk “Semua kelas” untuk melihat semuanya."}
              </p>
            )}

          {pickedIndicators.length > 0 && visibleStudents.length > 0 && (
            <ul className="space-y-3" data-testid="center-roster">
              {visibleStudents.map((student) => (
                <li
                  key={student.id}
                  className="space-y-2 rounded-lg border border-input p-3"
                  data-testid={`center-row-${student.id}`}
                >
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    {student.name}
                    {student.className && (
                      <span
                        className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground"
                        data-testid={`center-class-${student.id}`}
                      >
                        {student.className}
                      </span>
                    )}
                  </p>
                  <ul className="space-y-2">
                    {pickedIndicators.map((ind) => {
                      const key = cellKey(student.id, ind.id);
                      const cell = cells.get(key);
                      const level = cell?.level ?? null;
                      const noteOpen = openNotes.has(key);
                      return (
                        <li key={ind.id} className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            {ind.content}
                          </p>
                          <div
                            className="grid grid-cols-3 gap-2"
                            role="radiogroup"
                            aria-label={`Tingkat ${student.name} pada ${ind.content}`}
                          >
                            {LEVEL_ORDER.map((lv) => {
                              const isActive = level === lv;
                              return (
                                <button
                                  key={lv}
                                  type="button"
                                  role="radio"
                                  data-level={lv}
                                  aria-checked={isActive}
                                  // Roving tabindex: one tab stop per group,
                                  // arrows move within it.
                                  tabIndex={
                                    isActive || (!level && lv === LEVEL_ORDER[0]) ? 0 : -1
                                  }
                                  onClick={() =>
                                    setCellLevel(student.id, ind.id, lv)
                                  }
                                  onKeyDown={(event) =>
                                    handleLevelKeyDown(event, student.id, ind.id, level)
                                  }
                                  disabled={!isWritable}
                                  aria-label={`${LEVEL_LABEL_SHORT[lv]} untuk ${student.name}`}
                                  className={cn(
                                    // 26px before. Same control as the walas
                                    // page, same 44px floor.
                                    "flex min-h-11 items-center justify-center rounded-md border px-1 text-sm font-medium transition-colors",
                                    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                    isActive ? LEVEL_CHIP_CLASS[lv] : LEVEL_CHIP_CLASS_OFF[lv],
                                  )}
                                >
                                  {LEVEL_LABEL_SHORT[lv]}
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNoteOpen(key)}
                            disabled={!isWritable}
                            aria-expanded={noteOpen}
                            className="tap-target inline-flex items-center rounded-md px-2 -ml-2 text-xs text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {noteOpen ? "Sembunyikan catatan" : "Tambah catatan"}
                          </button>
                          {!isWritable && cell?.note && (
                            <p className="rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                              Catatan: {cell.note}
                            </p>
                          )}
                          {noteOpen && (
                            <Textarea
                              value={cell?.note ?? ""}
                              onChange={(e) =>
                                setCellNote(student.id, ind.id, e.target.value)
                              }
                              disabled={!isWritable}
                              maxLength={500}
                              rows={2}
                              placeholder="Catatan singkat (opsional)"
                              className="text-xs"
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {pickedIndicators.length === 0 && indicators.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Pilih minimal satu IKTP di atas untuk mulai menilai.
            </p>
          )}

          {students.length === 0 && (
            <EmptyState
              icon={Users}
              title={`Belum ada siswa TK ${ageGroup}`}
              description="Belum ada siswa kelompok usia ini yang terdaftar pada tahun ajaran aktif."
            />
          )}
        </>
      )}

      {isWritable && (
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-page-x border-t border-border bg-background px-page-x py-3 supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur">
        <Button
          type="button"
          onClick={save}
          disabled={saving || loading || !payload?.ok || !!saveBlockedReason}
          className="tap-target w-full"
          data-testid="center-save"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" /> Menyimpan…
            </>
          ) : (
            <>
              <Save className="mr-2 size-4" /> Simpan
            </>
          )}
        </Button>
        {/*
          A disabled primary action with no stated reason. The explanation
          existed, but as italic body text ~900px further up the scroll — so
          the teacher saw a greyed Simpan and nothing else.
        */}
        {saveBlockedReason && !saving ? (
          <p className="mt-2 text-center text-xs text-muted-foreground" role="status">
            {saveBlockedReason}
          </p>
        ) : null}
      </div>
      )}

      <ConfirmDialog
        open={guard.confirmOpen}
        onOpenChange={(open) => {
          if (!open) guard.stay();
        }}
        title="Keluar tanpa menyimpan?"
        description="Kegiatan dan tingkat yang belum disimpan akan hilang."
        confirmLabel="Keluar tanpa menyimpan"
        cancelLabel="Tetap di sini"
        destructive
        onConfirm={guard.confirmLeave}
      />
      <ConfirmDialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwitch(null);
        }}
        title="Ganti tanpa menyimpan?"
        description="Penilaian yang belum disimpan akan hilang jika Anda mengganti tanggal atau kelompok usia."
        confirmLabel="Ganti tanpa menyimpan"
        cancelLabel="Tetap di sini"
        destructive
        onConfirm={() => {
          const apply = pendingSwitch;
          setPendingSwitch(null);
          apply?.();
        }}
      />
    </div>
  );
}
