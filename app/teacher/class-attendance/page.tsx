"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { Users, Check } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/portal/page-header";
import { SaveStatus } from "@/components/portal/save-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { resolveTeacherDate } from "@/lib/teacher/home-progress";
import { failureFromError, fetchOrDescribe, type FetchFailure } from "@/lib/teacher/fetch-error-copy";
import { toastError } from "@/lib/feedback";

type Assignment = {
  id: string;
  classSection: { id: string; name: string; status?: string; academicYear?: {status: string}; program: { name: string }; campus: { name: string }; _count: { enrollments: number } };
};

type StudentRecord = {
  student: { id: string; name: string; nickname: string | null; gender: string | null };
  attendance: { status: string; notes: string | null } | null;
};

// Prisma enum values — do NOT translate in code, only display labels.
// Rapor order and letters: H · S · I · A.
type Status = "PRESENT" | "SICK" | "PERMISSION" | "ABSENT";
const OPTIONS: { status: Status; letter: string; label: string }[] = [
  { status: "PRESENT", letter: "H", label: "Hadir" },
  { status: "SICK", letter: "S", label: "Sakit" },
  { status: "PERMISSION", letter: "I", label: "Izin" },
  { status: "ABSENT", letter: "A", label: "Alpa" },
];
const STATUSES = OPTIONS.map((o) => o.status);

// Selected option fill via status tokens (no inline hex)
const SELECTED: Record<Status, string> = {
  PRESENT: "border-transparent bg-status-present text-white",
  SICK: "border-transparent bg-status-late text-white",
  PERMISSION: "border-transparent bg-status-leave text-white",
  ABSENT: "border-transparent bg-destructive text-white",
};

// Recorded rows carry a subtle tint of their status (portal.md); unknown stays plain.
const ROW_TINT: Record<Status, string> = {
  PRESENT: "bg-[color:var(--status-present-subtle)]",
  SICK: "bg-[color:var(--status-late-subtle)]",
  PERMISSION: "bg-[color:var(--status-leave-subtle)]",
  ABSENT: "bg-[color:var(--status-absent-subtle)]",
};

const SUMMARY_TONE: Record<Status, string> = {
  PRESENT: "text-status-present-text",
  SICK: "text-status-late-text",
  PERMISSION: "text-status-leave-text",
  ABSENT: "text-status-absent-text",
};

/**
 * A class cannot be marked ahead of time (the mark route rejects it), so the
 * page never offers a future day: it used to let the teacher pick one, tap a
 * status, and only then fail with a "Coba lagi" that could never succeed
 * (TCH-9). A future `?date=` is pulled back to today for the same reason.
 */
function clampToToday(ymd: string, today: string) {
  return ymd > today ? today : ymd;
}

/** A session that expired can only be fixed by signing in again, so offer that instead of a retry that cannot succeed. */
function SignInAgain({ className }: { className?: string }) {
  return <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "min-h-11", className)}>Masuk lagi</Link>;
}

