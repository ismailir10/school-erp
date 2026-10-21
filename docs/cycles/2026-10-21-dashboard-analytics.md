# Dasbor analytics: kehadiran siswa, buku penghubung, keuangan

## Context

The user asked to "improve dashboard to include some useful analytics, use react bit! make sure it's good and cool".

Today the admin Dasbor is a single "Perlu ditangani" screen: queue tiles, two finance tiles (overdue count, piutang), the top four urgent items, one line of employee attendance, and an activity rail. The 2026-09-25 admin overhaul locked it to one 1440×900 screen with "no charts or launchers" (`patterns.md`). It answers "what needs me now" well and says nothing about trends: an admin cannot see whether student attendance is slipping, whether teachers are keeping the buku penghubung, or how much of this month's billing has come in, without opening three modules and doing the arithmetic.

The repo already carries a React Bits motion layer in `components/reactbits/` (CountUp, Spotlight, Stagger, BlurText, a CSS Aurora port), adapted for SSR, reduced motion and no new dependencies (2026-09-30, 2026-10-04 cycles). Those pieces only animate on a fresh client mount, so anything on a hard-loaded page renders static. Analytics below the fold would never animate as things stand.

The data exists. Student attendance (`StudentAttendance`, admin-only), journal entries and notes (`StudentJournalEntry`, `StudentJournalNote`, admin-only, monitoring defines completion as checked SCHOOL cells / students × active SCHOOL indicators × 5), invoices and payments (`invoices.view`). The demo seed only writes 5 school days of student attendance and journal entries, so a 30-day chart would show 5 points.

UAT input (2026-09-29 full e2e, admin): X-6 (major, new inquiries not surfacing on the Dasbor) and DOC-6 (activity feed empty) are about the action region, not analytics; out of scope here. Its seed note "seed payments for the current month so the Dasbor is not zero on day one" is already handled by the seed.

## Decisions

