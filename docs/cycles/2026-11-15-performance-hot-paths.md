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

- [x] Parent Home shows the same latest eligible teacher note for each child while returning at most one note per child from the database; missing and older-than-14-day notes behave as before.
- [x] Parent Home shows the same latest three development entries and empty states without reading the full semester assessment history.
- [x] Unread counts remain exact for mixed read times, never-opened threads and multiple students; note query results contain at most one count row per student, with existing tenant/author/status restrictions retained.
- [x] Guardian summary totals remain correct, including an empty tenant and after edits/status changes. Initial loading uses one list request and one aggregate request, replacing four list requests.
- [x] Focused regressions, repository gates and local browser flows pass. Before/after evidence reports query calls, returned rows and request counts; any timing result names its local dataset and environment.

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

- [x] T1 Bound parent Home teacher-note reads — accept: newest note unchanged, maximum one returned note per child. Reuse existing authorized child list and tests.
- [x] T2 Extract the lightweight development preview and reuse it in Home/detail — accept: Home does not query semester history, existing detail totals unchanged. Can run independently of T3/T4; coordinate with T1 on Home tests.
- [x] T3 Aggregate unread counts in Postgres using exact per-student read predicates — accept: equivalence with single-student count semantics, bounded result rows. Independent of T1/T2/T4.
- [x] T4 Replace guardian count-only list requests with one stats endpoint — accept: four requests become two, totals/guards/errors preserved. Independent of T1/T2/T3.
- [x] T5 Run local full gate, compare work performed, inspect browser flows and prepare reviewed PR. Depends on T1–T4.

## Implementation

- Plan: driver=gpt-6, workers=gpt-6; T1 then T2 sequential in one worker because they share Home and its tests; T3 and T4 in parallel workers; T5 integration, review and verification driven centrally.
- User explicitly approved all four optimizations and confirmed staging as the base on 2026-11-15.
- T1: parent Home now queries the newest active teacher note per authorized child; the returned note payload is bounded by household size. The existing 14-day display check stays unchanged.
- T2: shared current-week preview logic is reused by Home and detail. Home skips semester history entirely; detail loads its rollup and preview concurrently and omits unused indicator content from its rollup projection.
- T3: unread counts use exact per-student watermark predicates and a database groupBy, retaining tenant/status/author filters and zero-count omission.
- T4: guardian summary cards use one tenant-scoped stats endpoint; mutation refresh remains in place. An unsuccessful request displays unknown totals rather than false zeros, using existing StatTile and toast components (design-system unchanged).
- Independent standards, specification and security reviews found no blocking issues. The first production build caught a nullable test email and loss of tenant narrowing inside a callback; both were corrected before the passing production build.

### Audit evidence

| Priority | Evidence at audited revision | Consequence | Proposed reduction |
| --- | --- | --- | --- |
| High | `app/parent/page.tsx:146–189`: unbounded teacher-note query, newest-per-child reduction in JS | Historical notes transferred on every Home visit | All matching history → at most one note per child |
| High | `app/parent/page.tsx:164,388–429`; `lib/curriculum/perkembangan-loader.ts:123–159`: Home consumes preview fields, full loader also reads semester entries | Unused semester scan and mapping; extra serial work per child | Remove one unbounded assessment read per child from Home |
| High | `lib/student-journal/note-reads.ts:79–120`: oldest-watermark candidate scan, in-memory counts | One stale watermark broadens the whole roster's fetched history | History-sized results → at most one aggregate row per student |
| Medium | `app/admin/guardians/page.tsx:196–207`; `app/api/guardians/route.ts:37–66` | Three extra list requests include child relations purely for totals | Four requests/eight top-level Prisma calls → two requests/three top-level calls |

Additional findings, deferred: teacher Home repeats two unread queries per class and waits for schedule resolution before independent class reads (`app/teacher/page.tsx:78–90`); student list URL mirroring calls `router.replace` in addition to its data fetch (`app/admin/students/page.tsx:692`); enrollment detail eagerly imports its conditional edit form (`app/admin/enrollments/[id]/page.tsx:14,300`). The latter needs actual bundle measurement before prioritization; raw source size is not transfer size.

The driver reproduced the student-list follow-up in the production build after initial requests settled: one search produced a GET to `/api/students?...&search=performance-audit-no-match` plus `/admin/students?q=performance-audit-no-match&_rsc=...`. The latter carried `rsc: 1` and `next-router-state-tree`, without prefetch headers; clearing search repeated the pair. This confirms an extra navigation request, not a measured production delay. No navigation behavior was changed in this cycle.

Already sound: admin work queue limits/projections, receivables SQL aggregation, parallel dashboard sources and streamed analytics. PDF/Excel libraries are server-side; no broad package surgery justified.

## Verification