export default function ClassAttendancePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedClass = searchParams?.get("classId") ?? "";
  const requestedDate = searchParams?.get("date") ?? "";
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedClass, setSelectedClass] = useState("");
  const todayYmd = getTodayInTimezone("Asia/Jakarta");
  const [date, setDate] = useState(clampToToday(resolveTeacherDate(requestedDate, todayYmd), todayYmd));
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [lastLoadedCount, setLastLoadedCount] = useState(10);
  const [assignmentsError, setAssignmentsError] = useState<FetchFailure | null>(null);
  const [rosterError, setRosterError] = useState<FetchFailure | null>(null);
  const rosterRequestId = useRef(0);
  const assignmentRequestId = useRef(0);
  const context = `${selectedClass}:${date}`;
  const contextToken = useMemo(() => ({context}), [context]);
  const activeContext = useRef<typeof contextToken | null>(contextToken);
  useEffect(() => { activeContext.current = contextToken; return () => { activeContext.current = null; }; }, [contextToken]);
  const confirmed = useRef<Record<string, Status>>({});
  const [confirmedStatuses, setConfirmedStatuses] = useState<Record<string, Status>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, FetchFailure>>({});
  const [failedIntents, setFailedIntents] = useState<Record<string, Status>>({});
  const saveOperationIds = useRef<Record<string, number>>({});
  const saveQueues = useRef<Record<string, Promise<void> | undefined>>({});

  const loadAssignments = useCallback(async () => {
    const requestId = ++assignmentRequestId.current;
    setLoading(true); setAssignmentsError(null);
    try {
      const res = await fetchOrDescribe("/api/teaching-assignments/my", undefined, "dimuat");
      const data = await res.json();
      if (requestId !== assignmentRequestId.current) return;
      setAssignments(data);
      if (data.length > 0) {
        const validRequestedClass = data.some((a: Assignment) => a.classSection.id === requestedClass);
        const nextClass = validRequestedClass ? requestedClass : (data.find((a: Assignment) => a.classSection.status === "ACTIVE" && a.classSection.academicYear?.status === "ACTIVE") ?? data[0]).classSection.id;
        const today = getTodayInTimezone("Asia/Jakarta");
        const nextDate = clampToToday(resolveTeacherDate(requestedDate, today), today);
        setSelectedClass(nextClass); setDate(nextDate);
        if (nextClass !== requestedClass || nextDate !== requestedDate) router.replace(`/teacher/class-attendance?classId=${encodeURIComponent(nextClass)}&date=${nextDate}`, {scroll:false});
      }
    } catch (error) {
      if (requestId !== assignmentRequestId.current) return;
      const failure = failureFromError(error, "dimuat");
      setAssignmentsError(failure);
      toast.error(failure.message);
    } finally { if (requestId === assignmentRequestId.current) setLoading(false); }
  }, [requestedClass, requestedDate, router]);

  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  // Load students when class or date changes
  const loadStudents = useCallback(async () => {
    if (!selectedClass) return;
    const requestId = ++rosterRequestId.current;
    setLoadingRoster(true);
    setSaveState({}); setBulkError(null); setFailedIntents({}); setSaveErrors({}); setConfirmedStatuses({});
    setRosterError(null);
    try {
    const res = await fetchOrDescribe(`/api/student-attendance?classSectionId=${selectedClass}&date=${date}`, undefined, "dimuat");
    const data: StudentRecord[] = await res.json();
    if (requestId !== rosterRequestId.current) return;
    setStudents(data);
    setLastLoadedCount(data.length || 10);
    const initial: Record<string, Status> = {};
    for (const s of data) if (s.attendance && STATUSES.includes(s.attendance.status as Status)) initial[s.student.id] = s.attendance.status as Status;
    for (const [id, status] of Object.entries(initial)) confirmed.current[`${selectedClass}:${date}:${id}`] = status;
    setConfirmedStatuses(initial);
    setStatuses(initial);
    } catch (error) {
      if (requestId !== rosterRequestId.current) return;
      const failure = failureFromError(error, "dimuat");
      setRosterError(failure);
      toast.error(failure.message);
    } finally { if (requestId === rosterRequestId.current) setLoadingRoster(false); }
  }, [selectedClass, date]);

  useEffect(() => { if (selectedClass) loadStudents(); }, [selectedClass, date, loadStudents]);

  // Save feedback: one live status line for the page, plus an inline error on
  // the row (or on the bulk bar) that failed. A "saved" line under every row
  // doubled the list height and said the same thing thirty times.
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [bulkError, setBulkError] = useState<FetchFailure | null>(null);

  // URL context survives reload/back. Only validated assigned classes are canonicalized.
  useEffect(() => {
    const today = getTodayInTimezone("Asia/Jakarta");
    setDate(clampToToday(resolveTeacherDate(requestedDate, today), today));
  }, [requestedDate]);
  function changeContext(nextClass: string, nextDate: string) {
    setSelectedClass(nextClass); setDate(nextDate);
    router.replace(`/teacher/class-attendance?classId=${encodeURIComponent(nextClass)}&date=${nextDate}`, {scroll:false});
  }

  // Optimistic save of one status for one or more children in a single
  // request. Saves are serialized per child (a newer choice waits for the
  // older one), and a response only lands if it is still the newest operation
  // for that child in the current class/date.
  function persist(studentIds: string[], next: Status, { bulk = false } = {}) {
    if (studentIds.length === 0) return;
    const ops = studentIds.map((studentId) => {
      const key = `${context}:${studentId}`;
      const operationId = (saveOperationIds.current[key] ?? 0) + 1;
      saveOperationIds.current[key] = operationId;
      return { studentId, key, operationId };
    });
    const isCurrent = (op: (typeof ops)[number]) =>
      activeContext.current === contextToken && saveOperationIds.current[op.key] === op.operationId;
    const ids = new Set(studentIds);
    const each = <T,>(value: T) => Object.fromEntries(studentIds.map((id) => [id, value]));
    setStatuses(prev => ({ ...prev, ...each(next) }));
    setFailedIntents(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.has(id))));
    setSaveState(prev => ({ ...prev, ...each("saving" as const) }));
    if (bulk) setBulkError(null);
    const save = async () => {
      try {
        const response = await fetchOrDescribe("/api/student-attendance/mark", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classSectionId: selectedClass, date, records: studentIds.map((studentId) => ({ studentId, status: next })) }),
        }, "disimpan");
        const body = await response.json().catch(() => ({}));
        if (body.saved !== studentIds.length) throw new Error("not all saved");
        for (const op of ops) confirmed.current[op.key] = next;
        if (activeContext.current === contextToken) setConfirmedStatuses(prev => ({ ...prev, ...each(next) }));
        const landed = ops.filter(isCurrent).map((op) => op.studentId);
        setSaveState(prev => ({ ...prev, ...Object.fromEntries(landed.map((id) => [id, "saved" as const])) }));
      } catch (error) {
        const failed = ops.filter(isCurrent);
        if (failed.length === 0) return;
        // Mapped copy only: raw API/browser text ("Unauthorized", "Failed to fetch") never reaches the teacher.
        const failure = failureFromError(error, "disimpan");
        setStatuses(prev => {
          const copy = { ...prev };
          for (const op of failed) { if (confirmed.current[op.key]) copy[op.studentId] = confirmed.current[op.key]; else delete copy[op.studentId]; }
          return copy;
        });
        if (bulk) {
          // The bulk bar is the retry: the rows go back to "belum" and the
          // button counts them again.
          setSaveState(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !failed.some((op) => op.studentId === id))));
          setBulkError(failure);
        } else {
          const [op] = failed;
          setSaveErrors(prev => ({ ...prev, [op.studentId]: failure }));
          setFailedIntents(prev => ({ ...prev, [op.studentId]: next }));
          setSaveState(prev => ({ ...prev, [op.studentId]: "error" }));
        }
        // Stays until dismissed: this is the teacher's own record. Retry re-sends
        // the same ids and status; one id per child (or bulk) so repeats replace.
        toastError(failure.message, {
          // A 401/403 can never succeed on retry; it still stays until dismissed.
          retry: failure.canRetry ? () => persist(studentIds, next, { bulk }) : undefined,
          persistent: true,
          id: `class-attendance-save-${context}-${bulk ? "bulk" : studentIds[0]}`,
        });
      }
    };
    const prior = Promise.all(ops.map((op) => saveQueues.current[op.key] ?? Promise.resolve()));
    const queued = prior.then(save, save);
    for (const op of ops) saveQueues.current[op.key] = queued;
    void queued.finally(() => { for (const op of ops) if (saveQueues.current[op.key] === queued) delete saveQueues.current[op.key]; });
  }

  const unrecorded = students.filter((s) => !statuses[s.student.id]).map((s) => s.student.id);
  const saveValues = Object.values(saveState);
  const pageSaveState = saveValues.includes("saving") ? "saving" : saveValues.includes("saved") ? "saved" : null;

  const counts = {
    PRESENT: Object.values(confirmedStatuses).filter((s) => s === "PRESENT").length,
    ABSENT: Object.values(confirmedStatuses).filter((s) => s === "ABSENT").length,
    SICK: Object.values(confirmedStatuses).filter((s) => s === "SICK").length,
    PERMISSION: Object.values(confirmedStatuses).filter((s) => s === "PERMISSION").length,
  };
  const notYet = students.length - Object.keys(confirmedStatuses).filter((id) => students.some((s) => s.student.id === id)).length;
  // Every row has a (possibly optimistic) status but the counts above only move once the save lands. Say so
  // instead of claiming "Semua siswa sudah dicatat" next to "8 belum" (TCH-11).
  const confirming = unrecorded.length === 0 && notYet > 0;

  // The header is rendered in every branch, including loading — it used to
  // appear only on the success path, so the h1 popped in after the fetch and
  // shifted the whole page down.
  if (loading) return (
    <div>
      <PageHeader title="Absensi kelas" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );

  if (assignments.length === 0 || assignmentsError) {
    return (
      <div data-empty-state={assignmentsError ? "assignments-error" : "no-class-assigned"}>
        <PageHeader title="Absensi kelas" />
        <EmptyState
          icon={Users}
          title={assignmentsError ? "Daftar kelas tidak bisa dimuat" : "Belum ditugaskan ke kelas"}
          description={assignmentsError ? assignmentsError.message : "Hubungi admin untuk ditugaskan mengajar di kelas tertentu."}
          actionLabel={assignmentsError ? (assignmentsError.canRetry ? "Coba lagi" : assignmentsError.kind === "auth" ? "Masuk lagi" : undefined) : undefined}
          actionHref={assignmentsError && !assignmentsError.canRetry && assignmentsError.kind === "auth" ? "/" : undefined}
          onAction={assignmentsError?.canRetry ? loadAssignments : undefined}
        />
      </div>
    );
  }

  const classLabel = (a: Assignment) => `${a.classSection.name} — ${a.classSection.program.name}`;
  const currentAssignment = assignments.find(a => a.classSection.id === selectedClass);

  return (
    <div>
      <PageHeader title="Absensi kelas" />

      {/* Class + date on one line. A teacher with one class gets its name, not a one-option dropdown. */}
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="class-attendance-class" className="sr-only">
          Pilih kelas
        </label>
        {assignments.length > 1 ? (
          <Select value={selectedClass} onValueChange={v => v && changeContext(v, date)} items={assignments.map(a => ({ label: classLabel(a), value: a.classSection.id }))}>
            <SelectTrigger id="class-attendance-class" className="tap-target min-w-0 flex-1">
              <SelectValue placeholder="Pilih kelas">{currentAssignment ? classLabel(currentAssignment) : null}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {assignments.map(a => (
                <SelectItem key={a.classSection.id} value={a.classSection.id}>
                  {classLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p id="class-attendance-class" className="min-w-0 flex-1 truncate text-h2">
            {currentAssignment?.classSection.name}
            <span className="ml-1.5 text-small font-normal text-muted-foreground">{currentAssignment?.classSection.program.name}</span>
          </p>
        )}
        <label htmlFor="class-attendance-date" className="sr-only">
          Tanggal kehadiran
        </label>
        <Input id="class-attendance-date" type="date" value={date} max={todayYmd} onChange={e => { const valid = resolveTeacherDate(e.target.value, ""); if (valid && valid <= todayYmd) changeContext(selectedClass, valid); }} className="tap-target w-auto shrink-0" />
      </div>

      {/*
        Live summary. Colour is applied only to a non-zero count: four
        coloured figures with three of them reading "0" spent an Alpa-red
        signal on nothing at all, which is the same lesson #500 recorded for
        the parent Tagihan total.
      */}
      {!loadingRoster && !rosterError && students.length > 0 ? (
        <div className="mb-3 space-y-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {OPTIONS.map(({ status, label }) => (
              <span key={status} className={counts[status] > 0 ? SUMMARY_TONE[status] : "text-muted-foreground"}>
                {label} {counts[status]}
              </span>
            ))}
            {notYet > 0 ? <span className="text-muted-foreground">{notYet} belum</span> : null}
          </div>
          {/* Space is reserved before the first save: the line appearing used to push every row down mid-tap. */}
          <div className="min-h-6">
            {pageSaveState ? <SaveStatus state={pageSaveState} message={pageSaveState === "saving" ? "Menyimpan absensi…" : "Absensi tersimpan"} /> : null}
          </div>
        </div>
      ) : null}

      {loadingRoster ? (
        <div className="space-y-1.5">
          {Array.from({ length: lastLoadedCount }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-36 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
              <Skeleton className="h-11 w-44 rounded-lg shrink-0" />
            </div>
          ))}
        </div>
      ) : rosterError ? (
        <div data-empty-state="roster-error">
          <EmptyState
            icon={Users}
            title="Data siswa tidak bisa dimuat"
            description={rosterError.message}
            actionLabel={rosterError.canRetry ? "Coba lagi" : rosterError.kind === "auth" ? "Masuk lagi" : undefined}
            actionHref={!rosterError.canRetry && rosterError.kind === "auth" ? "/" : undefined}
            onAction={rosterError.canRetry ? loadStudents : undefined}
          />
        </div>
      ) : students.length === 0 ? (
        <div data-empty-state="no-students">
          <EmptyState icon={Users} title="Belum ada siswa di kelas ini" description="Minta admin untuk mendaftarkan siswa ke kelas ini." />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {students.map((s) => {
              const status = statuses[s.student.id];
              const rowState = saveState[s.student.id];
              return (
                <li key={s.student.id} data-testid="roster-row" className={cn("px-3 py-2 transition-colors", status && ROW_TINT[status])}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-words text-sm font-medium">{s.student.name}</p>
                      {s.student.nickname && <p className="truncate text-xs text-muted-foreground">{s.student.nickname}</p>}
                    </div>
                    <div role="radiogroup" aria-label={`Status ${s.student.name}`} aria-busy={rowState === "saving" || undefined} className="flex shrink-0 gap-1">
                      {OPTIONS.map((o) => {
                        const selected = status === o.status;
                        return (
                          <button
                            key={o.status}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={o.label}
                            onClick={() => { if (!selected) persist([s.student.id], o.status); }}
                            className={cn(
                              "size-11 rounded-lg border text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              selected ? SELECTED[o.status] : "border-border bg-background text-muted-foreground hover:bg-muted",
                            )}
                          >
                            <span aria-hidden="true">{o.letter}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {rowState === "error" ? (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <SaveStatus state="error" message={`Absensi belum tersimpan. ${saveErrors[s.student.id]?.message ?? "Coba lagi sebentar lagi."}`} />
                      {saveErrors[s.student.id]?.kind === "auth" ? <SignInAgain /> : failedIntents[s.student.id] && (saveErrors[s.student.id]?.canRetry ?? true) ? <Button variant="outline" className="min-h-11" onClick={() => persist([s.student.id], failedIntents[s.student.id])}>Coba lagi</Button> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {/* Most children are present: one tap records the rest. Children who already have a status are never touched. */}
          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-sticky -mx-page-x mt-4 border-t border-border bg-background px-page-x py-3 supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur">
            {bulkError ? (
              <div className="mb-2 flex items-center justify-between gap-2">
                <SaveStatus state="error" message={`Absensi belum tersimpan. ${bulkError.message}`} />
                {bulkError.kind === "auth" ? <SignInAgain className="shrink-0" /> : null}
              </div>
            ) : null}
            {bulkError && !bulkError.canRetry ? null : unrecorded.length > 0 ? (
              <Button type="button" className="tap-target w-full" onClick={() => persist(unrecorded, "PRESENT", { bulk: true })}>
                <Check aria-hidden="true" />
                {unrecorded.length === students.length ? `Tandai semua ${unrecorded.length} siswa Hadir` : `Tandai ${unrecorded.length} siswa lainnya Hadir`}
              </Button>
            ) : confirming ? (
              <p className="flex min-h-11 items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <Spinner aria-hidden /> Menyimpan…
              </p>
            ) : (
              <p className="flex min-h-11 items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <Check aria-hidden="true" className="size-4" /> Semua siswa sudah dicatat
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
