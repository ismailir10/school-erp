import { loadParentAttendanceSummary, PARENT_ATTENDANCE_LABELS, type ParentDayAttendance } from "@/lib/parent/attendance-summary";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Check, MessageCircle, Sparkles, Thermometer, CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ChildSelectorTabs } from "@/components/parent/child-selector-tabs";
import { PageHeader } from "@/components/portal/page-header";
import { SectionLabel } from "@/components/portal/section-label";
import { WeekNavigator } from "@/components/portal/week-navigator";
import { getParentWithChildren, resolveSelectedChild } from "@/lib/parent-helpers";
import { prisma } from "@/lib/db";
import { formatDate, formatWeekRangeLabel } from "@/lib/format";
import { attendanceBannerState } from "@/lib/parent-attendance-banner";
import { parentAttendanceWeek } from "@/lib/parent/attendance-week";
import { parentHref } from "@/lib/parent/navigation";
import { ContextStrip } from "@/components/portal/context-strip";

const DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum"] as const;

// DD/MM, like the journal WeekGrid. MM/DD printed "10/05" for 5 Oktober, which
// an Indonesian reader takes as 10 Mei (X-12).
function shortDayMonth(ymdStr: string): string {
  const [, m, d] = ymdStr.split("-");
  return `${d}/${m}`;
}