- Baseline: Prisma Client generation passed; the existing curriculum loader, journal note-read and parent Home summary suites passed: **3 files, 44 tests**, 1.55 seconds. These validate existing behavior, not a proposed fix.
- Isolated worktree and hooks installed; Node 24.22.1. Dependencies installed from the unchanged lockfile with a writable temporary npm cache after the default cache caused installation failures.
- Documentation audit regenerated the cycle count and passed; the pre-existing ADR-age warning remains. Whitespace check passed.
- Production build/typecheck and lint passed after the two type corrections. RLS coverage: 51/51; API-auth coverage: 240/240. Hook tests: 32 passed; documentation regression: 7 passed; vendored workflow checksum passed.
- Driver-rerun disposable-Postgres comparison: 6,011 synthetic notes; old unread query returned 6,006 candidate rows (6,004 with guardian filter), new query returned 3 aggregate rows. Counts matched independent per-student queries across mixed watermarks, exact timestamp boundaries, never-opened threads, own/inactive/foreign-tenant notes, duplicate IDs and empty rosters. Synthetic rows were removed in finally. Script: `/tmp/school-erp-note-count-check.ts`.
- Driver-rerun read-only parent comparison: three seeded children returned identical latest notes, 5 history rows → 3 latest rows, with SQL calls increasing 1 → 3. Seven alternating warm local samples had median 3.17 → 5.44 ms: this is a bounded-history tradeoff, not a demonstrated latency win on a tiny fixture.
- Development fixture: 13 entries in the selected week and 27 semester entries. Home's assessment rows fell 30 → 3 and SQL calls 14 → 11 (including relation reads); top-level Prisma calls fell 5 → 4. Actual SQL retained recordedAt descending and LIMIT. Original detail and new detail outputs were identical; preview matched the original subset. The harness temporarily fixed its own clock to November 2 within the seeded week, restored it afterwards, and wrote no database rows. No-semester tenant returned empty after only the semester operation. Script: `/tmp/perf-parent-db-verify.ts`; seven alternating warm loader medians 31.55 → 24.64 ms on local seeded Postgres while other checks ran. These are not production or whole-page timings.
- First full Vitest: 775 passed files / 9,596 passed tests, one failed test, two pre-existing skipped files and 42 todo. The sentra-access integration test's generic Prisma mock returned null for groupBy; corrected it to return an array and tightened the allowed class-grid assertion to HTTP 200. Runtime code was unchanged. Final typecheck and changed-file lint passed.
- Final full Vitest: **776 passed files, 9,597 passed tests**, two pre-existing skipped files and 42 todo; exit 0, 513.26 seconds with three workers. No new skips or timeout overrides.
- Full Playwright: **303 passed, retries disabled (12.3 minutes)**. Includes guardian initial request-count assertion and edit/persistence flow. No production latency or query-plan measurement is claimed.
- Driver-rerun browser walk: guardian list made exactly one list and one stats request; displayed totals matched the endpoint. Browser-only injected stats 503 showed three unknown counters and the existing toast, reload recovered, and a simulated successful zero response showed zeros. This zero-response check is not an actual empty-tenant browser fixture; that endpoint case is unit-tested. Both admin roles returned 200 with stats matching list totals; teacher, parent and anonymous requests returned 403.
- Parent Home at 390x844 and 1440x900, development detail, and teacher Home at 390x844 passed with no horizontal overflow. On port 3001 only, a temporary server-clock preload set November 2 within the seeded week: two sibling cards each showed exactly three entries matching their detail API; clicking through preserved the 27-entry semester totals. The teacher note appeared once and two siblings retained their empty-note state. The separate server stopped afterwards; no product configuration or database rows changed.
- Browser captures had no JavaScript page errors or unexpected application HTTP errors. Optional localhost Vercel telemetry scripts returned 404/MIME errors; the stats 503 was deliberately injected; canceled RSC prefetch requests came from navigation/reloads/context closure. Visual inspection of guardian, parent, teacher and active-week cards passed. Screenshots: `/tmp/school-erp-performance-shots/`; highlights are `guardian-list-desktop.png` and `parent-active-week-cards.png`.

### Verified locally — c176e1ea, 2026-11-15

- Gate: production build, lint, typecheck, `npx vitest run --maxWorkers=3` → 776 passed files / 9,597 passed tests (2 existing skipped files, 42 todo); `npx playwright test --retries=0` → 303 passed. RLS/API-auth, documentation, hooks and workflow guards passed.
- App: production build, demo auth, disposable local Postgres; no shared database credentials. Port 3000 for normal-date flows; a separate port 3001 harness used a fixed seeded week for positive preview evidence.
- Walked: guardian list totals/request count/edit persistence; simulated stats failure, recovery and zero response; parent Home at mobile/desktop, sibling notes and active-week previews/detail; teacher Home/unread display. Timestamp/absence/error semantics also covered by unit and real-database checks described above.
- Console/network: no page errors or unexpected application HTTP errors; optional local telemetry 404/MIME errors, intentional stats 503 and canceled prefetches qualified above.
- Screenshots: `/tmp/school-erp-performance-shots/`; highlights `guardian-list-desktop.png` and `parent-active-week-cards.png`, to be attached to the PR on its assets branch. Driver visually inspected the captured screens.
- Rounds: 3 — type fixes; test-only integration mock fix; final clean gate. No runtime change after the passing build/browser run.
- Not checked: production latency/query plans or real Google OAuth. No auth/permission behavior change; security review passed and no signed-in staging gate is required for this diff.

## Ship Notes

- Target: PR from `feat/performance-hot-paths` to `staging`; production promotion is outside this cycle.
- Migrations, dependencies, environment/config changes and manual steps: none.
- Blast radius: parent Home read volume, development detail read scheduling, shared unread counts and admin guardian summary loading. Existing authorization and freshness are retained.
- Rollback: revert the PR. No data migration to reverse.
- Release checks: all required checks on the current head; after merge, staging deployment READY for the merge SHA and matching DB-aware health response. PR metadata and the final task report carry the merge/deployment result.
