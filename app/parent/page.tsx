import type { Metadata } from "next";
import { loadParentAttendanceSummary, PARENT_ATTENDANCE_LABELS, type ParentAttendanceStatus, type ParentDayAttendance } from "@/lib/parent/attendance-summary";
import { scheduledClassIds } from "@/lib/sessions/scheduled-day";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Receipt,
  AlertCircle,
  ChevronRight,
  LineChart,
  CalendarDays,
  Sparkles,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Amount } from "@/components/portal/amount";
import { PageHeader } from "@/components/portal/page-header";
import { SectionHeading } from "@/components/ui/section-heading";
import { KidCard, type KidCardFoot, type KidCardProps } from "@/components/parent/kid-card";
import { SectionCard } from "@/components/ui/section-card";
import { CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TaskList, TaskRow } from "@/components/portal/task-list";
import { getParentOutstandingForStudents, getParentWithChildren } from "@/lib/parent-helpers";
import { prisma } from "@/lib/db";
import {
  formatDate,
  formatCurriculumElement,
  formatEntrySentra,
} from "@/lib/format";
import { formatHijri } from "@/lib/hijri";
import { parentGreetingName, parentHonorific } from "@/lib/parent-greeting";
import { getYmdInTimezone } from "@/lib/attendance/timezone";
import { loadStudentPerkembangan } from "@/lib/curriculum/perkembangan-loader";
import { LEVEL_LABEL_LONG } from "@/lib/curriculum/level-presentation";
import { parentHref } from "@/lib/parent/navigation";

export const metadata: Metadata = { title: "Beranda" };

const JAKARTA_TZ = "Asia/Jakarta";

function knownAttendanceStatus(status: string | undefined): status is NonNullable<KidCardProps["todayStatus"]> {
  return status === "PRESENT" || status === "ABSENT" || status === "SICK" || status === "PERMISSION" || status === "MIXED";
}

function ymd(d: Date): string {
  return getYmdInTimezone(d, JAKARTA_TZ);
}

/**
 * Mon-Sun YYYY-MM-DD strings for the Jakarta-local week containing `now`.
 * Anchored on the WIB calendar day, not the server's UTC day — without this
 * a request arriving between 17:00-23:59 UTC (= 00:00-06:59 WIB next day)
 * would compute Monday off the wrong base date.
 */
function thisWeekDates(now: Date = new Date()): string[] {
  // Anchor to WIB-local midnight by parsing the YMD string back through Date.
  const todayYmd = getYmdInTimezone(now, JAKARTA_TZ); // e.g. "2026-05-14"
  const [yearStr, monthStr, dayStr] = todayYmd.split("-");
  // Construct a UTC date for the WIB calendar day at noon — noon avoids
  // both DST boundaries (n/a here) and any sub-day timezone-shift surprises.
  const anchor = new Date(Date.UTC(
    Number(yearStr),
    Number(monthStr) - 1,
    Number(dayStr),
    12, 0, 0,
  ));
  const day = anchor.getUTCDay(); // 0=Sun..6=Sat — same in any TZ because anchor is at noon UTC
  const offsetToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() + offsetToMon);
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    out.push(getYmdInTimezone(d, JAKARTA_TZ));
  }
  return out;
}

function buildKidFoot(
  todayStatus: string | undefined,
  weekCounts: { hadir: number; sakit: number; alpa: number; izin: number; logged: number; mixed: number },
): KidCardFoot {
  if (todayStatus === "MIXED") return {tone:"info",text:"Catatan berbeda antar kelas · lihat kehadiran untuk rinciannya"};
  if (weekCounts.mixed > 0) return {tone:"info",text:`${weekCounts.mixed} hari memiliki catatan berbeda antar kelas`};
  if (todayStatus === "SICK") {
    return { tone: "warn", text: "Sakit hari ini · semoga lekas sehat" };
  }
  if (todayStatus === "ABSENT") {
    return { tone: "warn", text: "Alpa hari ini" };
  }
  if (todayStatus === "PERMISSION") {
    return { tone: "info", text: "Izin hari ini" };
  }
  if (weekCounts.hadir > 0 && weekCounts.sakit === 0 && weekCounts.alpa === 0 && weekCounts.izin === 0) {
    return { tone: "ok", text: `Hadir ${weekCounts.hadir} hari pekan ini` };
  }
  if (weekCounts.logged > 0) {
    const parts: string[] = [];
    if (weekCounts.hadir) parts.push(`Hadir ${weekCounts.hadir}`);
    if (weekCounts.sakit) parts.push(`Sakit ${weekCounts.sakit}`);
    if (weekCounts.alpa) parts.push(`Alpa ${weekCounts.alpa}`);
    if (weekCounts.izin) parts.push(`Izin ${weekCounts.izin}`);
    const tone: KidCardFoot["tone"] =
      weekCounts.sakit + weekCounts.alpa > 0 ? "warn" : "info";
    return { tone, text: `${parts.join(" · ")} pekan ini` };
  }
  return { tone: "info", text: "Pekan ini belum tercatat" };
}