export default async function ParentAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; week?: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "GUARDIAN" || !session.tenantId) redirect("/");

  const { parent, children } = await getParentWithChildren(session);
  if (!parent || children.length === 0) redirect("/parent");

  const params = await searchParams;
  const selected = resolveSelectedChild(children, params.child);
  if (!selected) redirect("/parent");

  // Determine the focal week (defaults to this week).
  const { today, days, prevWeek, nextWeek } = parentAttendanceWeek(new Date(), params.week);
  const weekStart = days[0]!;
  const weekEnd = days[days.length - 1]!;

  // Prev / next week links

  // Fetch attendance + notes for this kid + this week
  const [attendanceSummary, notesRows] = await Promise.all([
    loadParentAttendanceSummary(session.tenantId, [selected.studentId], days),
    session.tenantId
      ? prisma.studentJournalNote.findMany({
          where: {
            tenantId: session.tenantId,
            studentId: selected.studentId,
            status: "ACTIVE",
            authorRole: "TEACHER",
            date: { gte: weekStart, lte: weekEnd },
          },
          orderBy: { date: "desc" },
          select: { id: true, date: true, body: true },
        })
      : Promise.resolve([] as { id: string; date: string; body: string }[]),
  ]);

  const dayRecords = attendanceSummary.get(selected.studentId) ?? new Map<string, ParentDayAttendance>();
  const statusByDate = new Map([...dayRecords].map(([date, record]) => [date, record.status]));
  const mixedDays = days.filter(date => statusByDate.get(date) === "MIXED");

  // Aggregate counts for the summary card
  let hadir = 0, sakit = 0, alpa = 0, izin = 0, logged = 0;
  for (const d of days) {
    const s = statusByDate.get(d);
    if (!s) continue;
    logged += 1;
    if (s === "PRESENT") hadir += 1;
    else if (s === "SICK") sakit += 1;
    else if (s === "ABSENT") alpa += 1;
    else if (s === "PERMISSION") izin += 1;
  }
  const bannerState = mixedDays.length > 0 ? null : attendanceBannerState({ hadir, sakit, alpa, izin, logged });

  const childTabsData = children.map((c) => ({
    studentId: c.studentId,
    studentName: c.studentName,
    studentNickname: c.studentNickname,
    className: c.className,
  }));

  const childName = selected.studentNickname ?? selected.studentName.split(" ")[0];
  // Same shape as the journal surfaces, from the shared helper — the year is
  // printed once, at the end of the range.
  const weekRangeLabel = formatWeekRangeLabel(weekStart, weekEnd);

  return (
    <div className="space-y-6 pb-4">
      <ChildSelectorTabs items={childTabsData} selectedChildId={selected.studentId} sticky />

      <ContextStrip
        name={selected.studentName}
        detail={[selected.className, selected.programName].filter(Boolean).join(" · ") || "Data anak terpilih"}
        className="rounded-lg border-x border-t"
      />

      <PageHeader title="Kehadiran" subtitle="Pantau kehadiran harian anak" />

      {mixedDays.length > 0 ? <section className="rounded-xl border border-border bg-card p-4" aria-label="Catatan berbeda antar kelas">
        <h2 className="text-sm font-semibold">Catatan berbeda</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ada perbedaan catatan antar kelas. Lihat rincian di bawah; hubungi sekolah jika perlu diperiksa.</p>
        <ul className="mt-3 space-y-3">
          {mixedDays.map(date => <li key={date}>
            <p className="text-sm font-medium">{formatDate(date, {weekday:"long",day:"numeric",month:"long"})}</p>
            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">{dayRecords.get(date)!.classes.map(record => <li key={record.id}>{record.name}: {PARENT_ATTENDANCE_LABELS[record.status]}</li>)}</ul>
          </li>)}
        </ul>
      </section> : null}

      {/* Summary card — varies by week state */}
      {bannerState?.kind === "all-present" ? (
        <section className="rounded-xl border border-celebration-gold bg-celebration-gold-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-celebration-gold-subtle text-celebration-gold-text">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-celebration-gold-text">
                Hadir 5 dari 5 hari
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Alhamdulillah, {childName} hadir penuh pekan ini.
              </p>
            </div>
          </div>
        </section>
      ) : bannerState?.kind === "attention" && bannerState.tone === "warm" ? (
        <section className="rounded-xl border border-status-late bg-status-late-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-status-late-subtle text-status-late-text">
              {bannerState.reason === "sick" ? <Thermometer size={18} /> : <CalendarClock size={18} />}
            </div>
            <div>
              <p className="text-sm font-semibold text-status-late-text">
                {bannerState.line}
              </p>
              {/* Alpa leads (the parent has to act on it); get-well wishes only
                  for a Sakit-only week. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {bannerState.reason === "sick"
                  ? `${childName} tercatat sakit pekan ini, semoga lekas sehat.`
                  : bannerState.alsoSick
                    ? `${childName} pekan ini sempat sakit, dan ada hari tidak hadir tanpa keterangan. Hubungi Ustadzah jika ada kabar.`
                    : `${childName} tercatat tidak hadir tanpa keterangan. Hubungi Ustadzah jika ada kabar.`}
              </p>
            </div>
          </div>
        </section>
      ) : bannerState?.kind === "attention" && bannerState.tone === "neutral" ? (
        <section className="rounded-xl border border-status-leave bg-status-leave-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-status-leave-subtle text-status-leave-text">
              <CalendarClock size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-status-leave-text">
                {bannerState.line}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {childName} sedang izin pekan ini. InsyaAllah segera kembali.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <WeekNavigator
        label={weekRangeLabel}
        prevHref={parentHref("/parent/attendance", selected.studentId, { week: prevWeek })}
        nextHref={parentHref("/parent/attendance", selected.studentId, { week: nextWeek })}
        // Only when off the current week; today is always inside `days` on it.
        todayHref={days.includes(today) ? undefined : parentHref("/parent/attendance", selected.studentId)}
      />

      {/* Week grid */}
      {logged === 0 && days.every((d) => d > today) ? (
        <EmptyState
          accent="warm"
          icon={CalendarClock}
          title="Pekan ini belum dimulai"
          description="Catatan kehadiran muncul setiap pagi setelah Ustadzah merekap absensi kelas."
        />
      ) : logged === 0 ? (
        <EmptyState
          accent="warm"
          icon={CalendarClock}
          title="Belum ada catatan kehadiran"
          description="InsyaAllah akan muncul setelah Ustadzah mengisi absensi."
        />
      ) : (
        <div className="overflow-x-auto -mx-page-x px-page-x">
          <table className="w-full min-w-[324px] border-collapse text-sm">
            <thead>
              <tr>
                {/* Corner cell: the visible "Status" label belongs to the data row only. */}
                <th scope="col" className="sticky left-0 z-sticky w-[80px] min-w-[80px] bg-background py-2 pr-2 text-left text-xs font-medium text-muted-foreground">
                  <span className="sr-only">Hari</span>
                </th>
                {days.map((d, i) => {
                  const isToday = d === today;
                  return (
                    <th
                      key={d}
                      className={`w-[44px] min-w-[44px] py-2 px-1 text-center text-xs ${isToday ? "border-t-2 border-primary bg-status-present-subtle font-semibold text-primary-text" : "font-medium text-muted-foreground"}`}
                    >
                      <div>{DAY_LABELS[i] ?? ""}</div>
                      <div className={`text-xs font-normal ${isToday ? "text-primary-text" : "text-muted-foreground/70"}`}>
                        {shortDayMonth(d)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/40">
                <th scope="row" className="sticky left-0 z-sticky bg-background py-2 pr-2 text-left text-xs font-normal text-foreground">
                  Status
                </th>
                {days.map((d) => {
                  const isToday = d === today;
                  const status = statusByDate.get(d);
                  const isFuture = d > today;
                  return (
                    <td
                      key={d}
                      className={`p-0 text-center align-middle ${isToday ? "bg-status-present-subtle border-b-2 border-primary" : ""}`}
                    >
                      <span className="inline-flex h-9 w-9 items-center justify-center">
                        {status === "MIXED" ? (
                          <>
                            <span aria-hidden="true" className="text-xs font-semibold text-muted-foreground">≠</span>
                            <span className="sr-only">Catatan berbeda</span>
                          </>
                        ) : status === "PRESENT" ? (
                          <>
                            <Check aria-hidden="true" size={16} strokeWidth={2.5} className="text-primary" />
                            <span className="sr-only">Hadir</span>
                          </>
                        ) : status === "SICK" ? (
                          <>
                            <span aria-hidden="true" className="text-xs font-bold text-status-late-text">S</span>
                            <span className="sr-only">Sakit</span>
                          </>
                        ) : status === "ABSENT" ? (
                          <>
                            <span aria-hidden="true" className="text-xs font-bold text-status-absent-text">A</span>
                            <span className="sr-only">Alpa</span>
                          </>
                        ) : status === "PERMISSION" ? (
                          <>
                            <span aria-hidden="true" className="text-xs font-bold text-status-leave-text">I</span>
                            <span className="sr-only">Izin</span>
                          </>
                        ) : isFuture ? (
                          <>
                            <span aria-hidden="true" className="text-muted-foreground/60">-</span>
                            <span className="sr-only">Belum berlangsung</span>
                          </>
                        ) : (
                          // Past or today with no saved record: an empty box, never the
                          // same mark as a day that has not happened yet.
                          <>
                            <span aria-hidden="true" className="block size-3.5 rounded-sm border border-muted-foreground/30" />
                            <span className="sr-only">Belum dicatat</span>
                          </>
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span><Check className="inline size-3 text-primary align-middle" /> Hadir</span>
            <span><b className="text-status-late-text">S</b> Sakit</span>
            <span><b className="text-status-absent-text">A</b> Alpa</span>
            <span><b className="text-status-leave-text">I</b> Izin</span>
            <span><span aria-hidden="true" className="mr-1 inline-block size-3 rounded-sm border border-muted-foreground/30 align-middle" />Belum dicatat</span>
            <span><span aria-hidden="true">-</span> Belum berlangsung</span>
            {mixedDays.length > 0 ? <span>≠ Catatan berbeda</span> : null}
          </div>
        </div>
      )}

      {/* Notes from school this week */}
      {notesRows.length > 0 ? (
        <section>
          <SectionLabel>Catatan dari sekolah</SectionLabel>
          <ul className="space-y-2">
            {notesRows.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="grid size-10 place-items-center shrink-0 rounded-lg bg-status-leave-subtle text-status-leave-text">
                  <MessageCircle size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground line-clamp-3">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ustadzah ·{" "}
                    {formatDate(n.date, { day: "numeric", month: "long" })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
