# Calm color system across Talib portals

## Context

The product owner reviewed staging across admin, teacher and parent screens and found inconsistent combinations,
competing accents and difficult-to-read small text. The review identified bright status fills competing with
brand teal, ordinary outstanding balances in red, repeated primary actions on child cards, and low-contrast
attendance controls and calendar dates. Seven local seeded screens were inspected at staging b6bed7e7. This cycle
starts from 32731fd5 and preserves the subsequently merged cross-role fixes from #743.

The latest cross-role UAT report (2026-11-14) and its audit-eight-followups cycle describe behavior fixes already
merged into the base. They are context, not permission to repeat or expand those changes. Older visual audits are
possibly stale; findings used here were confirmed against source and rendered local screens.

## Decisions

The owner explicitly authorized spec → build → verify → ship and merge to staging on green after the following
discussion decisions. No additional spec approval is pending. Production promotion is excluded.

1. Preserve the school's green/teal identity and use a calm, clean presentation: white cards, quiet neutral
   surfaces, color for meaningful states rather than unrelated categories.
2. Primary actions use deep teal with white text, sparingly. The existing soft teal remains available for selection
   and brand context. Separate action colors from selection colors so changing buttons does not recolor every state.
   Follow-up owner requirement: no white text on light teal buttons, including disabled/hover states. Disabled primary
   actions use an opaque neutral surface and dark muted ink; soft teal controls and checks use dark foreground.
3. Teacher attendance uses neutral present/unrecorded rows, readable colored selected controls, and subtle
   exception emphasis. Present is green, sick amber, approved leave blue, unexplained absence red. A border or check
   supplements color. Preserve tap counts, labels, persistence, undo/retry and bulk marking behavior.
4. Admin finance keeps ordinary outstanding balances neutral and reserves red for overdue records. Small positive
   and warning text uses readable semantic ink. Routine and zero summary values and icons are quiet.
5. Routine teacher destinations use neutral/teal icons, not attendance-warning or holiday colors. Parent child-card
   navigation becomes secondary; payment actions keep their priority. Do not invent an unread-note signal.
6. Unknown attendance is neutral. Parent summary and calendar states follow the same semantic mapping. Today uses
   brand context rather than success green, and small date text keeps full readable contrast.
7. Bring muted surfaces and structural borders into a compatible neutral family while preserving the readable
   input boundary and focus outline. Existing status tints and dark ink remain; avoid an unnecessary palette rewrite.

## Acceptance criteria

- [x] Primary actions have deep teal fills and white text with at least 4.5:1 contrast; soft brand selections remain
      distinct. No white label or check appears on a light teal control; hover, focus, disabled and touch states remain usable.
- [x] Teacher attendance selected H/S/I/A labels meet 4.5:1 contrast, have a non-color selection cue, present and
      unrecorded rows are neutral, and exceptions retain labeled subtle emphasis.
- [x] Attendance save, correction, bulk mark and retry still work without extra taps or data changes.
- [x] Ordinary unpaid balances are neutral; genuinely overdue balances are red; small paid/warning text is readable.
      Zero and routine finance summaries do not imply an active warning.
- [x] Teacher routine tasks no longer use warning/holiday colors as decorative categories; parent child-card
      navigation no longer repeats filled primary buttons, while payment actions remain prominent.
- [x] Unknown attendance is neutral; equivalent parent attendance states use consistent tones; today and completed
      attendance are distinguishable; small calendar dates have readable ink.
- [x] Shared neutral surfaces, button specimens, documentation and both design-system reference copies agree.
- [x] Representative admin, teacher and parent screens remain usable at 320/390 px and 1440 px, including keyboard
      focus, touch hit targets, loading/empty/error states and reduced motion.

## Verify flows

1. Admin: open Tagihan, compare ordinary outstanding, partly paid and overdue records; inspect summary values,
   invoice detail and a create dialog. Filter to no matching records (edge), restore the list, check primary and
   secondary actions and keyboard focus without creating external payments.
2. Teacher: open class attendance, record Hadir, Sakit, Izin and Alpa, correct one status, bulk-mark remaining
   students, reload and confirm persistence. Simulate a failed local save (error), confirm feedback and retry.
3. Parent: inspect a multi-child home, open a child journal/attendance page and Tagihan; confirm quiet child links,
   clear child context, consistent status labels and payment action emphasis. Check an unrecorded/future date (edge).
4. Shared: inspect the in-app design-system, admin form controls and portal selection controls at desktop and phone
   sizes, including keyboard and reduced-motion settings; measure actual rendered foreground/background pairs.

## UX notes

