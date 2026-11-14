# Performance hot paths

## Context

Requested: inspect slow loads and inefficient code, then optimize with staff-engineer judgment and YAGNI. Audited staging `d69339ac` on 2026-11-15 (Asia/Tokyo). The findings below are established from code; production latency, query plans and bundle sizes have not been measured. No speedup percentage is claimed.

Parent Home reads historical notes and semester assessment aggregates that its cards do not display. Teacher journal badges transfer note histories just to count them. The admin guardian list retrieves full list payloads three times solely to obtain summary totals. These paths get more expensive as school history grows.

Recent parent/teacher work is recorded in the November 14 audit cycle. Its behavior, especially sibling separation, current-week scope and unknown-on-failure handling, must be preserved. No matching tracked UAT report was available in this fresh checkout; no historical timing claim is treated as current evidence.

## Decisions

- First pass: eliminate unnecessary reads and requests in four narrow seams. Reuse existing Prisma and stats-endpoint patterns.
- Keep current content, freshness and permissions. No shared cache, new dependency, schema change or speculative index.
- A bounded note lookup per authorized child is preferable to a custom SQL latest-per-group query at ordinary household sizes; measure its round-trip tradeoff locally.
- Preserve the active-semester gate and age-group/week selection when extracting the home assessment preview. Full semester totals remain available on the development detail page.
- Leave broader teacher-home batching and student-list navigation changes for a separately verified follow-up; they alter failure boundaries or navigation behavior.

## Acceptance criteria

- [ ] Parent Home shows the same latest eligible teacher note for each child while returning at most one note per child from the database; missing and older-than-14-day notes behave as before.
- [ ] Parent Home shows the same latest three development entries and empty states without reading the full semester assessment history.
- [ ] Unread counts remain exact for mixed read times, never-opened threads and multiple students; note query results contain at most one count row per student, with existing tenant/author/status restrictions retained.
- [ ] Guardian summary totals remain correct, including an empty tenant and after edits/status changes. Initial loading uses one list request and one aggregate request, replacing four list requests.
- [ ] Focused regressions, repository gates and local browser flows pass. Before/after evidence reports query calls, returned rows and request counts; any timing result names its local dataset and environment.

## Verify flows

1. Guardian, parent Home: view multiple children with different latest notes and current-week assessments; compare the displayed cards and navigate into development details. Confirm no semester history read on Home and unchanged detail totals.
2. Guardian, empty edges: no active semester/week, child without a class, no notes and a stale note. Confirm the existing empty states and 14-day display rule.
3. Teacher, Home and journal: mixed read watermarks and a never-opened thread, including a child in multiple classes. Check counts, open a thread, return and check refreshed counts. Simulate a failed lookup and retain the existing unknown/error state.
4. Admin, guardians: compare total/active/inactive cards with list data, change a status and refresh, then exercise an empty dataset and failed stats request. Confirm no false successful totals and no extra list requests for stats.

## UX notes

No new steps, taps or choices. Home is still zero taps after sign-in; opening existing details remains one tap. Reuse existing design-system components and loading/error feedback; no visual redesign.

## Test seams

- Existing parent Home and curriculum-loader tests: preview equivalence, bounded latest notes, exact 14-day boundary, empty gates and sibling isolation. Preserve recordedAt ordering, Jakarta dates and sentra/activity formatting.
- Existing journal note-read tests: strictly-after watermark semantics, never-opened threads, own-author exclusion, optional role filter, tenant/status restriction and empty roster. Add a disposable-Postgres comparison against the single-student count helper without a role filter, and explicit matching count queries for role-filtered cases, to verify database predicate semantics.
- Guardian stats route and UI tests: tenant/admin guard, all status counts, failed request handling and mutation refresh. Reuse student stats conventions.
- Existing Playwright parent/teacher/guardian flows plus focused assertions for request counts.

## Non-goals

