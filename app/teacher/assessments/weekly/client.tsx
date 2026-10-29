"use client";

import { type KeyboardEvent, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toastError } from "@/lib/feedback";
import { NotebookPen, Users } from "lucide-react";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { PageHeader } from "@/components/portal/page-header";
import { SaveStatus } from "@/components/portal/save-status";
import { BackLink } from "@/components/portal/back-link";
import { WeekNavigator } from "@/components/portal/week-navigator";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { formatCurriculumElement, formatDate } from "@/lib/format";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import {
  LEVEL_LABEL_SHORT,
  LEVEL_LABEL_LONG,
  LEVEL_CHIP_CLASS,
  LEVEL_CHIP_CLASS_OFF,
  LEVEL_ORDER,
  type Level,
} from "@/lib/curriculum/level-presentation";

type Student = {
  id: string;
  name: string;
  nickname: string | null;
  status: string;
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
  date: string;
  level: string;
  note: string | null;
};

type Week = {
  id: string;
  number: number;
  startDate: string;
  endDate: string;
  subTheme: { id: string; name: string };
  theme: { id: string; name: string };
};

type ClassSection = {
  id: string;
  name: string;
  ageGroup: "A" | "B" | null;
};

/** Pure helper: shift a YYYY-MM-DD string by whole days, UTC-safe. */
export function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure helper: build the Mon–Fri day-chip strip inside the week.
 * Exported for reuse if the assessments hub later wants the same strip.
 */
export function weekDays(week: Week): string[] {
  const start = new Date(week.startDate + "T00:00:00Z");
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** Pure helper: pick today if it's within the week, else fall back to Monday. */
export function pickInitialDay(
  week: Week,
  todayJakartaYmd: string,
): string {
  const days = weekDays(week);
  if (days.includes(todayJakartaYmd)) return todayJakartaYmd;
  return days[0];
}

/**
 * Native radios provide one tab stop and the expected checked semantics. This
 * handler adds the Home/End shortcuts and makes Enter select too, while keeping
 * arrow-key navigation consistent across browsers.
 */
function handleRadioGroupKeyDown<T extends string>(
  event: KeyboardEvent<HTMLInputElement>,
  values: readonly T[],
  currentValue: T,
  onSelect: (value: T) => void,
) {
  const currentIndex = values.indexOf(currentValue);
  if (currentIndex === -1) return;

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
    case "Enter":
    case " ":
      break;
    default:
      return;
  }

  event.preventDefault();
  const nextValue = values[nextIndex]!;
  onSelect(nextValue);
  event.currentTarget
    .closest('[role="radiogroup"]')
    ?.querySelector<HTMLInputElement>(`input[value="${nextValue}"]`)
    ?.focus();
}

