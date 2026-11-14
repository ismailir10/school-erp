# Close eight supplemental cross-role findings and attendance re-recording

## Context

The November 14 audit remediation closed the major defects but left eight supplemental teacher and parent findings open. The user explicitly requested fixing all eight and verifying on staging in their Chrome. This cycle completes that bounded follow-up and preserves the earlier evidence and its coverage limits.

## Decisions

- Attendance status opens named choices rather than cycling through hidden alternatives. Two taps select an arbitrary status; the extra opening tap buys predictable selection instead of potentially several cycle taps.
- Student names wrap at narrow widths. Identity remains readable without a tooltip or a second action.
- Teacher Home refreshes decision data on return to the tab and periodically while visible, without discarding an open form or making hidden-tab requests.
- Parent attendance and journal are historical records: forward navigation stops at the current calendar week. Current-week detection includes weekends.
- Unpaid bills precede neutral attendance on parent Home. Tagihan exposes payment history near its summary and identifies the next bill to handle, preserving all invoice/payment rules.
- The user explicitly approved adding the newly discovered restoration defect: an authorized explicit class/session attendance write restores a previously voided row, consistent with existing Gerbang behavior. Tenant and teacher-assignment permissions remain unchanged.

## Acceptance criteria

- [x] A1 Full student names remain readable at 320 px in teacher session attendance.
- [x] A2 Attendance status offers explicit named choices, works with keyboard, and changes only the chosen row; dismissal does not mutate.
- [x] A3 Journal indicator controls expose their current pressed/checked state, including updates after activation.
- [x] A4 An already-open teacher Home picks up an admin decision on tab return or a bounded visible refresh, preserves user-entered form data, and cleans up listeners/timers.
- [x] A5 Parent Tagihan offers a prominent payment-history shortcut and clearly identifies the next actionable bill; paid-only and empty states remain useful.
- [x] A6 The current attendance week does not show a return-to-current-week link on Saturday or Sunday; historical weeks still do.
- [x] A7 Parent attendance and Jurnal consistently stop forward navigation at the current week, including future query parameters.
- [x] A8 Parent Home places unpaid/overdue bills before neutral attendance information; no-invoice states remain coherent.
- [x] A9 Explicitly re-recording previously voided class/session attendance restores its visibility and persists the chosen status/timestamps; unrelated rows and unauthorized scopes remain unchanged.

## Verify flows

1. Teacher session at 320/390 px: read long names, open and dismiss status choices, choose an exception, save and reload. Journal: activate an indicator and inspect accessible state; failed save retains the existing error contract.
2. Teacher Home: leave it open, make a fixture admin decision, return/focus and observe updated status. Verify an in-progress form is not discarded; hidden page does not poll.
3. Parent Home and Tagihan: unpaid child shows bill priority; open history, open a paid invoice and return; paid-only child shows useful history. Keep existing pending-payment safety behavior.
4. Parent attendance and Jurnal: current Saturday/Sunday, previous week, and future query. No false reset on current week, no forward link into a future week, child context preserved.
5. Admin voids only a synthetic attendance row; teacher explicitly records it again. Save and reload must retain the new state, original row identity and creation time, without restoring untouched rows. Exercise session and class-mark paths.

## UX notes

Names and bill priority require zero additional taps. Attendance selection takes two deliberate taps for any status. Journal toggles stay one tap. History takes one shortcut tap; week return stays one tap when needed. Home refresh requires no manual reload.

## Test seams

Existing component tests for attendance choices, journal semantics and Home refresh lifecycle; parent week/date tests and page/component tests for hierarchy and history. Lean existing browser flows plus full regression suite and direct Chrome visual/interaction checks.

## Non-goals

Payment-provider BCA sandbox investigation, performance optimization, full PDF audit, new attendance eligibility rules, auth/schema changes, and production promotion.

## Assumptions

The eight-item closure correction is the approved scope. Current/past week navigation suits the record-viewing purpose of both parent screens. Existing staging UAT fixtures are reusable.

## Gate re-openers

None planned. New dependencies, migrations, auth/permission changes or production writes require reassessment.

## Tasks
- [x] T1 Close A1–A9 as one coordinated change: independent teacher controls, teacher freshness and parent slices, plus the user-approved explicit attendance restoration; integrate and independently review (deps: none).
- [x] T2 Run the local full gate and Chrome flows, prepare the release evidence and staging verification fixtures (deps: T1).