Production promotion, auth or permission changes, schema/index migrations, caching infrastructure, dependency upgrades, generic repository cleanup, dashboard rewrites and speculative memoization.

## Assumptions

1. Staging is the implementation base.
2. Existing UI/data behavior is the compatibility contract.
3. Local demo auth and disposable Postgres are used for verification; production data is not needed for this first pass.

## Gate re-openers

New dependency, schema migration, permission/PII behavior change, shared-environment write or production promotion.

## Tasks

- [ ] T1 Bound parent Home teacher-note reads — accept: newest note unchanged, maximum one returned note per child. Reuse existing authorized child list and tests.
- [ ] T2 Extract the lightweight development preview and reuse it in Home/detail — accept: Home does not query semester history, existing detail totals unchanged. Can run independently of T3/T4; coordinate with T1 on Home tests.
- [ ] T3 Aggregate unread counts in Postgres using exact per-student read predicates — accept: equivalence with single-student count semantics, bounded result rows. Independent of T1/T2/T4.
- [ ] T4 Replace guardian count-only list requests with one stats endpoint — accept: four requests become two, totals/guards/errors preserved. Independent of T1/T2/T3.
- [ ] T5 Run local full gate, compare work performed, inspect browser flows and prepare reviewed PR. Depends on T1–T4.

## Implementation

- Plan: driver=gpt-6, workers=gpt-6; T1 then T2 sequential in one worker because they share Home and its tests; T3 and T4 in parallel workers; T5 integration, review and verification driven centrally.
- User explicitly approved all four optimizations and confirmed staging as the base on 2026-11-15.

### Audit evidence

| Priority | Evidence at audited revision | Consequence | Proposed reduction |
| --- | --- | --- | --- |
| High | `app/parent/page.tsx:146–189`: unbounded teacher-note query, newest-per-child reduction in JS | Historical notes transferred on every Home visit | All matching history → at most one note per child |
| High | `app/parent/page.tsx:164,388–429`; `lib/curriculum/perkembangan-loader.ts:123–159`: Home consumes preview fields, full loader also reads semester entries | Unused semester scan and mapping; extra serial work per child | Remove one unbounded assessment read per child from Home |
| High | `lib/student-journal/note-reads.ts:79–120`: oldest-watermark candidate scan, in-memory counts | One stale watermark broadens the whole roster's fetched history | History-sized results → at most one aggregate row per student |
| Medium | `app/admin/guardians/page.tsx:196–207`; `app/api/guardians/route.ts:37–66` | Three extra list requests include child relations purely for totals | Four requests/eight top-level Prisma calls → two requests/three top-level calls |

Additional findings, deferred: teacher Home repeats two unread queries per class and waits for schedule resolution before independent class reads (`app/teacher/page.tsx:78–90`); student list URL mirroring calls `router.replace` in addition to its data fetch (`app/admin/students/page.tsx:692`); enrollment detail eagerly imports its conditional edit form (`app/admin/enrollments/[id]/page.tsx:14,300`). The latter needs actual bundle measurement before prioritization; raw source size is not transfer size.

Already sound: admin work queue limits/projections, receivables SQL aggregation, parallel dashboard sources and streamed analytics. PDF/Excel libraries are server-side; no broad package surgery justified.

## Verification

- Baseline: Prisma Client generation passed; the existing curriculum loader, journal note-read and parent Home summary suites passed: **3 files, 44 tests**, 1.55 seconds. These validate existing behavior, not a proposed fix.
- Isolated worktree and hooks installed; Node 24.22.1. Dependencies installed from the unchanged lockfile with a writable temporary npm cache after the default cache caused installation failures.
- Documentation audit regenerated the cycle count and passed; the pre-existing ADR-age warning remains. Whitespace check passed.
- Production build, full suite, browser walk, timing measurements and database query-plan verification are pending implementation. No performance validation or speedup is yet claimed.

## Ship Notes

Not shipped. Isolated branch: `feat/performance-hot-paths`. No PR, merge or deployment.