No new task steps. Attendance remains one tap per exception and one tap to mark the remaining students present;
retry uses its existing action. Child journal navigation and invoice navigation remain one tap. Color distinguishes
priority and state; labels and selection borders/checks retain meaning without color. No additional confirmation.

## Test seams

Existing token/reference parity and contrast tests; existing teacher attendance and portal component tests; existing
invoice amount/status tests. Add focused regression assertions where semantic meaning or selection behavior changes.
Use local Playwright for actual rendered contrast, role navigation, persistence, error recovery and responsive checks.
Run the repository full verification gate before shipping, including the complete local Chromium suite.

## Non-goals

Dark mode, branding/logo replacement, new features or routes, auth/permissions, payment processing, schema/data
migrations, new dependencies, production promotion, and broad unrelated UI or copy changes.

## Assumptions

The owner selected deep teal primary buttons from the real-screen comparison. Existing text labels and status
definitions remain authoritative. Routine child links can be secondary without introducing new unread tracking.
The local demo database is disposable; no shared school data is read or changed for verification.

## Gate re-openers

None planned. New dependency, migration, auth/PII change, paid API or production write would reopen scope.

## Tasks

- [x] T1 Shared action palette and neutral surfaces, specimens and documentation — accept: button/selection
      separation, contrast and reference parity pass (parallel with T2/T3; owns shared tokens/primitives/standards).
- [x] T2 Teacher and parent color semantics and action hierarchy — accept: attendance behavior, exception styling,
      date legibility and secondary child actions pass focused tests (parallel; owns portal pages/components).
- [x] T3 Admin finance emphasis and readable amounts — accept: normal/overdue distinction and quiet summaries pass
      focused tests (parallel; owns admin invoice screens/components).
- [x] T4 Integrated review, local verification and visual refinement — accept: two-axis review clear, full local
      gate and role walks complete, evidence ready for the staging ship gate below.

## Implementation

- Plan: driver=gpt-6.1-sol, workers=gpt-6.1-sol low; T1–T3 parallel with disjoint ownership, T4 sequential after
  integration. Driver owns spec, architectural decisions, evidence, review and shipping; workers own implementation
  slices and independent standards/spec reviews. The user requested at least 30 minutes of sustained implementation
  and refinement; work began 2026-11-14 14:42:47 UTC (2026-11-14 23:42:47 Asia/Tokyo).
- T1: distinct action/default and selection Button variants, opaque action hover, compatible muted/border neutrals,
  quiet routine stat icons, matching standards, reference copies and guide CTA specimens. Selected Button consumers
  in staff attendance, semester filters, teacher class filters and changelog keep the soft brand pair.
- T2: readable semantic attendance controls with 2 px selection borders, neutral present rows, exception tints,
  quiet teacher task icons, secondary parent child navigation, consistent parent absence/illness/leave/unknown
  states, brand today context and full-opacity calendar dates. Existing writes, retry, correction and bulk behavior
  are unchanged. Child summary absence stays red both today and in weekly aggregates. Narrow task descriptions
  wrap without clipping below 15rem content width, preserving essential context at 320 px.
- T3: invoice balances use the authoritative persisted OVERDUE status for red emphasis, matching existing badges
  and counts. Routine and zero summaries are neutral; active overdue/link failures remain critical. Small paid and
  warning text uses readable ink. No money calculation, status transition or payment processing changes.
- T4: actual rendered contrast, selected-state/disabled behavior, keyboard child selection, touch targets and
  date legibility regressions; full gates and three-role visual walkthrough completed with clean sample data.
- Two independent review axes found and resolved two acceptance gaps: legacy selected-state Buttons inherited
  action fill, and child-card absence foot text remained amber. Both reviewers subsequently cleared the source diff.
  React checklist: no new effects, subscriptions, requests, dependencies or mutable shared state; existing semantics
  and keyboard handlers retained. The owner's follow-up no-white-on-light-teal requirement also covers the shared
  disabled action treatment, journal checks and public enrollment CTA color pairs; their behavior remains unchanged.

## Verification

- Final browser walkthrough: 31 captures across 320, 390 and 1440 px for admin home/invoices, teacher
  home/attendance and parent home/attendance/invoices/journal. No horizontal overflow or page errors; app HTTP
  requests passed. Admin create-choice and no-results states worked; teacher loading, H/S/I/A save/correction,
  injected failure, real retry, bulk mark and reload persistence worked. Rendered scans found no white text or
  glyph on soft teal controls. Driver inspected admin, teacher, parent and failure-state captures.
- Console/network classification: optional local Vercel analytics 404/MIME messages, canceled navigation prefetches,
  and the deliberately injected attendance save failure are expected verification noise, not app regressions.