Post-merge verification is a release exit, tracked in Ship Notes; local acceptance checks above do not claim deployed closure.

## Implementation

- Plan: driver=gpt-6, workers=inherited model; T1 teacher-controls, teacher-freshness and parent slices parallel with disjoint files; T2 sequential verification/ship. Driver owns spec, integration review and evidence. The user's explicit “fix those 8 small findings” authorizes implementation and staging delivery.

- T1 teacher controls: wrapped full identity on phones, explicit Shadcn attendance radio menu with no mutation on dismissal/reselection, Boolean journal pressed semantics; existing session browser flow extended for 320 px and keyboard use.
- T1 teacher freshness: focus/visible-return and 30-second visible refresh, paused during check-in drafts/writes or an in-flight transition; paired focus events coalesced and resources cleaned up. Existing cross-role browser flow now checks a mounted teacher page after admin approval without navigation.
- T1 parent: payment history moved beside summary with paid-only expansion; next actionable bill excludes pending attempts; calendar-week helper handles weekends/future queries across attendance and journal; bills precede neutral Home attendance.
- Independent review: teacher-freshness worker reviewed controls/parent against A1–A3/A5–A8; parent worker reviewed A4 spec and controls standards; controls worker reviewed freshness/parent standards. No blocking findings. Driver integration review agreed; visual verification subsequently passed locally as recorded below.

- T1b user-approved restoration: session upsert, class-mark single-session upsert and legacy class-mark update now clear `isVoided` only on explicit validated writes. Existing Gate already does this. Independent spec/standards and security reviewers found no blockers; tenant, assignment, enrollment and validation guards remain unchanged. Regression tests failed on all three branches before the fix and passed afterward. E2E explicitly seeds a voided local row and checks saved/reloaded visibility plus original identity/creation metadata.

## Verification

- Initial build caught three Testing Library `getByRole` options using Playwright-only `exact`; fixed the test options without weakening assertions. Second production build/typecheck passed.
- Lint passed. RLS 51/51 and API auth 239/239 passed; hook regression 32 passed; documentation audit 13 ok / 1 existing ADR-age warning / 0 fail; shared-workflow checksum passed.
- Focused worker suites reported 36 teacher controls, 37 freshness, and 120 parent tests passed; superseded by the final full gate below.
- Local test infrastructure: fresh `audit_eight` database on disposable loopback Postgres port 54329. Existing disposable database left intact. Restored optional native packages with `npm ci --include=optional`; manifests/lock unchanged. Node 24.22.1.
- Staging fixture prepared through UI on the previous deployment: teacher check-in marked `UAT-20261114-EIGHT-FRESHNESS`, explicitly not real work attendance, shown as pending in admin queue. It will be rejected as the post-deploy freshness check.
- Initial full Vitest: 775 passed files / 9,543 passed tests; 2 pre-existing skipped files / 42 todo; 600.86 seconds. Initial full E2E: 297 passed, one teacher session failure, one unrelated student-leave retry (6.9 minutes). Not a green gate.
- Browser polish: status choices now have explicit 44 px targets at narrow widths; the local 320 px session had 19 fully readable names and no horizontal overflow. Escape test now waits for the previous popup to unmount before reopening, avoiding a stale closing-menu assertion. Targeted session flow subsequently passed 5/5 with retries disabled; final full gate pending.
- Test isolation: teacher session flow now creates/reuses a guarded disposable-local session and resets one known attendance fixture, removing missing-calendar skips. The original shared row was voided by an earlier admin E2E and remained voided after session save; the user approved the restoration correction and it is now A9. The fresh fixture still makes the UI test independent; explicit void/re-record regression coverage is added separately.
- Student-leave test race: a non-exact `Dibatalkan` locator matched confirmation prose before cancellation completed (new billing request began about 34 ms before the PUT response). It now waits for the dialog to close and the exact status on the newly created leave row; product behavior unchanged.
- Local Chrome: at 320 px, all 19 session names were unclipped with no overflow; all four menu targets measured 44 px. Escape closed the menu, restored trigger focus and retained the status. Desktop session and parent Home checks passed, as did parent invoice hierarchy, history and paid detail at 390 px. On Saturday, the current week had no reset link; a past week had a return link. The future query `2099-01-05` clamped to 9–13 November in both attendance and Jurnal, with forward navigation disabled. Journal `aria-pressed` changed from `false` to `true`; an injected offline failure reverted it to `false` and exposed retry. The online retry saved `true`, and the original `false` state was restored. No network emulation remains.
- Local console qualification: one RSC fetch error came from the temporary test server being stopped between runs; offline journal failure was deliberately injected. A fresh final capture will distinguish these from runtime failures.
- Student-leave repeats: the first rapid 10-test stress run hit the existing draft-creation 429 limit after 6 passes; this was not a cancellation failure. Five isolated server runs then each passed 2/2 with retries disabled, for 10 passes total. Rate protection was not changed.
- Staging A9 baseline reproduced on the prior `b6bed7e7` deployment: admin voided only the synthetic UAT14Nov audit attendance; the teacher selected Hadir and saw “Semua perubahan tersimpan,” but reloading returned “Belum dicatat.” Screenshots preserve both the reported success and the missing record after reload. The record remains temporarily voided for the post-deploy restoration check. The staff freshness fixture remains pending for rejection after deployment.
- Final full Playwright: **299 passed, no retries, no skips (12.0m)**, including the explicit voided-row restore/save/reload and independent identity/creation-time checks. Final production build/typecheck, lint, RLS 51/51, API-auth 239/239, hooks 32/32, audit-docs 13 passed / 0 failed, audit regression 7/7 and workflow guards passed. Final full Vitest: **775 passed files, 9,547 passed tests; 2 pre-existing skipped files / 42 todo; exit 0, 1,249.93s**. Deployed verification pending.
- Final local Chrome production reload: 67 responses, no app HTTP errors or console errors/warnings; two optional local Vercel analytics script 404s and two canceled script loads. Capture complete (not truncated). No staging network pass is inferred from localhost.
- Frontend review uses the canonical design-system and matching portal, accessibility, layout and voice standards.

