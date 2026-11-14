# Cross-role audit remediation

## Context

The [14 November cross-role audit](../uat/reports/2026-11-14-cross-role-ux.md) reproduced a blocked mobile Rapor reader, lost payment-confirmation guidance after reload, misleading journal dates/context and enabled Gate actions without a session on staging `ee955459`. Its earlier admin dashboard/loading and attendance clarity recommendations are also in scope and are being rechecked against that revision. The user explicitly requested all audit findings fixed, sustained work for at least an hour, and verification on staging using their Chrome. This authorizes implementation and the CTO PR-to-staging workflow without a separate spec approval. Existing audit fixtures and unrelated main-checkout edits are preserved.

## Spec

- [ ] Long Rapor starts at its first line at 320/390 px and desktop, has viewport-bounded scroll content and visible child/period/close controls, reopens at the beginning, and shares its reader with admin preview. PDF and unpublished states remain usable.
- [ ] Unresolved payment returns survive reload, reopen, sibling changes and another tab in the same browser/origin. The hint is scoped to tenant, guardian, child and invoice; authoritative payment records control settlement. Failed requests cannot silently restore Pay. Partial, paid, cancelled and definitive failed/expired results reconcile correctly; blocked storage retains recoverable callback context.
- [ ] DOKU-facing labels accept ordinary Unicode fee names by safe provider-boundary normalization without altering invoice snapshots, amounts or quantities. Gateway validation diagnostics retain useful error messages.
- [ ] Gate explains unavailable actions before tapping while preserving legitimate lazy session generation. Teacher Home prioritizes the class/date job, distinguishes campus Gate and own attendance, and shows off-site review decisions. Unrecorded roster rows are neutral until explicitly saved. Parent Home distinguishes actual attendance, scheduled-but-unrecorded and no session, including weekend sessions.
- [ ] Parent and teacher note composers show child, intended school date and audience, use a consistent latest applicable school-day default, and retain actionable error/retry feedback. Teacher row actions have meaningful accessible labels.
- [ ] Admin dashboard surfaces actionable records before empty summary categories on phones. Student/invoice counts distinguish loading, empty and failure and retain previous valid counts during refresh. Single-student and group billing entry points are distinguishable; existing search context is preserved.
- [ ] Regression tests cover behavioral failure cases, independent reviews clear high-confidence issues, required build/test/lint/typecheck/docs gates pass, and Chrome verification covers changed flows locally and on deployed staging.

Assumptions: browser-persisted payment hints are UX safeguards, not a cross-device ledger; no new financial authority or database schema is introduced. Calendar fixtures from the audit remain explicitly synthetic. Timing candidates require remeasurement before optimization claims. Coverage gaps are verification work, not invented product defects. Production promotion is outside this request.

## Tasks

- [x] 1. Fix report reader and journal context — bounded shared reader, deliberate initial focus, coherent date/default and audience; regression tests.
- [x] 2. Fix payment return persistence and DOKU label compatibility — scoped durable hint and authoritative reconciliation; boundary and component tests.
- [ ] 3. Fix attendance availability and truthful status — Gate schedule, roster neutrality, Home priorities/decisions, parent calendar state; endpoint/component tests.
- [ ] 4. Fix admin work priority and loading/billing clarity — recheck historical findings, update affected views and tests.
- [ ] 5. Integrate and review all slices, update JTBD/report dispositions, run full gates and address failures.
- [ ] 6. Prepare the verified release record, screenshots and staging verification checklist.

Release milestone (after the implementation gates): open the PR, require green checks, merge to staging, repeat changed journeys and record deployed evidence in this cycle and the audit report.

Dependencies: tasks 1–3 have disjoint ownership and run in parallel; task 4 follows task 1 on its implementer, avoiding finance-owned parent files. Integration and shipping follow all slices. Each implementation slice is reviewed and committed separately after its gates pass.

## Implementation