- T3: integrated task gate passed on the frozen runtime: production build and 775 unit files / 9,572 tests;
  focused acceptance checks and independent reviews are clear.

- T2: integrated task gate passed on the frozen runtime: production build and 775 unit files / 9,572 tests;
  focused acceptance checks and independent reviews are clear.

- T1: integrated task gate passed on the frozen runtime: production build and 775 unit files / 9,572 tests;
  focused acceptance checks and independent reviews are clear.

- Focused implementation suites passed for shared tokens/reference (73 tests), selection migration (69 tests),
  portal semantics (110 tests plus final parent refinements), finance (132 tests), and child absence summaries (34
  tests). These worker checks are preliminary; the driver's full gates below are the release evidence.
- Initial production build, lint, RLS 51/51 and API-auth 239/239 passed. First broad unit run was interrupted when
  the independent reviewers found the two source gaps; it is not a pass. Final runtime build passed after fixes.
- Documentation audit initially caught the new cycle count; regenerated the canonical counts block. Audit now
  reports 13 ok / 1 existing ADR-age warning / 0 fail. Hook regression 32/32 and workflow checksum passed.
- Rendered regression first run: 6/7 passed. The new staff-selection test raced the existing initial date load;
  trace showed the late initializer restoring today after the requested date. The test now waits for initial and
  selected-date responses and checks the input value. Product behavior was not changed. Rerun: 7/7 passed with
  retries disabled, including action rest/hover, actual selected Buttons, child tab keyboard selection, H/S/I/A
  contrast and 44 px targets, and small parent calendar dates.
- Full unit run found one obsolete student-header assertion for the former primary-button class. It now asserts
  both action fill and foreground; focused rerun 13/13. Subsequent full run: 775 files / 9,572 tests passed.
- The owner's no-white-on-light-teal follow-up exposed disabled opacity compositing and journal check glyphs.
  Disabled actions now use opaque neutral/dark pairs; public enrollment hover uses opaque action tokens. Late
  focused checks: 125 tests, lint and both review axes clear. The real disabled staff action is measured in E2E.
- Full browser round: 288 passed, 10 failed, 5 did not run. Nine failures were runner fixture setup: DATABASE_URL
  was read by the app but not exported to the test process. The remaining failure exposed a clipped 320 px teacher
  task description. Narrow TaskRow descriptions now wrap fully; original mobile-stress assertions stay unchanged.
  A new empty disposable local database preserves earlier data and gives the corrected full runner a clean seed.
- Final production build passed after these refinements. Final lint, complete unit/browser gates and visual walk
  on the frozen runtime follow below; earlier partial rounds are not release evidence.
- Final frozen full gate: lint passed, production build passed, 775 unit files / 9,572 tests passed (2 existing
  skipped files and 42 todo), and all 303 Chromium tests passed with retries disabled in 10.5 minutes. RLS 51/51,
  API auth 239/239, hooks 32/32, workflow sync and documentation audit (13 ok, 1 existing warning, 0 fail) passed.
  The 320 px clipping regression and actual disabled-action contrast both passed the unchanged full browser gate.

### Verified locally — a515c96ba86485ad40c0967580f5d00feed082c0, 2026-11-15 Asia/Tokyo

- App: production build, demo auth + disposable local Postgres. Three roles at 320/390/1440 px; no shared data used.
- Actual diff versus staging `e97b44372d593cb8a798cd737f8bb593540698a5`: **other code** — styling, focused tests, guide specimens and documentation.
  No auth/session/cookie/permission, persistence, payment-processing, schema, dependency or environment change.
- Gates: lint; production build; 775 passing unit files / 9,572 tests (2 existing skipped files, 42 todo); RLS 51/51;
  API auth 239/239; full Chromium 303/303 with retries disabled; hooks 32/32; workflow checksum; docs audit
  13 ok / 1 existing ADR-age warning / 0 fail. Soft-skip baseline=24, head=24, delta=0.
- Browser: admin create-choice and no-results states; teacher H/S/I/A, correction, loading, injected save failure,
  real retry, bulk marking and reload persistence; parent multi-child home, attendance, invoices and journal.
  Keyboard focus/selection, forced colors, reduced motion and 44 px attendance targets passed the browser suite.
- Contrast from rendered controls: action 5.23:1, hover 6.81:1, soft selection 5.43:1, disabled neutral 6.89:1.
  The disabled bulk action has opacity 1 and dark ink. Nested text/icon scans found no white-on-soft-teal pairing.