### Verified locally — 2b7e68c8, 2026-11-14
- Gate: production build/typecheck, lint, `npx vitest run --maxWorkers=1` (9,547 passed), `npx playwright test --retries=0` (299 passed), RLS/API-auth and repository guards passed. Existing Vitest skips/todos remain; no Playwright skips or retries.
- App: production build on localhost:3000; demo auth and disposable local Postgres `audit_eight`, never staging credentials or data.
- Walked: full mobile identity, named choices and keyboard dismissal, journal pressed state and offline/retry recovery, parent Home and invoice/history hierarchy, paid receipt detail, current weekend/past/future weeks. Mounted teacher decision refresh and void/re-record persistence also passed the full browser suite.
- Console/network: no final local console errors/warnings or application HTTP errors; optional Vercel analytics returned two localhost 404s, with two canceled script loads. Bounded capture: 67 responses, complete/not truncated. Deliberate offline journal errors and a stopped-server error from the earlier round are qualified above.
- Screenshots: `docs/uat/reports/assets/2026-11-14-audit-eight-followups/` contains desktop, 390 px and 320 px captures.
- Highlight: `local-status-menu-320.png` and `local-invoices-390.png` in that directory.
- Rounds: 3 — corrected test-only role options; enlarged menu targets and synchronized popup/leave tests; added the approved voided-row restoration and reran all gates. Each round made progress.
- Diff classification: other code, compared with staging `b6bed7e787c5cff25e17b6eb1c81d82ec1579032`; changed teacher/parent pages and tests, journal/week components, parent week helper, two attendance APIs and regressions, four E2E files, cycle/UAT docs and evidence. No auth, dependency, schema, environment or permission changes. Signed-in staging verification is nevertheless required by the user's request and the restoration release exit.
- Soft-skip delta: baseline 26, current 24, delta -2.
- Not checked locally: real Google OAuth and deployment integration; staging check pending (`needs-staging-verify`). Full legacy audit coverage limitations remain in the report.

## Ship Notes

No migrations, dependencies or environment changes planned. Attendance writes explicitly restore the selected voided row, as approved by the user; no broad unvoid or access changes. Roll back via revert PR. After merge, verify A1–A9 with the role-scoped staging accounts in the user's Chrome and retain exact deployment SHA and screenshots. No production promotion.
