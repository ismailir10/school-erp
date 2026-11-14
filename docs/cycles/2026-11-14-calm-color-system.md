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

- [ ] Primary actions have deep teal fills and white text with at least 4.5:1 contrast; soft brand selections remain
      distinct. Hover, focus, disabled and touch states remain usable.
- [ ] Teacher attendance selected H/S/I/A labels meet 4.5:1 contrast, have a non-color selection cue, present and
      unrecorded rows are neutral, and exceptions retain labeled subtle emphasis.
- [ ] Attendance save, correction, bulk mark and retry still work without extra taps or data changes.
- [ ] Ordinary unpaid balances are neutral; genuinely overdue balances are red; small paid/warning text is readable.
      Zero and routine finance summaries do not imply an active warning.
- [ ] Teacher routine tasks no longer use warning/holiday colors as decorative categories; parent child-card
      navigation no longer repeats filled primary buttons, while payment actions remain prominent.
- [ ] Unknown attendance is neutral; equivalent parent attendance states use consistent tones; today and completed
      attendance are distinguishable; small calendar dates have readable ink.
- [ ] Shared neutral surfaces, button specimens, documentation and both design-system reference copies agree.
- [ ] Representative admin, teacher and parent screens remain usable at 320/390 px and 1440 px, including keyboard
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

- [ ] T1 Shared action palette and neutral surfaces, specimens and documentation — accept: button/selection
      separation, contrast and reference parity pass (parallel with T2/T3; owns shared tokens/primitives/standards).
- [ ] T2 Teacher and parent color semantics and action hierarchy — accept: attendance behavior, exception styling,
      date legibility and secondary child actions pass focused tests (parallel; owns portal pages/components).
- [ ] T3 Admin finance emphasis and readable amounts — accept: normal/overdue distinction and quiet summaries pass
      focused tests (parallel; owns admin invoice screens/components).
- [ ] T4 Integrated review, local verification, visual refinement and staging ship — accept: two-axis review clear,
      full local gate, role walks, required CI green on current head, staging merge and deployment READY.

## Implementation

- Plan: driver=gpt-6.1-sol, workers=gpt-6.1-sol low; T1–T3 parallel with disjoint ownership, T4 sequential after
  integration. Driver owns spec, architectural decisions, evidence, review and shipping; workers own implementation
  slices and independent standards/spec reviews. The user requested at least 30 minutes of sustained implementation
  and refinement; work began 2026-11-14 14:42:47 UTC (2026-11-14 23:42:47 Asia/Tokyo).

## Verification

Pending.

## Ship Notes

Pending. Staging only. No migration, new dependency, environment change or manual data step is planned.