- Plan: driver=gpt-6, workers=gpt-6; T[1,2,3] parallel, T[4,5,6] sequential; report/journal/admin, finance and attendance assigned to separate agents. Driver owns architecture, integration, review coordination, cycle documentation and Chrome verification. Shared docs and commits are serialized by the driver.
- Review: independent spec/standards and security passes found cross-tab pending races, cron-first expiry recovery, missing invoice return context and unscheduled Home prompts. Each was returned to its implementer with a regression test; no permission or schema expansion.
- Isolated worktree: `.worktrees/audit-remediation`, base `ee955459`, branch `feat/audit-remediation`. Copied consumed reports/evidence and the simulator runbook update from the preceding audit; unrelated root edits stay untouched.
- Report/journal slice: parent and admin share `ReportCardReader`, with explicit mobile viewport bounds, fixed header, deliberate heading focus and fresh scroll state. Admin preview reads unsaved fields without publishing. Note composers name child/audience/date, default consistently to the latest applicable day, preserve drafts across equal-week refetches and failed saves, and give permission-specific recovery. Teacher row actions are visibly named.
- Attendance slice: shared scheduled-day availability informs Gate and Home; existing recorded sessions remain authoritative. No-session actions are explained before tapping; neutral unsaved roster rows remain separate from saved attendance. Pickup explicitly says it records departure. Parent Home includes weekend records; teacher Home suppresses closed-day urgency while retaining neutral viewing links.
- Admin slice: actionable dashboard records precede summaries; list loading/failure no longer masquerades as zero. Billing starts with a one-student/group choice. Invoice query state and explicit return links preserve search/filter/page/sort; independent review corrected Back/Forward sort indicators and interleaved own URL replacements.
- Finance slice: guardian/child/invoice-scoped pending hints survive browser remounts and reconcile against authoritative server state; provider-boundary normalization preserves original Unicode invoice labels. Cross-tab races and cron-first cleared-link expiry have focused regressions. For a lost/blocked baseline with an already-recorded partial capture, DOKU invoice-level lookup cannot identify the current attempt safely. The deliberate fallback retains the warning and hides Pay, with explicit tata-usaha guidance plus invoice/contact information; a regression protects this manual verification path. It does not claim automatic recovery or invent payment credit. Runtime is now frozen.
- Independent review found no remaining high-confidence report/journal/admin or attendance defect in the reviewed diff. Finance's conservative fallback is complete; final integration gates remain open. The [audit disposition section](../uat/reports/2026-11-14-cross-role-ux.md#remediation-status--14-november-2026-local-verification) maps each finding to its change, evidence and deployed exit.

## Verification

