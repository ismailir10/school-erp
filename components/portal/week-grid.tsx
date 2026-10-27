"use client";

import { Fragment } from "react";
import { CalendarOff, Check, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/empty-state";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

type Indicator = {
  id: string;
  label: string;
  order: number;
};

type Category = {
  id: string;
  name: string;
  scope: string;
  indicators: Indicator[];
};

type LastAdminEdit = {
  changedAt: string | Date;
  changedByName: string;
};

type Entry = {
  id?: string;
  indicatorId: string;
  date: string;
  checked: boolean;
  lastAdminEdit?: LastAdminEdit | null;
};

type WeekGridProps = {
  categories: Category[];
  entries: Entry[];
  dates: string[];
  editable?: boolean;
  onToggle?: (indicatorId: string, date: string, next: boolean) => void | Promise<void>;
  /**
   * When `editable` + `onToggle` are set, restrict editing to today's column
   * only (parent-portal anti-backfill rule for the "Di Rumah" flow — UAT
   * 2026-05-01 cycle T4). Defaults to `true` to preserve that behavior.
   * Admin callers (e.g. student-journal student detail "Ubah" toggle) need
   * to correct past days too, so they pass `false`. Future dates remain
   * locked for every caller (finding F5b).
   */
  disablePastDays?: boolean;
  /**
   * Earliest date (inclusive, `YYYY-MM-DD`) editable when `disablePastDays`
   * is `true`. Omitted → today-only (teacher behavior, unchanged). Set →
   * bounded backfill window, e.g. the parent "Di Rumah" flow, which may edit
   * any date from this floor through today (`lib/student-journal/backfill.ts`
   * is the shared source of that floor — server and client must agree).
   * Ignored when `disablePastDays` is `false` (admin correction mode already
   * allows every past date).
   */
  earliestEditableDate?: string;
  /**
   * What this surface is called to the reader. Staff (admin + teacher) know it
   * as "Buku Penghubung"; parents only ever see it called "Jurnal", so leaking
   * the staff term into a parent-facing empty state is a jargon leak. Defaults
   * to the staff term so existing admin/teacher call sites are unaffected.
   */
  featureLabel?: string;
  /**
   * Shown above the grid when the week holds no ticks at all. A wall of dashes
   * reads as a broken product; saying "nobody has filled this yet" reads as a
   * week that has not happened. Omit to keep the silent behaviour.
   */
  emptyWeekMessage?: string;
  /**
   * Days the guru marked "hari tanpa buku penghubung", `YYYY-MM-DD → keterangan`
   * ("Renang"). A 44px column cannot carry the reason, so each marked day gets a
   * line above the grid, an icon in its header, and a quiet tint on the cells
   * that would otherwise read as "belum diisi". Ticks that exist stay visible.
   */
  dayMarks?: Record<string, string>;
};

// Deterministic month abbrevs — toLocaleDateString("id-ID") silently falls back
// to system locale on older Android WebViews, which would print English months.
const ID_MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

function formatAdminEditDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getDate()} ${ID_MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

function formatColDate(ymd: string): string {
  // YYYY-MM-DD -> DD/MM. Was MM/DD, which printed "08/17" under "Sen" in an
  // Indonesian UI — day-first is the only reading an Indonesian parent or
  // teacher will apply, and "12/08" vs "08/12" is silently ambiguous rather
  // than obviously wrong.
  const parts = ymd.split("-");
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}`;
}

const DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum"];

export function isWeekGridDateEditable(
  date: string,
  todayYmd: string,
  disablePastDays: boolean,
  earliestEditableDate?: string,
): boolean {
  // Future dates are never editable, in every mode (finding F5b).
  if (date > todayYmd) return false;
  if (date === todayYmd) return true;
  // Admin correction mode (`disablePastDays={false}`): every past date is
  // fair game, window or no window.
  if (!disablePastDays) return true;
  // Bounded backfill window (parent "Di Rumah"): past dates back to the
  // floor, inclusive. No floor given → today-only (teacher, unchanged).
  if (earliestEditableDate) return date >= earliestEditableDate;
  return false;
}

/**
 * Indonesian reason a locked WeekGrid cell cannot be toggled — must state the
 * actual rule for the mode in effect (finding: a hardcoded "hanya hari ini"
 * string became a lie once the windowed parent mode shipped). Kept in sync
 * with the server's `HOME_EDIT_WINDOW_MSG`
 * (`app/api/student-journal/entries/home/route.ts`) so a wali who hits both
 * the disabled cell and a rejected request hears the same rule.
 */
function lockedCellReason(
  date: string,
  todayYmd: string,
  disablePastDays: boolean,
  earliestEditableDate?: string,
): string {
  if (date > todayYmd) return "tanggal akan datang belum bisa diubah";
  if (disablePastDays && earliestEditableDate) {
    return "di luar jangkauan — hanya bisa diubah dari Senin pekan lalu sampai hari ini";
  }
  return "hanya hari ini bisa diubah";
}

export function WeekGrid({
  categories,
  entries,
  dates,
  editable = false,
  onToggle,
  disablePastDays = true,
  earliestEditableDate,
  featureLabel = "Buku Penghubung",
  emptyWeekMessage,
  dayMarks,
}: WeekGridProps) {
  // Build lookup: `${indicatorId}|${date}` -> checked
  const lookup = new Map<string, boolean>();
  // Parallel lookup: `${indicatorId}|${date}` -> lastAdminEdit (when entry was overridden by admin)
  const adminEditLookup = new Map<string, LastAdminEdit>();
  for (const e of entries) {
    const k = `${e.indicatorId}|${e.date}`;
    lookup.set(k, e.checked);
    if (e.lastAdminEdit) adminEditLookup.set(k, e.lastAdminEdit);
  }

  // Today's YYYY-MM-DD in Jakarta time — used to highlight today's column.
  // Canonical helper (not raw browser-local `new Date()`) so this lines up
  // with every other date computation in the app regardless of the host's
  // timezone (finding F5c).
  const todayYmd = getTodayInTimezone("Asia/Jakarta");

  if (categories.length === 0) {
    return (
      <EmptyState
        title="Belum ada indikator"
        description={`Indikator pemantauan belum dikonfigurasi untuk kelas ini. Hubungi admin sekolah untuk mengatur ${featureLabel}.`}
      />
    );
  }

  const hasAnyCheck = entries.some((e) => e.checked);
  const markedDates = dates.filter((d) => dayMarks?.[d]);

  return (
    <div>
      {markedDates.length > 0 ? (
        <ul data-testid="day-mark-notes" className="mb-2 space-y-1">
          {markedDates.map((d) => (
            <li key={d} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <CalendarOff size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">
                  {DAY_LABELS[dates.indexOf(d)] ?? ""} {formatColDate(d)}
                </span>{" "}
                · Tanpa buku penghubung: {dayMarks?.[d]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {emptyWeekMessage && !hasAnyCheck && markedDates.length === 0 ? (
        <p data-testid="empty-week-note" className="mb-2 text-xs text-muted-foreground">
          {emptyWeekMessage}
        </p>
      ) : null}
      <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[324px] text-sm border-collapse">
        <thead>
          <tr>
            {/* Sticky indicator column header */}
            <th className="sticky left-0 bg-card z-10 text-left py-2 pr-2 text-xs font-medium text-muted-foreground w-[104px] min-w-[104px]">
              Indikator
            </th>
            {dates.map((d, i) => {
              const isToday = d === todayYmd;
              return (
                <th
                  key={d}
                  className={`text-center py-2 px-1 text-xs min-w-[44px] w-[44px] ${
                    // Neutral "today" accent (not the success/hadir-subtle token) — the
                    // header spans every indicator row, most of which aren't filled in
                    // yet, so tinting it green misleads admins scanning for incomplete
                    // entries into reading an empty column as done (finding F5a).
                    isToday
                      ? "bg-primary/5 text-primary-text font-semibold border-t-2 border-primary"
                      : "font-medium text-muted-foreground"
                  }`}
                >
                  <div>{DAY_LABELS[i] ?? formatColDate(d)}</div>
                  <div className={`text-xs ${isToday ? "text-primary-text" : "text-muted-foreground/70 font-normal"}`}>
                    {formatColDate(d)}
                  </div>
                  {dayMarks?.[d] ? (
                    <CalendarOff
                      size={12}
                      className="mx-auto mt-0.5 text-muted-foreground"
                      role="img"
                      aria-label={`Tanpa buku penghubung: ${dayMarks[d]}`}
                    />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {(() => {
            // Pre-compute index of the final indicator row (across all categories)
            // so we can anchor the today-column bottom accent there.
            const lastCatIdx = categories.length - 1;
            const lastIndIdx =
              categories[lastCatIdx]?.indicators.length
                ? categories[lastCatIdx].indicators.length - 1
                : -1;
            return categories.map((cat, ci) => (
            // Keyed Fragment: the map returned a bare `<>`, so every category
            // block was an unkeyed list child and React warned on every render.
            <Fragment key={cat.id}>
              {/* Category header row */}
              <tr>
                <td
                  colSpan={dates.length + 1}
                  className="border-l-4 border-l-primary bg-primary/5 pl-3 py-2 text-h2 font-semibold text-foreground sticky left-0"
                >
                  {cat.name}
                </td>
              </tr>
              {cat.indicators.map((ind, ii) => {
                const isLastRowOverall = ci === lastCatIdx && ii === lastIndIdx;
                return (
                <tr
                  key={ind.id}
                  className="border-b border-border/40 last:border-0"
                >
                  {/* Sticky label column */}
                  <td className="sticky left-0 bg-card z-10 py-2 pr-2 text-xs text-foreground leading-tight w-[104px] min-w-[104px] align-middle">
                    {ind.label}
                  </td>
                  {dates.map((d) => {
                    const k = `${ind.id}|${d}`;
                    const checked = lookup.get(k) ?? false;
                    const adminEdit = adminEditLookup.get(k);
                    const isToday = d === todayYmd;
                    const todayBottomAccent = isToday && isLastRowOverall ? " border-b-2 border-primary" : "";
                    const adminEditDateLabel = adminEdit ? formatAdminEditDate(adminEdit.changedAt) : null;
                    // Success/hadir-subtle tint is reserved for cells actually checked —
                    // an unfilled today cell gets the neutral "today" accent instead, so
                    // an empty entry never visually reads as "done" (finding F5a).
                    const markReason = !checked ? dayMarks?.[d] : undefined;
                    const todayCellBg = markReason
                      ? " bg-muted/60"
                      : isToday
                      ? checked
                        ? " bg-status-present-subtle"
                        : " bg-primary/5"
                      : "";
                    return (
                      <td
                        key={d}
                        className={`text-center p-0 align-middle relative${todayCellBg}${todayBottomAccent}`}
                      >
                        {editable && onToggle ? (
                          // Today is always editable. Past days are editable
                          // when the caller opts out of the anti-backfill restriction via
                          // `disablePastDays={false}` — e.g. the admin student-journal
                          // detail page, which needs to correct past days. Future days
                          // are never editable, preventing accidental pre-filling.
                          isWeekGridDateEditable(d, todayYmd, disablePastDays, earliestEditableDate) ? (
                            <button
                              type="button"
                              onClick={() => onToggle(ind.id, d, !checked)}
                              className="flex items-center justify-center w-[44px] h-[44px] mx-auto rounded-md transition-colors hover:bg-primary/10 active:bg-primary/20"
                              aria-label={`${ind.label} ${d} — ${checked ? "sudah diisi" : "belum diisi"}`}
                            >
                              {checked ? (
                                // A 16px glyph is the sole carrier of "sudah
                                // diisi", so it needs 3:1 as a non-text
                                // graphic; brand teal gives 2.36:1 on white.
                                <Check size={16} className="text-primary-text" strokeWidth={2.5} />
                              ) : (
                                <span className="w-4 h-4 rounded border border-muted-foreground/40 block" />
                              )}
                            </button>
                          ) : (
                            // Locked past/future cell in the parent "Di Rumah" flow, or
                            // a future cell in admin correction mode. Reason text tracks
                            // the actual mode (today-only / windowed / future) — see
                            // `lockedCellReason` — so it never states a rule stricter or
                            // looser than what `isWeekGridDateEditable` just enforced.
                            <button
                              type="button"
                              disabled
                              aria-disabled="true"
                              className="flex items-center justify-center w-[44px] h-[44px] mx-auto rounded-md cursor-not-allowed"
                              aria-label={`${ind.label} ${d} — ${checked ? "sudah diisi" : "belum diisi"} — ${lockedCellReason(d, todayYmd, disablePastDays, earliestEditableDate)}`}
                            >
                              {/*
                                Locked cells differ from editable ones by SHAPE,
                                not by opacity: a wali could not tell which of
                                two 50%-opacity squares was hers to tap. An
                                empty box now means "you may tick this"; a dash
                                means "not yours to fill".
                              */}
                              {checked ? (
                                <Check size={16} className="text-muted-foreground" strokeWidth={2} />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className="block h-px w-3.5 bg-muted-foreground/50"
                                />
                              )}
                            </button>
                          )
                        ) : (
                          <span
                            className="flex h-[36px] cursor-default items-center justify-center"
                            role="img"
                            aria-label={`${ind.label} ${d} — ${checked ? "diisi" : markReason ? `tanpa buku penghubung (${markReason})` : "belum diisi"} (hanya bisa dilihat)`}
                          >
                            {/*
                              Was "✓" and "—" as text, same size and same grey:
                              a full week and an empty one read alike at arm's
                              length. Filled now uses the same accessible check
                              the editable grid draws; empty stays a quiet rule.
                            */}
                            {checked ? (
                              <Check size={16} className="text-primary-text" strokeWidth={2.5} />
                            ) : (
                              <span aria-hidden="true" className="block h-px w-3.5 bg-muted-foreground/40" />
                            )}
                          </span>
                        )}
                        {adminEdit && adminEditDateLabel ? (
                          <Popover>
                            <PopoverTrigger
                              render={
                                <button
                                  type="button"
                                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-status-late-subtle hover:bg-status-late-subtle/80 active:bg-status-late-subtle/60 flex items-center justify-center transition-colors"
                                  aria-label={`Entri ini diedit oleh admin pada ${adminEditDateLabel}`}
                                >
                                  <Pencil size={12} className="text-status-late-text" strokeWidth={2.5} />
                                </button>
                              }
                            />
                            <PopoverContent className="w-auto max-w-[220px] p-3 text-xs">
                              <p className="font-medium text-foreground">Diedit admin</p>
                              <p className="text-muted-foreground mt-1">
                                {adminEdit.changedByName} pada {adminEditDateLabel}
                              </p>
                            </PopoverContent>
                          </Popover>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </Fragment>
            ));
          })()}
        </tbody>
      </table>
      </div>
    </div>
  );
}