1. **Placement: below the fold on the Dasbor** (user's choice). The "Perlu ditangani" region stays exactly as the first screen; a new "Analitik" section follows it. The one-screen rule becomes "the action region fits the first screen" and `patterns.md` is updated to say so.
2. **Scope: student attendance, buku penghubung, keuangan** (user's choice). Student/class composition and the admissions funnel are not in this cycle.
3. **Streamed, not blocking.** The analytics section renders inside a Suspense boundary with a skeleton, so the action region's load time does not change.
4. **Gated like the modules they summarise.** Attendance and journal analytics show to every admin role (their pages and APIs are admin-only). Finance analytics need `invoices.view`. A failed source shows a retry state, never a false zero (same contract as the Dasbor's other sources).
5. **Motion via a new React Bits port, FadeContent → `FadeContent` reveal.** Upstream depends on GSAP; port it dependency-free like Aurora. Content stays server-rendered and visible; after hydration, a section that is still below the viewport is hidden and revealed (fade + rise + de-blur) as it scrolls in, and its children remount at that moment, so the existing CountUp, Stagger and the recharts entry animations play exactly once, when the admin actually sees them. Reduced motion, no IntersectionObserver, or already-in-view: nothing is hidden, nothing replays.
6. **A headline band** with the Aurora backdrop and Spotlight: three big CountUp percentages (attendance 30 days, collection this month, journal completion this week), each linking to its module. This is the "cool" moment and the summary an admin reads first.
7. **No new npm dependency.** recharts (via `components/ui/chart.tsx`) and framer-motion are already installed.
8. **No cache layer.** Every query is a bounded aggregate (groupBy over a 30-day, 8-week or 6-month window); streaming hides their latency. Numbers stay as live as the action region above them.
9. **Seed history.** Extend the demo seed with roughly four more weeks of student attendance and journal history before the existing five session-linked days, so local verification and staging show a real trend. Older rows are written without a session (the legacy shape the schema already allows) so no existing session-linked flow changes.

## Acceptance criteria

- [ ] At 1440×900 the full-permission admin sees the whole "Perlu ditangani" region without scrolling; an "Analitik" section follows below it.
- [ ] Headline band: attendance rate (last 30 days, with the change in points versus the 30 days before), collection rate for invoices due this month (with "Rp x dari Rp y"), and buku penghubung completion this week. Each links to its module. A KPI whose source is hidden is not rendered; one whose source failed shows "—".
- [ ] Kehadiran siswa card: daily attendance rate for each day in the last 30 days that has records, with the present / izin / sakit / alpa breakdown on hover, and the three classes with the lowest rate (name, rate, record count) linking to student attendance.
- [ ] Buku penghubung card: weekly completion (Mon–Fri, SCHOOL scope, same definition as Monitoring) for the last 8 weeks, notes written by teachers and by wali over the same 8 weeks, and the three classes least complete this week.
- [ ] Keuangan cards (only with `invoices.view`): billed vs collected per month for the last 6 months; outstanding piutang by age bucket (belum jatuh tempo, 1–30, 31–60, 61–90, > 90 hari) with amount and invoice count. Reversed payments, draft and cancelled invoices are excluded.
- [ ] A school with no data in a window sees an empty state per card, not a flat-zero chart.
- [ ] A source that throws shows a retry state on its card only; the rest of the section and the action region still render.
- [ ] Motion: on a hard load, scrolling the section into view plays one fade-in reveal, the CountUps count up, and the charts draw. Under `prefers-reduced-motion` everything is static and visible. With JS disabled the server HTML shows every number.
- [ ] Numbers are tenant-scoped: another tenant's attendance, entries, notes, invoices and payments never count.
- [ ] Layout works at 390 px (cards stack, charts keep their height, no horizontal scroll).

## Verify flows

1. **Super admin, /admin, 1440×900.** Action region fits; scroll down; Analitik reveals, three KPIs count up, four cards render charts with seeded data; hover a chart point and see the breakdown; click "Lihat kehadiran" from the lowest-classes list and land on student attendance.
2. **School admin, /admin.** Sees attendance, journal and finance analytics if their role holds `invoices.view`; nothing about payroll or HR appears.
3. **Edge: reduced motion.** Emulate `prefers-reduced-motion: reduce`, hard load, scroll: everything visible immediately, no reveal, no count-up.
4. **Error: a source fails.** A loader unit test forces a throw; the card shows "Data belum dapat dimuat" with a retry, siblings unaffected.

## UX notes

- Section heading "Analitik" with a one-line description of the windows ("30 hari terakhir · 8 minggu · 6 bulan" spread across cards, each card states its own window).
- Headline band: three columns at md+, stacked on mobile. Big numbers in `text-display`, tabular numerals, the delta as a small status-toned chip (green up, red down, muted flat).
- Charts follow the existing `AttendanceTrendChart` card shape (Card, title, window caption, `ChartContainer`), status tokens for attendance series, brand teal for collected, muted for billed.
- Empty state per card: "Belum ada data kehadiran 30 hari terakhir." and equivalents, via `EmptyState`.
- Copy follows `voice.md` (admin persona, concise Indonesian).

## Test seams

- Vitest (node): the pure aggregation helpers: daily rate and window delta, lowest classes ranking, week bucketing and completion capping, month bucketing, aging buckets; plus each loader with a mocked prisma (tenant filter present, excluded statuses).
- Vitest (jsdom): FadeContent (static on hydrate, reduced motion, IO reveal + remount), the headline band (hidden / unavailable / ready), card empty and unavailable states.
- E2E: `admin-dashboard.spec.ts` "fits one screen" becomes "action region fits the first screen"; a new test scrolls to Analitik and asserts the KPIs and each card show a chart or its empty state.

## Non-goals

- Student composition, class fill, admissions funnel analytics.
- Filters (campus, class, date range) and export.
- Teacher or parent portal analytics.
- Fixing UAT X-6 / DOC-6 in the action region.
- Changing the existing Dasbor tiles or the employee-attendance chart.

## Assumptions

1. Attendance rate = present / all non-voided records (sakit and izin count as not present; the breakdown shows them separately).
2. Historical journal completion uses today's active students and active indicators as the denominator (the schema keeps no history of either); capped at 100%.
3. "Collection this month" = Σ totalPaid / Σ totalDue over invoices due this month (Jakarta), excluding draft and cancelled.
4. Billed per month is bucketed by due date; collected per month by payment date in Asia/Jakarta.
5. The seed extension does not change any count an existing e2e asserts; if the full Playwright run says otherwise, the seed change is narrowed, not the tests.

## Gate re-openers

None: no schema migration, no new dependency, no auth or permission change (analytics reuse existing gates), no production write.

## Tasks

- [x] T1 Analytics loaders — accept: `lib/dashboard/analytics/*` exports pure helpers + three tenant-scoped loaders (attendance, journal, finance), vitest green (deps: none; reuse: `UNPAID_INVOICE_STATUSES`, `getTodayInTimezone`, monitoring's completion definition). Parallel with T2.
- [x] T2 FadeContent port — accept: `components/reactbits/fade-content.tsx` + test; static on hydrate / reduced motion; hides only when below the viewport after hydration; reveals and remounts children on intersect (deps: none; reuse: `use-prefers-reduced-motion`). Parallel with T1.
- [ ] T3 Analytics UI — accept: headline band + four cards + section with Suspense skeleton and per-card unavailable state, wired into `/admin`; component tests green (deps: T1, T2; reuse: `ChartContainer`, `AttendanceTrendChart` shape, `CountUp`, `Spotlight`, `Aurora`, `Stagger`, `EmptyState`, `DashboardRetry`).
- [ ] T4 Seed history — accept: seed writes ~4 more weeks of sessionless student attendance and journal entries/notes before the recent days; seed runs clean; existing e2e unchanged (deps: none). Parallel with T1/T2.
- [ ] T5 E2E + docs — accept: `admin-dashboard.spec.ts` updated and new Analitik test; `patterns.md` Dasbor rule, README module line, `docs/uat/jobs/admin.md` updated (deps: T3).

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5; T1+T2+T4 parallel (disjoint files: lib/dashboard/analytics, components/reactbits, prisma/seed.ts), T3 parallel against the fixed T1/T2 contracts (components/admin/dashboard/analytics, app/admin/page.tsx), T5 inline by the driver (docs + one e2e file, needs the whole cycle as context). Workers do not commit; the driver re-runs each task's tests and commits it.
- T1: `lib/dashboard/analytics/{types,helpers,attendance,journal,finance,index}.ts`. Journal completion mirrors the Monitoring classes route (active academic year, ACTIVE classes, current enrolments, ACTIVE SCHOOL indicators × 5, capped at 100%; entries are not filtered by indicator status, as in the route). Note authors: `TEACHER` and `GUARDIAN` (`authorRole` = session role). Collected per month is one `$queryRaw` joining Payment → Invoice for the tenant, REVERSED excluded, bucketed in Asia/Jakarta. Aging groups unpaid invoices by due date. 43 Vitest cases.

- T2: `components/reactbits/fade-content.tsx`, a dependency-free port of React Bits FadeContent (IntersectionObserver + inline CSS transitions, no GSAP, no framer-motion). Static on the server, during hydration, under reduced motion, without IntersectionObserver, or when already in view; otherwise armed off-screen and revealed once, with the children remounted through a keyed Fragment so CountUp, Stagger and chart draw-in play on reveal. The threshold is capped for elements taller than the viewport so content cannot be stranded hidden; inline styles are dropped after the transition. 14 Vitest cases, including a real `hydrateRoot` pass.

## Verification

- [x] Cross-checked design-system.html (motion: only 120–140 ms state transitions and the skeleton shimmer are defined; no section-reveal rule) for FadeContent: it adds no colour, type or spacing and changes only opacity / transform / filter, so the reference is not contradicted. The UI tasks get their own cross-check below.

## Ship Notes
