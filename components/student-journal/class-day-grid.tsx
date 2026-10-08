"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, ChevronUp, MessageSquarePlus } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { SectionLabel } from "@/components/portal/section-label";
import { BULK_ABSENCE_LABELS, type BulkAbsences } from "@/components/student-journal/class-bulk-sheet";

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

type Student = {
  id: string;
  name: string;
  nickname: string | null;
};

type ClassDayGridProps = {
  students: Student[];
  categories: Category[];
  /** state[studentId][indicatorId] = checked */
  state: Record<string, Record<string, boolean>>;
  onToggle: (studentId: string, indicatorId: string) => void;
  /**
   * Set every indicator for one student at once. Absent → the bulk controls
   * are not rendered (the admin/read-only callers do not want them).
   */
  onBulkSet?: (studentId: string, checked: boolean) => void;
  /** Open the add-note dialog for this student. If absent, the affordance is hidden. */
  onAddNote?: (student: Student) => void;
  /** Per-student notes count (for optimistic badge next to add-note button). */
  noteCounts?: Record<string, number>;
  /**
   * Per-student count of catatan written by somebody else since this guru last
   * opened that student's thread. Rendered as the only loud thing in the row —
   * before this, a wali's reply was invisible until the guru happened to open
   * the right student on the right week.
   */
  unreadCounts?: Record<string, number>;
  /** Picker date (YYYY-MM-DD) — passed through as `?week=` when the chevron drills into the per-student week view. */
  visibleDate?: string;
  /** Set of `${studentId}:${indicatorId}` keys currently saving — renders a subtle saving affordance. */
  pendingCells?: Set<string>;
  /** Today's Sakit/Izin/Alpa children (R2-T-5): badged in the row, same labels as the bulk sheet. */
  absences?: BulkAbsences;
};