export function WeeklyClient({
  initialDate,
  week,
  classSection,
  students,
  indicators,
  initialEntries,
}: {
  initialDate: string;
  week: Week;
  classSection: ClassSection;
  students: Student[];
  indicators: Indicator[];
  initialEntries: Entry[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeDay, setActiveDay] = useState<string>(
    pickInitialDay(week, initialDate),
  );
  const [activeIndicatorId, setActiveIndicatorId] = useState<string>(
    indicators[0]?.id ?? "",
  );
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  // Every level tap saves on its own, so the page says so: one status line,
  // "saving" while any tap is in flight, "saved" only when none is left and the
  // last one landed, "error" until the next tap (DOC-4).
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const inFlight = useRef(0);

  const days = useMemo(() => weekDays(week), [week]);

  const weekRangeLabel = useMemo(() => {
    const opts = { day: "numeric", month: "short" } as const;
    return `${formatDate(week.startDate, opts)} – ${formatDate(week.endDate, opts)}`;
  }, [week.startDate, week.endDate]);

  const entryByStudent = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const e of entries) {
      if (e.indicatorId === activeIndicatorId && e.date === activeDay) {
        map.set(e.studentId, e);
      }
    }
    return map;
  }, [entries, activeIndicatorId, activeDay]);

  async function setLevel(
    student: Student,
    level: Level,
    // "Coba lagi" re-applies the exact cell that failed, even if the teacher
    // has since moved to another indicator or day.
    target?: { indicatorId: string; day: string },
  ): Promise<void> {
    const indicatorId = target?.indicatorId ?? activeIndicatorId;
    if (!indicatorId) return;
    const day = target?.day ?? activeDay;
    const matchesCell = (e: Entry): boolean =>
      e.studentId === student.id &&
      e.indicatorId === indicatorId &&
      e.date === day;
    // Capture the prior cell BEFORE the optimistic write so a rollback can
    // restore exactly that cell — never the whole entries array. Two rapid
    // taps on the same cell each capture their own "prior" + replacement;
    // a failure on one undoes only its own delta and never blasts the
    // sibling tap's optimistic update away.
    const priorCell = entries.find(matchesCell) ?? null;
    const provisional: Entry = {
      id: `optimistic-${student.id}-${indicatorId}-${day}`,
      studentId: student.id,
      indicatorId,
      date: day,
      level,
      note: priorCell?.note ?? null,
    };
    setEntries((curr) => [...curr.filter((e) => !matchesCell(e)), provisional]);
    inFlight.current += 1;
    setSaveState("saving");
    try {
      const res = await fetch("/api/teacher/assessment-entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entries: [
            {
              studentId: student.id,
              indicatorId,
              date: day,
              source: "HOMEROOM",
              level,
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(body.error ?? "Gagal menyimpan penilaian.");
      }
      // Refresh server payload to get the persisted entry id.
      startTransition(() => router.refresh());
      inFlight.current -= 1;
      setSaveState((current) => (inFlight.current === 0 && current !== "error" ? "saved" : current));
    } catch (err) {
      inFlight.current -= 1;
      setSaveState("error");
      const message = userMessage(
        err,
        "Gagal menyimpan penilaian. Coba lagi sebentar ya.",
      );
      // Restore only this cell — never blast the array. A concurrent tap
      // on a different cell stays applied; a concurrent tap on THIS cell
      // wins or rolls back independently in its own setLevel call.
      setEntries((curr) => {
        const without = curr.filter((e) => !matchesCell(e));
        return priorCell ? [...without, priorCell] : without;
      });
      toastError(message, {
        retry: () => void setLevel(student, level, { indicatorId, day }),
        id: `weekly-save-${student.id}-${indicatorId}-${day}`,
      });
    }
  }

  return (
    <div className="space-y-5">
      <BackLink href="/teacher/assessments" />

      <PageHeader
        title="Penilaian pekanan"
        // No nested parentheses. Both `subTheme.name` and `theme.name` are DB
        // values that already carry their own brackets ("Rumahku (Demo)"), so
        // wrapping the theme in a second pair rendered
        // "Rumahku (Demo) (Lingkunganku (Demo))". Separators, not brackets.
        subtitle={`${classSection.name} · ${week.subTheme.name} · tema ${week.theme.name}`}
      />

      {/*
        A walas could not reach last pekan: the page reads `?date=` but only
        offered a date picker inside the "no active week" branch, so on the
        normal path there was no way back. Same control the parent portal uses.
      */}
      <WeekNavigator
        label={`Pekan ${week.number} · ${weekRangeLabel}`}
        prevHref={`/teacher/assessments/weekly?date=${shiftYmd(week.startDate, -7)}`}
        nextHref={`/teacher/assessments/weekly?date=${shiftYmd(week.startDate, 7)}`}
      />

      <div
        className="flex flex-wrap gap-2"
        role="radiogroup"
        aria-label="Hari dalam pekan"
      >
        {days.map((d, i) => {
          const label = ["Sen", "Sel", "Rab", "Kam", "Jum"][i] ?? "?";
          const dd = d.slice(8, 10);
          const isActive = d === activeDay;
          return (
            <label
              key={d}
              htmlFor={`weekly-day-${d}`}
              className={cn(
                "min-h-11 cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors",
                "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-input",
              )}
            >
              <input
                id={`weekly-day-${d}`}
                className="peer sr-only"
                type="radio"
                name="weekly-day"
                value={d}
                checked={isActive}
                onChange={() => setActiveDay(d)}
                onKeyDown={(event) =>
                  handleRadioGroupKeyDown(event, days, d, setActiveDay)
                }
                aria-label={`${label} ${dd}`}
              />
              {label} {dd}
            </label>
          );
        })}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="indicator-picker"
          className="block text-sm font-medium text-foreground"
        >
          Indikator ketercapaian (IKTP)
        </label>
        {/*
          `NativeSelect` IS the <select> — passing another one as its child
          produced `<select><select>…</select></select>`, which the parser
          collapses: the outer select rendered zero options and the real picker
          got a 0×0 box, so the walas could never change IKTP and every level
          silently wrote against `indicators[0]`.
        */}
        {indicators.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="Belum ada IKTP untuk tema pekan ini"
            description="Hubungi admin agar indikator ketercapaian dihubungkan ke tema pekan ini."
          />
        ) : (
          <NativeSelect
            id="indicator-picker"
            data-testid="indicator-picker"
            className="w-full"
            selectClassName="tap-target"
            value={activeIndicatorId}
            onChange={(e) => setActiveIndicatorId(e.target.value)}
          >
            {indicators.map((ind) => (
              <NativeSelectOption key={ind.id} value={ind.id}>
                {formatCurriculumElement(ind.objective.element)} · {ind.content}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </div>

      {students.length > 0 && indicators.length > 0 ? (
        // Space is reserved so the line appearing never pushes the roster mid-tap.
        <div className="min-h-6" data-testid="weekly-save-state">
          {saveState !== "idle" ? (
            <SaveStatus
              state={saveState}
              message={
                saveState === "saving"
                  ? "Menyimpan penilaian…"
                  : saveState === "saved"
                    ? "Penilaian tersimpan"
                    : "Penilaian belum tersimpan. Ketuk ulang ya."
              }
            />
          ) : null}
        </div>
      ) : null}

      {/*
        TCH-5: with no IKTP for the week there is nothing to rate against, so the
        disabled level chips and the "Ketuk tingkat…" hint are noise — the empty
        state above is the whole message.
      */}
      {indicators.length === 0 ? null : students.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Belum ada siswa di kelas ini"
          description="Minta admin untuk mendaftarkan siswa ke kelas ini."
        />
      ) : (
        <ul className="space-y-2" data-testid="weekly-roster">
          {students.map((student) => {
            const current = entryByStudent.get(student.id)?.level as
              | Level
              | undefined;
            return (
              <li
                key={student.id}
                className="rounded-lg border border-input p-3 space-y-2"
                data-testid={`weekly-row-${student.id}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {student.name}
                  </span>
                  {current && (
                    <span className="text-xs text-muted-foreground">
                      {LEVEL_LABEL_LONG[current]}
                    </span>
                  )}
                </div>
                <div
                  className="grid grid-cols-3 gap-2"
                  role="radiogroup"
                  aria-label={`Pilih tingkat untuk ${student.name}`}
                >
                  {LEVEL_ORDER.map((level) => {
                    const isActive = current === level;
                    return (
                      <label
                        key={level}
                        className={cn(
                          // min-h-11 = 44px. These measured 34px and are the
                          // single most-tapped control in the whole portal.
                          "flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-1 py-2 text-center text-sm font-medium transition-colors",
                          "has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2",
                          isActive ? LEVEL_CHIP_CLASS[level] : LEVEL_CHIP_CLASS_OFF[level],
                          (!activeIndicatorId || pending) &&
                            "cursor-not-allowed opacity-60",
                        )}
                      >
                        <input
                          id={`weekly-level-${student.id}-${level}`}
                          className="peer sr-only"
                          type="radio"
                          name={`weekly-level-${student.id}`}
                          value={level}
                          checked={isActive}
                          disabled={!activeIndicatorId || pending}
                          onChange={() => setLevel(student, level)}
                          onKeyDown={(event) =>
                            handleRadioGroupKeyDown(event, LEVEL_ORDER, level, (nextLevel) =>
                              setLevel(student, nextLevel),
                            )
                          }
                          data-testid={`weekly-level-${student.id}-${level}`}
                          aria-label={`${LEVEL_LABEL_SHORT[level]} untuk ${student.name}`}
                        />
                        {LEVEL_LABEL_SHORT[level]}
                      </label>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {indicators.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <NotebookPen className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {/*
            The old line ended "…bisa ditambahkan dari detail siswa", pointing at
            a screen this page has no link to. Say what the tap does instead.
          */}
          {/* R2-T-8: the status line above says "belum tersimpan" after a failed
              tap; claiming auto-save in the same breath contradicts it. */}
          Ketuk tingkat untuk menyimpan.
          {saveState === "saving" || saveState === "error" ? "" : " Penilaian tersimpan otomatis."}
        </p>
      )}
    </div>
  );
}