export default async function ParentDashboard() {
  const session = await getSession();
  if (!session || session.role !== "GUARDIAN" || !session.tenantId) redirect("/");

  const { parent, children } = await getParentWithChildren(session);

  if (!parent || children.length === 0) {
    return (
      <div className="py-16">
        <EmptyState
          icon={AlertCircle}
          title="Akun belum terhubung ke anak"
          description="Silakan hubungi admin sekolah untuk menautkan akun Anda."
        />
      </div>
    );
  }

  const now = new Date();
  const today = ymd(now);
  const week = thisWeekDates(now);
  const kidIds = children.map((c) => c.studentId);

  const [
    attendanceByKid,
    latestNotes,
    outstanding,
    perkembanganByKid,
    scheduledClasses,
  ] = await Promise.all([
    loadParentAttendanceSummary(session.tenantId, kidIds, [...new Set([...week, today])]),
    prisma.studentJournalNote.findMany({
      where: {
        tenantId: session.tenantId,
        studentId: { in: kidIds },
        status: "ACTIVE",
        authorRole: "TEACHER",
      },
      orderBy: { createdAt: "desc" },
      select: { studentId: true, body: true, createdAt: true, date: true },
    }),
    getParentOutstandingForStudents(kidIds, session.tenantId),
    // Per-kid perkembangan rollup — drives the "Perkembangan pekan ini"
    // card section below. Fan out across children in parallel; the
    // loader itself is two cheap queries per kid (semester + entries
    // joined on indicator.objective.semesterId), so the round-trip
    // count stays bounded by the active-children count.
    Promise.all(
      kidIds.map((id) =>
        loadStudentPerkembangan(session.tenantId as string, id).then(
          (data) => [id, data] as const,
        ),
      ),
    ).then((rows) => new Map(rows)),
    scheduledClassIds(session.tenantId, children.flatMap(child => child.student.enrollments.filter(e => e.status === "ACTIVE").map(e => e.classSection.id)), today),
  ]);

  // Latest note per kid (notes already ordered desc by createdAt)
  const latestNoteByKid = new Map<
    string,
    { body: string; createdAt: Date; date: string }
  >();
  for (const n of latestNotes) {
    if (!latestNoteByKid.has(n.studentId)) {
      latestNoteByKid.set(n.studentId, {
        body: n.body,
        createdAt: n.createdAt,
        date: n.date,
      });
    }
  }

  const { count: unpaidCount, total: unpaidTotal } = outstanding;
  const billsByChild = children.map((child) => {
    const items = outstanding.items.filter((item) => item.studentId === child.studentId);
    return {
      id: child.studentId,
      name: child.studentName,
      count: items.length,
      total: items.reduce((sum, item) => sum + item.remaining, 0),
      // Past due by the Jakarta calendar day (`today`); remaining > 0 already holds.
      overdue: items.filter((item) => item.dueDate < today).length,
      nearestDue: items.reduce<string | null>((date, item) => !date || item.dueDate < date ? item.dueDate : date, null),
    };
  }).filter((child) => child.count > 0)
    .sort((a, b) => (a.nearestDue ?? "").localeCompare(b.nearestDue ?? ""));

  const billRow = (bill: (typeof billsByChild)[number]) => (
    <TaskRow
      key={bill.id}
      href={parentHref("/parent/invoices", bill.id)}
      title={`Tagihan ${bill.name}`}
      description={
        bill.overdue > 0 ? (
          <>
            {bill.count} tagihan belum dibayar ·{" "}
            <span className="font-semibold text-status-absent-text">{bill.overdue} lewat tempo</span>
          </>
        ) : (
          `${bill.count} tagihan belum dibayar · jatuh tempo terdekat ${formatDate(bill.nearestDue!, { day: "numeric", month: "short", year: "numeric" })}`
        )
      }
      icon={<Receipt className="size-5" />}
      meta={<Amount value={bill.total} size="row" />}
      stackMeta
      tone={bill.overdue > 0 ? "danger" : "warm"}
    />
  );
  // One child owing means the family total IS that child's row (the totals are
  // sums over the same invoices), so the header would print the same amount twice.
  const singleBill = billsByChild.length === 1;

  // `Parent.name` already carries an honorific ("Ibu Rina"), and the guardian
  // relationship is stored in Indonesian (AYAH/IBU/WALI) — both handled in
  // lib/parent-greeting.ts.
  const greetingFirst = parentGreetingName(parent.name);
  const honorific = parentHonorific(children[0]?.relationship);
  const greetingTitle = `Assalamu'alaikum, ${honorific} ${greetingFirst}`;
  const dateLine = formatDate(today, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const hijri = formatHijri(now);

  // Build KidCard data per child
  const kids = children.map((c) => {
    const attMap = attendanceByKid.get(c.studentId) ?? new Map<string, ParentDayAttendance>();
    const todayStatus = attMap.get(today)?.status as ParentAttendanceStatus | undefined;
    const counts = { hadir: 0, sakit: 0, alpa: 0, izin: 0, logged: 0, mixed: 0 };
    for (const d of week) {
      const status = attMap.get(d)?.status;
      if (status === "PRESENT") counts.hadir += 1;
      else if (status === "SICK") counts.sakit += 1;
      else if (status === "ABSENT") counts.alpa += 1;
      else if (status === "PERMISSION") counts.izin += 1;
      if (status === "MIXED") counts.mixed += 1;
      if (status) counts.logged += 1;
    }
    const foot = buildKidFoot(todayStatus, counts);
    const latestTeacherNote = latestNoteByKid.get(c.studentId);
    const teacherNote = latestTeacherNote && now.getTime() - latestTeacherNote.createdAt.getTime() <= 14 * 24 * 60 * 60 * 1000
      ? latestTeacherNote.body
      : null;
    const displayName = c.studentName;
    return {
      id: c.studentId,
      name: displayName,
      // "KB" alone is cryptic; the other parent pages spell it "KB · Kelompok Bermain".
      className: [c.className, c.programName && c.programName !== c.className ? c.programName : null].filter(Boolean).join(" · ") || "—",
      todayStatus: knownAttendanceStatus(todayStatus) ? todayStatus : null,
      todayScheduled: c.student.enrollments.some(e => e.status === "ACTIVE" && scheduledClasses.has(e.classSection.id)),
      teacherNote,
      foot,
    };
  });
  const attendanceNeedsAttention = kids.filter((kid) => kid.todayStatus === "MIXED" || kid.todayStatus === "ABSENT" || kid.todayStatus === "SICK" || kid.todayStatus === "PERMISSION");
  const attendanceUnknown = kids.filter((kid) => kid.todayStatus === null && kid.todayScheduled);
  const attendanceFocus = attendanceNeedsAttention[0] ?? attendanceUnknown[0] ?? kids[0];
  const attendanceStatusLabels = PARENT_ATTENDANCE_LABELS;
  const attendanceDescription = attendanceFocus?.todayStatus === "MIXED"
    ? "Catatan berbeda antar kelas. Lihat rincian kehadiran dari sekolah."
    : attendanceFocus?.todayStatus
    ? `${attendanceStatusLabels[attendanceFocus.todayStatus]} hari ini, sesuai catatan sekolah.`
    : `${attendanceFocus?.name} belum memiliki catatan kehadiran hari ini.`;

  const attendanceNotice = kids.every(kid => kid.todayStatus === "PRESENT") ? (
    <Alert variant="success" announcement="off">
      <CalendarDays aria-hidden="true" />
      <AlertTitle>{kids.length === 1 ? kids[0]!.name : `${kids.length} anak`} sudah hadir.</AlertTitle>
      <AlertDescription>Kehadiran hari ini dicatat sekolah.</AlertDescription>
    </Alert>
  ) : attendanceNeedsAttention.length === 0 && attendanceUnknown.length === 0 ? (
    <Alert announcement="off">
      <CalendarDays aria-hidden="true" />
      <AlertTitle>Tidak ada kehadiran yang perlu diperiksa</AlertTitle>
      <AlertDescription>Anak tanpa jadwal sesi hari ini tidak perlu dicatat hadir. Catatan yang sudah tersimpan tetap terlihat di bawah.</AlertDescription>
    </Alert>
  ) : (
    <TaskList>
      <TaskRow
        href={parentHref("/parent/attendance", attendanceFocus?.id)}
        title={attendanceNeedsAttention.length > 0 ? `Periksa kehadiran ${attendanceFocus?.name}` : `Kehadiran ${attendanceFocus?.name} belum dicatat`}
        description={attendanceDescription}
        icon={<CalendarDays className="size-5" />}
        tone="warm"
      />
    </TaskList>
  );

  return (
    <div className="space-y-section">
      <PageHeader
        title="Kabar keluarga hari ini"
        subtitle={
          <>
            <span className="block">{greetingTitle}</span>
            <span className="mt-0.5 block text-small">
              <span className="inline-block">{dateLine}</span>
              {hijri ? <> <span className="inline-block">· {hijri}</span></> : null}
            </span>
          </>
        }
        className="mb-0"
      />

      <section aria-labelledby="household-actions-heading" className="space-y-3">
        <SectionHeading as="h2" id="household-actions-heading">Hari ini</SectionHeading>
        {attendanceNeedsAttention.length > 0 ? attendanceNotice : null}
        {unpaidTotal > 0 ? (
          <TaskList>
            {singleBill ? null : (
              <CardContent className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Tagihan keluarga</p>
                  <p className="text-xs text-muted-foreground">{unpaidCount} tagihan belum dibayar</p>
                </div>
                <Amount value={unpaidTotal} size="row" className="shrink-0" />
              </CardContent>
            )}
            {billsByChild[0] && billRow(billsByChild[0])}
            {billsByChild.length > 1 && (
              <Collapsible className="border-t border-border">
                <CollapsibleTrigger className={buttonVariants({ variant: "ghost", className: "group min-h-11 w-full justify-between rounded-none px-4 text-primary-text" })}>
                  Tagihan {billsByChild.length - 1} anak lainnya
                  <ChevronRight aria-hidden="true" className="size-4 group-data-panel-open:rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent keepMounted>
                  {billsByChild.slice(1).map(billRow)}
                </CollapsibleContent>
              </Collapsible>
            )}
          </TaskList>
        ) : (
          <Alert variant="celebration" announcement="off">
            <Sparkles aria-hidden="true" />
            <AlertTitle>Lunas semua</AlertTitle>
            <AlertDescription>Alhamdulillah, tidak ada tagihan tertunda.</AlertDescription>
          </Alert>
        )}
        {attendanceNeedsAttention.length === 0 ? attendanceNotice : null}
      </section>

      <section aria-labelledby="children-heading">
        <SectionHeading as="h2" id="children-heading">Anak saya</SectionHeading>
        <div className="space-y-3">
          {kids.map((k) => (
            <KidCard
              key={k.id}
              id={k.id}
              name={k.name}
              className={k.className}
              todayStatus={k.todayStatus}
              todayScheduled={k.todayScheduled}
              teacherNote={k.teacherNote}
              foot={k.foot}
            />
          ))}
        </div>
      </section>

      {(() => {
        // Per-kid perkembangan cards — hidden when no kid has any
        // entries this week so the home stays calm on quiet days.
        const perkembanganKids = children
          .map((c) => ({
            child: c,
            data: perkembanganByKid.get(c.studentId),
          }))
          .filter(
            (row): row is { child: typeof row.child; data: NonNullable<typeof row.data> } =>
              !!row.data &&
              row.data.hasActiveWeek &&
              row.data.latestThisWeek.length > 0,
          );
        if (perkembanganKids.length === 0) return null;
        return (
          <section aria-labelledby="development-heading" data-testid="home-perkembangan-section">
            <SectionHeading
              as="h2"
              id="development-heading"
              label="Perkembangan pekan ini"
              description="Ini tahapan perkembangan, bukan nilai."
            />
            <div className="space-y-3">
              {perkembanganKids.map(({ child, data }) => {
                const displayName = child.studentName;
                return (
                  <Link
                    key={child.studentId}
                    href={`/parent/perkembangan/${child.studentId}`}
                    data-testid={`home-perkembangan-card-${child.studentId}`}
                    className="group block rounded-xl focus-visible:focus-outline"
                  >
                    <SectionCard as="div" className="transition-colors group-hover:border-primary/30 group-active:border-primary/40">
                      <div className="flex items-center gap-3">
                        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary-text">
                          <LineChart className="size-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="wrap-anywhere text-body font-semibold">
                            {displayName}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {data.latestThisWeek.length} catatan pekan ini
                          </p>
                        </div>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {data.latestThisWeek.slice(0, 3).map((entry, idx) => (
                          <li
                            key={`${entry.date}-${entry.indicatorContent}-${idx}`}
                            className="flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-muted-foreground">
                                {formatCurriculumElement(entry.element)}
                                {entry.source === "CENTER" && (entry.sentraName || entry.center) && (
                                  <> · {formatEntrySentra({ center: entry.center, sentra: entry.sentraName ? { name: entry.sentraName } : null })}</>
                                )}
                              </p>
                              <p className="line-clamp-2 text-xs text-foreground">
                                {entry.indicatorContent}
                              </p>
                            </div>
                            <Badge
                              variant={entry.level === "CONSISTENT" ? "success" : "secondary"}
                              className="h-auto min-h-5 max-w-[45%] justify-end whitespace-normal text-right"
                            >
                              {LEVEL_LABEL_LONG[entry.level] ?? entry.level}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </SectionCard>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })()}

    </div>
  );
}