export function ClassDayGrid({ students, categories, state, onToggle, onBulkSet, onAddNote, noteCounts, unreadCounts, visibleDate, pendingCells, absences }: ClassDayGridProps) {
  const router = useRouter();
  // The row-stagger ignored the OS reduced-motion setting, unlike every other
  // animated surface in the portal.
  const reduceMotion = useReducedMotion();
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set());

  function toggleExpand(studentId: string) {
    setExpandedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  }

    /**
   * "AF" for "Abdullah Faris Siregar". A single letter put three "A" avatars in
   * a row on the DCARE roster — an identifier that identifies nothing.
   */
  function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  /**
   * The nickname line earns its space only when it says something the name does
   * not. "Abdullah Faris Siregar" over "Abdullah" is the same word twice.
   */
  function secondaryName(student: Student): string | null {
    const nickname = student.nickname?.trim();
    if (!nickname) return null;
    const first = student.name.trim().split(/\s+/)[0] ?? "";
    return nickname.toLowerCase() === first.toLowerCase() ? null : nickname;
  }

  function countChecked(studentId: string): number {
    const studentState = state[studentId] ?? {};
    return Object.values(studentState).filter(Boolean).length;
  }

  const totalIndicators = categories.reduce((sum, cat) => sum + cat.indicators.length, 0);

  return (
    <div className="space-y-2">
      {students.map((student, i) => {
        const isExpanded = expandedStudents.has(student.id);
        const checkedCount = countChecked(student.id);
        const unreadCount = unreadCounts?.[student.id] ?? 0;

        return (
          <motion.div
            key={student.id}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0 } : { delay: i * 0.02 }}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            {/* Student header — tap area expands; sibling icon button adds a note */}
            <div className="flex items-stretch">
              <button
                onClick={() => toggleExpand(student.id)}
                className="min-w-0 flex-1 flex items-center justify-between gap-2 p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                aria-expanded={isExpanded}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
                      checkedCount === totalIndicators && totalIndicators > 0
                        ? "bg-primary"
                        : "bg-muted-foreground/40"
                    }`}
                  >
                    {checkedCount === totalIndicators && totalIndicators > 0 ? (
                      <Check size={14} />
                    ) : (
                      <span>{initials(student.name)}</span>
                    )}
                  </div>
                  {/*
                    min-w-0 on both the flex parent and this block: without it a
                    long name ("Ali Naufal Kurniawan") ran flush into the "0/7"
                    counter at 390px instead of wrapping inside its own column.
                  */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{student.name}</p>
                    {secondaryName(student) && (
                      <p className="text-xs text-muted-foreground">{secondaryName(student)}</p>
                    )}
                  </div>
                  {absences?.[student.id] ? (
                    <span
                      className="shrink-0 rounded-full bg-status-absent-subtle px-2 py-0.5 text-xs font-medium text-status-absent-text"
                      data-testid={`absence-badge-${student.id}`}
                    >
                      {BULK_ABSENCE_LABELS[absences[student.id]]}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {unreadCount > 0 ? (
                    <span
                      data-testid="unread-badge"
                      className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-white"
                      aria-label={`${unreadCount} catatan baru untuk ${student.name}`}
                    >
                      {unreadCount} baru
                    </span>
                  ) : null}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {checkedCount}/{totalIndicators}
                  </span>
                  {isExpanded ? (
                    <ChevronUp size={16} className="text-muted-foreground" />
                  ) : (
                    <ChevronDown size={16} className="text-muted-foreground" />
                  )}
                </div>
              </button>
              {onAddNote ? (
                <button
                  type="button"
                  onClick={() => onAddNote(student)}
                  className="min-w-11 px-3 flex items-center justify-center gap-1 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors border-l border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  aria-label={`Tambah catatan untuk ${student.name}`}
                >
                  <MessageSquarePlus size={18} aria-hidden="true" />
                  {(noteCounts?.[student.id] ?? 0) > 0 ? (
                    <span className="text-xs font-medium text-primary-text tabular-nums">
                      {noteCounts?.[student.id]}
                    </span>
                  ) : null}
                </button>
              ) : null}
              {visibleDate ? (
                <button
                  type="button"
                  data-testid="open-week-view"
                  onClick={() =>
                    router.push(
                      `/teacher/student-journal/students/${student.id}?week=${visibleDate}`,
                    )
                  }
                  className="min-w-11 px-3 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors border-l border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  aria-label={`Lihat pekan ${student.name}`}
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {/* Expanded indicator checklist */}
            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  key="indicators"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border px-3.5 pb-3 pt-2 space-y-3">
                    {onBulkSet && totalIndicators > 0 ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          data-testid="bulk-check-all"
                          onClick={() => onBulkSet(student.id, true)}
                          disabled={checkedCount === totalIndicators}
                          className="tap-target inline-flex items-center gap-1 rounded-md border border-primary/40 px-3 text-xs font-medium text-primary-text transition-colors hover:bg-primary/10 active:bg-primary/20 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:hover:bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <Check size={14} aria-hidden="true" />
                          Tandai semua
                        </button>
                        <button
                          type="button"
                          data-testid="bulk-clear-all"
                          onClick={() => onBulkSet(student.id, false)}
                          disabled={checkedCount === 0}
                          className="tap-target inline-flex items-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 active:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          Hapus semua
                        </button>
                      </div>
                    ) : null}
                    {categories.map((category) => (
                      <div key={category.id}>
                        <SectionLabel>{category.name}</SectionLabel>
                        <div className="space-y-1">
                          {category.indicators.map((indicator) => {
                            const isChecked = state[student.id]?.[indicator.id] ?? false;
                            const isPending = pendingCells?.has(`${student.id}:${indicator.id}`) ?? false;
                            return (
                              <button
                                key={indicator.id}
                                onClick={() => onToggle(student.id, indicator.id)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors min-h-11 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                  isChecked
                                    ? // text-primary-text, not text-primary: the brand teal is a
                                      // fill colour and measures 2.24:1 on this tint, which made
                                      // the *checked* row the harder one to read.
                                      "bg-primary/10 border-primary text-primary-text"
                                    : "bg-transparent border-border text-foreground hover:border-primary/30"
                                } ${isPending ? "opacity-60 animate-pulse" : ""}`}
                              >
                                <div
                                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                                    isChecked
                                      ? "bg-primary border-primary"
                                      : "bg-transparent border-muted-foreground/40"
                                  }`}
                                >
                                  {isChecked && <Check size={11} className="text-white" />}
                                </div>
                                <span className="text-xs leading-snug">{indicator.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