- Started 14 November 2026 at approximately 15:59 JST. Final duration and staging deployment will be recorded after verification.
- Visual reference: `design-system.html`; each implementer loads matching project standards and better-* skills. Using the repository workflow and subagent-driven-development review discipline.
- Latest checked-out workflow differs from the older root instructions: PR previews are disabled (`scripts/vercel-ignore.sh`). Actual CI stages are `Checks`, `Test & Build`, and label-gated `E2E`; all must pass. Local production-browser verification precedes the staging merge.
- Disposable local Postgres `talib-audit-verify-pg` on loopback port 54329 initialized and seeded. Both DATABASE_URL and DIRECT_URL explicitly point to it; staging is not used for automated test writes. Initial remote-DB Playwright guard refused correctly.
- Dependency setup repaired with exact `npm ci --include=optional`; package/lock unchanged. Typecheck exceeded the local Node default ~2 GB heap; retry with 4 GB found three real typing errors, dispatched to owners.
- RLS guard: 51/51 tenant models covered; API auth guard: 239/239 routes covered.
- Baseline recheck: live staging dashboard first record action y=860.125 at 390×844. UI-created Unicode fee `cmwg2cr3o000007jvsqiw6i2k`, invoice `cmwg2is38000007jmkx6krpwi` / INV-2026-0082 for audit child, Rp5.000, failed DOKU creation with HTTP 400; unchanged-label retry planned after deployment.
- Local rounds 1–3: production builds passed. Long-reader Chromium regression: 5 passed (7.8s), including 320 / 390 / 1280 px geometry, real scrolling, focus, close and reopen.
- Local Chrome: mobile dashboard record action moved to y=299.5 (baseline staging 860.125); actual journal offline save retained draft/error, reconnect retry saved once on 13 November, teacher saw same child/date/text. Expected offline network failure was intentional. Gate closed-day rows disabled with explanation.
- Browser review found teacher Home still prompting unfinished attendance on a closed day; schedule-aware neutral viewing links and unknown-schedule recovery were added and tested. Local Chrome subsequently verified the Saturday no-session state with neutral viewing actions. Local invoice creation chooser and search→detail→back context were also verified.
- Full lint passed. The complete serial Vitest run passed **773 files and 9,511 tests**, with 2 skipped files and 42 todo tests, in 501 seconds. Default concurrency had been stopped for memory contention on this 8 GB Mac; tests/timeouts were unchanged. This run preceded the final finance follow-up and final URL regression, so the final gate must run again after freeze.
- Focused final report/journal/admin evidence: invoice URL-state regressions 7/7; invoice detail return suite 64/64; composer failure/retry/permission suite 16/16. Independent URL review cleared both Back/Forward sort display and interleaved replacements. Finance's cron-first expiry follow-up passed its 8-suite/227-test run; that number does not include the subsequent partial-capture fallback regression. Final full-suite totals will be recorded when the ongoing run completes.
- Hooks: 32 passed. Documentation regression tests: 7 passed. Workflow checksum passed. RLS/API guards passed as recorded above. `git diff --check` passed for the reviewed slices.
- Full Playwright first exposed two obsolete wizard-entry assumptions: the UI now correctly opens the one-student/group chooser. Updated `e2e/admin-class-program.spec.ts` and `e2e/admin.spec.ts` to select group billing explicitly; the latter also exercises the primary single-student path. Business assertions remain intact, with no skips or timeout increases. Targeted ESLint and diff checks passed; browser reruns remain part of the final gate.
- Frozen-runtime gate: production build and explicit `tsc --noEmit` passed with a 4 GB Node heap. Complete serial Vitest passed **774 files / 9,522 tests**, with 2 existing skipped files and 42 todo tests, in **659.42 seconds**. Documentation audit: 13 ok, 1 existing ADR-age warning, 0 failures.
- Final Chrome production pass: 390 px report opens at the first section, scrolls to the last section and reopens at the top; 1440×900 reader bounds are x=768, y=0, width=672, height=900. Unpublished sibling remains unavailable. Admin preview displayed temporary unsaved text, and reload/reopen returned the original saved narrative. Pending payment survived reload with no Pay and explicit staff-verification guidance. Student count initially showed “Memuat jumlah siswa…” with dashes, then the populated count. Intentional offline journal save was recoverable; a separate offline URL navigation reached Chrome's offline page and recovered after networking was restored.
- First full Playwright pass: 294 passed, 3 failed, 1 flaky, 1 existing skip (7.8 minutes). Failures were stale billing-entry and attendance-copy assertions; the flaky search locator matched hidden streamed server markup. Tests now follow the chooser and current persistence instructions and scope layout assertions to accessible main content. No application change, skips or timeout increases were introduced. Fresh full run is underway.
- Pending: final full Playwright and lint; PR checks and deployed staging Chrome verification. No staging resolution is claimed by these local results.

## Ship Notes

- Target staging through a feature PR only; no production promotion. Reuse the named audit fixtures and the [DOKU sandbox simulator procedure](../runbooks/payments-gateway.md).
- Expected migrations/env vars: none. Roll back by reverting the feature PR through a new PR; keep financial/audit fixture history.