- Visual critique: 31 responsive captures plus the focused disabled-action shot; no overflow, page errors,
  unexpected app HTTP errors or unexplained console/network events. Expected local-only noise: optional Vercel
  analytics 404/MIME messages, canceled RSC prefetches, measurement-canvas warnings and the deliberate failed save.
- Highlight shots: `admin-invoices-1440-viewport.png` (quiet ordinary balances, overdue emphasis),
  `teacher-attendance-selected-390-viewport.png` (neutral rows, labeled exception controls, one leading action).
  Both captured on clean dummy data, inspected by the driver, and ready for the pinned-assets upload to the PR.
- Independent standards and spec reviews cleared all findings; the narrow TaskRow wrapping fix was re-reviewed.
- Staging advanced only with documentation/report assets in #744. Rebase is clean; SHA-256 comparison of all
  1,929 tracked runtime/test/public files is identical to the fully tested snapshot. Post-rebase build passed;
  required post-rebase full unit gate passed again: 775 files / 9,572 tests, 320.29 seconds.

<details>
<summary>Compared changed paths</summary>

```text
.claude/standards/colors.md
.claude/standards/design-system.html
.claude/standards/patterns.md
.claude/standards/portal.md
.claude/standards/ui.md
CLAUDE.md
app/admin/(hr)/employee-attendance/daily/page.tsx
app/admin/invoices/[id]/__tests__/page.test.tsx
app/admin/invoices/[id]/page.tsx
app/admin/invoices/__tests__/invoices-client.test.tsx
app/admin/invoices/invoices-client.tsx
app/admin/semesters/[id]/__tests__/accessibility.test.tsx
app/admin/semesters/[id]/objectives/client.tsx
app/admin/semesters/[id]/themes/client.tsx
app/admin/students/[id]/__tests__/header-by-state.test.tsx
app/daftar/client.tsx
app/globals.css
app/parent/__tests__/home-summary.test.ts
app/parent/attendance/__tests__/summary.test.ts
app/parent/attendance/page.tsx
app/parent/page.tsx
app/pendaftaran/[token]/__tests__/client-validation.test.tsx
app/pendaftaran/[token]/client.tsx
app/pendaftaran/[token]/message-card.tsx
app/teacher/assessments/center/[center]/client.tsx
app/teacher/class-attendance/__tests__/page.test.tsx
app/teacher/class-attendance/page.tsx
app/teacher/home-client.tsx
app/teacher/sessions/[id]/client.tsx
components/admin/invoices/batch-progress-card.tsx
components/changelog/changelog-view.tsx
components/deck/mock/admissions-mock.tsx
components/deck/mock/billing-run-mock.tsx
components/deck/mock/class-attendance-mock.tsx
components/deck/mock/classes-mock.tsx
components/deck/mock/curriculum-mock.tsx
components/deck/mock/enroll-form-mock.tsx
components/deck/mock/fees-mock.tsx
components/deck/mock/invoices-mock.tsx
components/deck/mock/journal-mock.tsx
components/deck/mock/parent-home-mock.tsx
components/deck/mock/parent-invoice-mock.tsx
components/deck/mock/pay-result-mock.tsx
components/deck/mock/report-card-mock.tsx
components/deck/mock/student-detail-mock.tsx
components/deck/mock/teacher-home-mock.tsx
components/enrollment/documents-step.tsx
components/enrollment/signature-pad.tsx
components/parent/__tests__/kid-card.test.tsx
components/parent/kid-card.tsx
components/portal/__tests__/task-list.test.tsx
components/portal/task-list.tsx
components/portal/week-grid.tsx
components/student-journal/class-day-grid.tsx
components/ui/__tests__/stat-tile.test.tsx
components/ui/button.tsx
components/ui/stat-tile.tsx
docs/cycles/2026-11-14-calm-color-system.md
e2e/design-system.spec.ts
lib/__tests__/design-reference-parity.test.ts
lib/__tests__/primary-text-contrast.test.ts
lib/parent-attendance-banner.ts
public/admin/design-system-reference.html
```

</details>

## Ship Notes

Staging only. No migrations, new dependencies, environment/secret changes or manual data steps. The shared Button
primitive affects primary actions across the app, while selection controls retain their previous soft brand pair.
Rollback is a revert PR to staging; there is no data rollback. Required PR checks: Checks, Test & Build and E2E
on the current head. Shipping remains required after local tasks: open the ready PR, wait for all three checks,
squash merge to staging, then verify Vercel staging READY for the exact merge SHA. The actual diff is
other code (styling/tests/documentation): no auth, session, cookie, tenant/role, payment-processing or dependency
behavior changes. No new portal capability or route requires a JTBD/README change.
