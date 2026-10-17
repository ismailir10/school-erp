# Expired payment links: keep past-due invoices owed (2026-10-17)

> **Status: spec approved by the user ("go with your recommendations") on 2026-10-17; T1–T4 built.** Two follow-ups raised after approval (T5 channel name, T6 bulk refresh) were approved by the user on 2026-10-17 and are built in the same PR.

## Context

Some invoices show "Link Dibuat" although their DOKU payment link has expired. The nightly reconcile sweep
(`2026-10-16-cron-get-handlers`, `2026-10-16-payment-return-check`) was meant to catch that. Reading the sweep end to
end found it covers the plain case but leaves three gaps. All three come from the same rule: when DOKU reports a
session `EXPIRED`, only a `SENT` invoice is touched, and it is sent back to "Link Gagal" (`PENDING_PAYMENT_LINK`).

1. **Overdue and part-paid invoices keep a dead link.** `OVERDUE` and `PARTIALLY_PAID` are ignored on expiry, so the
   admin and the parent still see a link that no longer works.
2. **A past-due invoice whose link expired stops being owed.** The sweep runs at 00:30 UTC and reverts it to
   "Link Gagal". The overdue job at 01:00 UTC only promotes `SENT`, so the invoice is never promoted. "Link Gagal" is
   deliberately outside the outstanding statuses ("an admin's problem, not a family's"), so the invoice drops out of
   "belum lunas", the student dossier balance and the parent's amount due, while the family still owes it. Because a
   link expires at the end of the due date, **every** unpaid invoice that is not paid by its due date takes this path,
   not an edge case.
3. **Unconfirmed:** the status check maps DOKU's `transaction.status = "EXPIRED"` to expired, copied from the
   notification vocabulary. Nothing in the repo shows DOKU's status endpoint returns that string for an expired
   checkout.

Also unreleased: the cron fix and the status-check PR are on `staging`, not `main`, and Vercel runs crons only on
production. Until the next promotion nothing sweeps production at all.

Reproduced against a local Postgres seeded with the demo data, driving the real cron handlers with only the gateway
poll stubbed (T1, below).

## Decisions

Approved as recommended on 2026-10-17:

1. **An expired link must never change what the family owes.** A billed invoice keeps counting as outstanding whatever
   happens to its link. Recommended: it is the only reading consistent with the existing "outstanding" definition and
   with the overdue job's own intent.
2. **What an expiry does to the invoice**, by status. Recommended:
   - `SENT`, due date not yet passed: unchanged from today, back to "Link Gagal" so the retry queue can issue a new
     link.
   - `SENT`, due date already passed: becomes `OVERDUE` and the dead link is cleared.
   - `OVERDUE` and `PARTIALLY_PAID`: status unchanged, dead link cleared.
   - Why: a past-due invoice must be chased, not parked in the retry queue. Session creation already accepts any
     status except paid/cancelled and gives an overdue invoice a fresh window of at least a day, so a new link can still
     be issued from the invoice page.
3. **Order of the nightly jobs.** Recommended: no change, because decision 2 makes the order irrelevant.

## Acceptance criteria

- [ ] A past-due `SENT` invoice whose link DOKU reports expired ends the nightly pair as `OVERDUE` with no link, and
      still counts in outstanding.
- [ ] An `OVERDUE` or `PARTIALLY_PAID` invoice in the same situation keeps its status and loses the dead link.
- [ ] A not-yet-due `SENT` invoice with an expired link still returns to "Link Gagal".
- [ ] `PAID` and `CANCELLED` invoices are never touched by an expiry.
- [ ] Expiry processing stays idempotent: running the sweep twice changes nothing the second time.
- [ ] The status endpoint's expired wording is confirmed against DOKU (or the assumption is replaced by a fact).

## Verify flows

Local app on a disposable Postgres, demo data, gateway poll stubbed to report `EXPIRED`.

1. Admin, `/admin/invoices`: a past-due "Link Dibuat" invoice, run the sweep then the overdue job; it shows
   "Lewat Tempo", no payment link, and the dossier balance still includes it.
2. Admin, an `OVERDUE` invoice with a link, same run; status unchanged, link gone, "Buat link pembayaran" available.
3. Edge: a not-yet-due `SENT` invoice with an expired link goes back to "Link Gagal".
4. Error: gateway poll fails for one invoice; the rest of the sweep still completes.

## Test seams

- Vitest at the processor seam (`processPaymentEvent` with a `SESSION_EXPIRED` event), per status and due date.
- Vitest at the cron seam for the two-job order, mirroring the existing cron tests.
- One-off real-database run for evidence only; CI has no database.

## Non-goals

- Hourly sweeps or Vercel plan changes.
- Changing how link expiry is computed from the due date.
- Pendaftaran fees (same expiry path, different table; not affected by the outstanding rule).
- Fixing DOKU notifications not being delivered.

## Assumptions

1. A link is issued from the invoice page for any status except paid and cancelled (read in `lib/payments/session.ts`,
   not yet exercised in the browser).
2. "Past due" means the invoice's own due date is before today in Asia/Jakarta, as the overdue job already defines it.
3. Production data may already hold invoices in the state of gap 2 (reverted to "Link Gagal" while past due); whether to
   repair them is a data decision for the ship step, with a read-only count first.

## Gate re-openers

None expected. No schema change, no new dependency, no auth change. A production data repair (assumption 3) would be a
production write and would re-open the gate.

## Tasks

- [x] T1 Reproduce gap 2 — accept: a test fails for the right reason on today's code (reuse: `cron-reconcile-payments` mocks)
- [x] T2 Expiry handler keeps past-due invoices outstanding and clears dead links for all unpaid statuses — accept: T1 test passes as a plain `it`, ACs 1–5 covered (deps: T1, decisions 1–2)
- [x] T3 Confirm DOKU's expired status wording — accept: documented from one real status response or the DOKU docs (parallel with T2)
- [x] T4 Docs: `docs/runbooks/payments-gateway.md` states what an expiry does per status — accept: runbook matches T2

## Implementation

- Plan: continuation driver=gpt-6, workers=gpt-6 (`review_payments`, `review_routes`, `review_ui_checks`); review the shared payment-session boundary, routes and UI independently, run focused regressions, then the driver completes the full gate and required checks before merge and signed-in staging verification.
- Original implementation plan: driver=claude-sonnet-5, workers=claude-sonnet-5 (two review subagents, standards and spec axes, in parallel); T1 done earlier, T2 and T3 sequential and inline (a small slice in one file the workers would need the whole plan for), T4 inline.
- **T1.** `app/api/__tests__/expired-link-past-due.test.ts`: two cases at the processor seam. The control (not-yet-due
  `SENT` reverts to "Link Gagal") passes; the gap-2 case is `it.fails`, asserting a past-due unpaid invoice stays in
  `UNPAID_INVOICE_STATUSES`. `it.fails` keeps CI green while the bug exists and goes red when it is fixed, which is
  the cue to make it a plain `it` in T2. Run as a plain `it` it fails with
  `expected [ 'SENT', 'PARTIALLY_PAID', 'OVERDUE' ] to include 'PENDING_PAYMENT_LINK'`.

- T2: `lib/payments/webhook-processor.ts` (`handleSessionExpired`), `lib/payments/reconcile.ts`, `app/api/xendit/create-session/route.ts` — in the advisory-locked transaction, `SENT` past its Jakarta due date becomes `OVERDUE`, `SENT` not yet due and `PENDING_PAYMENT_LINK` revert as before, `OVERDUE` / `PARTIALLY_PAID` keep their status; all three lose the dead link. The admin "Cek status pembayaran" message now says the link was cleared. The `it.fails` pin is a plain `it` with per-status, boundary (18:00 UTC is already the next day in Jakarta, clock faked) and redelivery cases.
- T2 review fixes, each from a reviewer finding: (1) a new link no longer demotes `OVERDUE` / `PARTIALLY_PAID` to `SENT`, and a failed new link no longer moves them to "Link Gagal" (both paths became reachable once dead links are cleared) in `create-session/route.ts`; (2) the invoice `EXPIRED` event id is keyed on the session id, as the enrollment-fee path already is, so a reissued link that expires later is not deduplicated away; (3) one shared admin message constant.
- T3: DOKU's Checkout check-status also returns `order.status` (`ORDER_GENERATED`, `ORDER_EXPIRED` = "Order expired without payment", changelog 24 Jul 2025). A link nobody opened has no channel and no transaction, so reading `transaction.status` alone leaves it pending forever. `parseDokuOrderStatus` now treats `ORDER_EXPIRED` as expired, **only** when the transaction state would otherwise read pending; a paid, failed or refunded transaction always wins. DOKU's docs say the field is only returned to merchants registered from December 2024 or enabled by DOKU support. **Not verified against a live DOKU response** (no credentials in this environment), and the docs show no example of an expired response.
- T4: `docs/runbooks/payments-gateway.md` states what an expiry does per status.
- T5: `prisma/schema.prisma` + `prisma/migrations/20261017000000_add_payment_channel_code/` (nullable `Payment.channelCode`, additive), `lib/constants/payment-channels.ts` (the activity card's formatter, lifted so one owner renders "Virtual Account BCA"), `lib/constants/payment-methods.ts` (`paymentMethodLabel(method, channelCode?)`: only gateway methods take the channel), `lib/payments/webhook-processor.ts` (stores `event.channelCode` on credit; both the notification and the status poll already carry it), `lib/finance/payments-ledger.ts`, `app/admin/invoices/[id]/page.tsx`, `components/admin/invoices/payment-activity-card.tsx` (imports the shared label). Tests: label helper, ledger rows (channel vs older payment, totals still by method), DOKU webhook asserts the channel is written. No frontend layout change: the existing method badge shows the longer text, so the `design-system` reference was cross-checked for the badge only.
- T6: `app/api/invoices/refresh-payments/route.ts` (new; `payments.record`, tenant-scoped, 6 calls a minute per admin, `maxDuration` 60), `app/admin/invoices/invoices-client.tsx`. The server selects the tenant's `SENT` / `PARTIALLY_PAID` / `OVERDUE` invoices that hold a link, least recently checked first, skipping any checked in the last 10 minutes, takes 50, runs `reconcileInvoicePayment` on them five at a time and answers `{ checked, updated, failed, remaining }`; `remaining` is counted with the same filter after the run, so it is exactly what the next press takes. The header button "Cek semua belum lunas" shows only with `recordPayment` (the create buttons no longer hide it, nor it them) and reloads list and stats afterwards. Tests: route (403 without session, role or permission, 429 before any gateway call, the exact filter, the cap, one failing invoice does not stop the rest, nothing to check) and the client (tally toast, how-many-left toast, warning on failures, empty, refusal, hidden/shown by capability).
- T6 security review (independent, `app/api/**` is a sensitive path): no cross-tenant or non-admin path to a gateway call; the gate, tenant filter on both queries and counts-only response were confirmed. Two medium findings fixed: (1) a slow gateway could carry 50 polls past `maxDuration`, so no new poll starts after 40 s and the unstarted invoices stay unstamped and counted in `remaining`; (2) the in-memory rate limiter is per serverless instance, so each reconcile now claims its invoice atomically in the database (`minIntervalMs`), which makes two racing presses unable to poll the same invoice twice in 10 minutes. Left as is, with reasons: 403 for a missing session matches the sibling route (a consistency fix belongs in its own cycle); `channelCode` is signed gateway data rendered as escaped text, so no length clamp.
- T6 security review (independent, `app/api/**` is a sensitive path): no cross-tenant or non-admin path to a gateway call; the gate, tenant filter on both queries and counts-only response were confirmed. Two medium findings fixed: (1) a slow gateway could carry 50 polls past `maxDuration`, so no new poll starts after 40 s and the unstarted invoices stay unstamped and counted in `remaining`; (2) the in-memory rate limiter is per serverless instance, so each reconcile now claims its invoice atomically in the database (`minIntervalMs`), which makes two racing presses unable to poll the same invoice twice in 10 minutes. Left as is, with reasons: 403 for a missing session matches the sibling route (a consistency fix belongs in its own cycle); `channelCode` is signed gateway data rendered as escaped text, so no length clamp.
- Docs: README finance line, `docs/uat/jobs/admin.md` (JTBD-ADMIN-INV-02 step 6 and "Last audited").
- **Not in the original review pass:** T5 and T6 were built after the spec and reviews of T2-T4; their own review is the full gate plus the browser walk below.

## Known residuals (recorded, not built)

- A not-yet-due `SENT` invoice whose link expires early goes to "Link Gagal", outside the outstanding statuses, and `finance-maintenance` never promotes it afterwards (Decision 2, accepted). Rare in practice since links expire at the end of the due date.
- ~~A stale `EXPIRED` event can clear a newer live link~~ Fixed in the owner review of #666 (cycle `2026-10-17-payment-link-on-demand`): the handler rejects a known stale session and its write compares both the current session ID and URL, preserving replacements installed after its read. Unknown stored session IDs remain supported when a current URL exists; DOKU notifications still cannot distinguish reissued sessions sharing one invoice number.
- The two-job cron-order test named under Test seams is not written: with Decision 2 the order no longer matters, and `finance-maintenance` only touches `SENT`.

## Follow-ups raised after approval (approved 2026-10-17)

**T5 — show the real payment channel.** Every DOKU payment reads "Virtual Account (DOKU)" in the invoice's payment list and the payments ledger, so an admin cannot tell BCA from Mandiri. The channel (`channel.id`, e.g. `VIRTUAL_ACCOUNT_BCA`) arrives in the notification and the status poll, but the processor drops it and `Payment` has nowhere to keep it.

- Decision: store it. A new **nullable `Payment.channelCode`** column (additive, no backfill in the migration), written when a payment is credited. User approved the schema change.
- Decision: one label helper, reusing the formatter the admin activity card already has, so "Virtual Account BCA" reads the same everywhere. A payment with no stored channel (every payment before this change, and any Xendit payment link) keeps today's label.
- Decision: **no automatic backfill.** Older rows keep the generic label. A script to fill the last 90 days from stored webhook payloads would be a production write; offered at ship time, not built.
- AC: a DOKU payment credited with channel `VIRTUAL_ACCOUNT_BCA` shows "Virtual Account BCA" in the invoice's payment list and in the payments ledger (rows and CSV); a payment without a stored channel shows "Virtual Account (DOKU)" as before; the method filter and totals still group by method.

**T6 — refresh every unpaid invoice from the invoice list.** The user asked for a button that updates all unpaid invoices, and agreed to the recommendation: it covers **every** unpaid invoice that holds a payment link (`SENT`, `PARTIALLY_PAID`, `OVERDUE`), not the current filter or selection, **50 per click**, least recently checked first.

- Decision: the server picks the batch (so a filter can never hide an unpaid invoice) and skips invoices checked in the last 10 minutes, which is what makes pressing the button again continue with the next 50. It reports how many are checked, how many changed, and how many remain.
- Decision: same permission as the per-invoice "Cek status pembayaran" (`payments.record`), tenant-scoped, rate limited per admin, five gateway polls at a time, through the same read-only reconcile every other path uses, so no new write path.
- UX: an outline button "Cek semua belum lunas" in the list header, with a progress state; the result toast says how many were updated and how many are left. Hidden without the permission.
- AC: one click checks at most 50 unpaid invoices of the admin's own tenant, none of them checked in the last 10 minutes; a second click continues with the next ones; a gateway error on one invoice does not stop the rest; an admin without `payments.record` gets 403 and no button.
- Non-goal: no background job, no progress bar across clicks, no change to the nightly sweep.

Verify flows added: (T5) admin opens an invoice paid through DOKU BCA and sees "Virtual Account BCA"; an older payment still reads "Virtual Account (DOKU)". (T6) admin on `/admin/invoices` presses "Cek semua belum lunas" with more than 50 unpaid, sees "N diperbarui, M tersisa", presses again and the remainder shrinks; error case: gateway down returns a warning toast and the list stays intact.

- [x] T5 Store and show the payment channel — accept: AC above (deps: schema migration approved)
- [x] T6 Bulk "Cek semua belum lunas" — accept: AC above (reuse: `reconcileInvoicePayment`, `limit` from `lib/finance/concurrency-limit`)
- [x] T7 Shared PR review continuation: enforce the exact creator claim when persisting, add the Xendit 10 s creation timeout, include route setup in the bulk-link deadline, and add regressions — implementation and owner-review details live in `2026-10-17-payment-link-on-demand`; the final local gate is complete at `e26ada92`, with required CI and post-merge staging verification still pending.

## Verification

- **Earlier focused shared-PR checks, before the final local gate:** parent-sheet UI 16 passed, focused backend 40 passed, focused routes 38 passed plus 3 real-SQL checks. These cover the claim-owner fence, Xendit creation timeout and setup-inclusive bulk-link deadline; earlier full-gate and browser evidence below predates these fixes. `audit-docs.sh`: 13 ok, 1 existing ADR-age warning, 0 fail.

### Verified locally — e26ada92, 2026-10-17

The driver compared `origin/staging` at `c10258b4` with code commit `e26ada921c382fbf4128bfb524f4bb65698ee523` using `git diff --name-only c10258b4..e26ada92`. The local production demo used disposable localhost Postgres and Node 24.15. Complete evidence and screenshots are in [the shared payment-link cycle](2026-10-17-payment-link-on-demand.md#verified-locally--e26ada92-2026-10-17).

- `npx vitest run --maxWorkers=2`: **635 files passed, 2 existing skipped; 7430 passed, 42 todo**. `DEMO_MODE=true npm run build` and `npx tsc --noEmit`: exit 0. `npm run lint -- --ignore-pattern 'lib/generated/prisma/**'`: exit 0 with `--max-warnings=0` and generated Prisma output excluded.
- `bash scripts/verify-rls-coverage.sh`: **43/43**; `bash scripts/verify-api-auth.sh`: **213/213**; `bash scripts/audit-docs.sh`: **13 ok, 1 existing ADR-age warning, 0 fail**; `bash scripts/test-hooks.sh`: **32 passed**; `bash scripts/sync-agent-workflow.sh --check`: match.
- `npx vitest run --config /private/tmp/pr666-integration.config.mjs`: **3 real-SQL tests passed**, disposable localhost database and stubbed gateway only.
- `npx playwright test --config /private/tmp/pr666-playwright.config.mts`: **240 total: 239 passed, 1 flaky** (`e2e/sibling-detect.spec.ts:147` passed on retry). The temporary config retained the original suite/server behavior and saved screenshots for passing tests.
- `bash scripts/flake-hunt.sh 3 1 'components/ui/__tests__/rupiah-input.test.tsx' 'app/admin/semesters/[id]/objectives/__tests__/client.test.tsx'`: **63 cases passed in all 3 runs** under one CPU hog; both changes synchronize existing tests without runtime changes.
- **Chrome local demo, design-system walk:** parent at **390 × 844** created a missing link and saw **Bayar sekarang**, then kept an existing live link; admin at **1440 × 900** created **25** links (**80 → 55** missing), then bulk-refresh returned **200 / 1 checked / 0 updated**. Captured admin responses were all 200 and no browser errors occurred. Highlights: `/private/tmp/pr666-highlights/*.png`; public demo embed links: `/private/tmp/pr666-screenshot-links.txt`.

Required CI and signed-in staging verification are pending. Keep `needs-staging-verify` until the staging walk is complete after merge.

### Earlier verification history

**Reproduction against real SQL (T1).** Local Postgres 16, schema pushed and demo seed loaded, four invoices set past
due with a link; the real `reconcile-payments` and `finance-maintenance` handlers run in production order, only the
DOKU poll stubbed (A and D report `EXPIRED`, B and C stay pending). Output:

```
BEFORE       A sent+expired: SENT link=kept            D overdue+expired: OVERDUE link=kept
             B sent+alive:   SENT link=kept            C sent+alive:      SENT link=kept
AFTER 00:30  A: PENDING_PAYMENT_LINK link=null         D: OVERDUE link=kept         B, C: SENT
AFTER 01:00  A: PENDING_PAYMENT_LINK link=null         D: OVERDUE link=kept         B, C: OVERDUE  (overduePromoted: 2)
```

A is never promoted (gap 2). D keeps its dead link (gap 1). B and C show the overdue job itself works. The script was
a throwaway test file, not committed.

**Task gate after the fix** (run on this branch, nothing recorded from memory):

- `npx eslint lib/payments app/api` and `npx tsc --noEmit`: no output.
- `npx vitest run`: `Test Files 623 passed | 2 skipped (625)`, `Tests 7290 passed | 42 todo`.
- `npm run build` with a placeholder `DATABASE_URL`: exit 0. Without it the build fails identically on the untouched base, because this container has no `.env`.
- The real-database reproduction was not re-run against the fix: CI has no database and the Postgres cluster was removed after T1. The processor seam is covered by the tests above.
- T5 and T6, final gate on this branch: `npm run lint` (max-warnings 0) and `npx tsc --noEmit` clean; `npx vitest run` `Test Files 625 passed | 2 skipped (627)`, `Tests 7317 passed | 42 todo`; `bash scripts/verify-api-auth.sh` "211 / 211 routes"; `bash scripts/verify-rls-coverage.sh` "43 / 43"; `bash scripts/audit-docs.sh` 0 fail; `bash scripts/test-hooks.sh` 32 passed; `DEMO_MODE=true NEXTAUTH_SECRET=local-dummy npm run build` exit 0.
- **Playwright**, full suite on a disposable Postgres 16 with the demo seed, Chromium, against `DEMO_MODE=true npm run start`: `188 passed (5.7m)`, `1 flaky`. The flaky test is `enrollment-fee-payment.spec.ts:187` (Pendaftaran admin list, a `toHaveURL` timeout) which failed once and passed on its retry; this diff does not touch that page. A pre-existing flake is the likely cause but I did not re-run it on the base to prove it. The pre-installed Chromium was launched by path through a throwaway config override (deleted), since the pinned Playwright's own browser build is not present in this container.
- **Walk of the new UI** (Playwright script, super admin cookie, 82 unpaid invoices holding a link, demo gateway polls report pending): `/admin/invoices` shows "Cek semua belum lunas" beside Tagihan Manual / Buat Tagihan. Three presses answered `{checked:50, remaining:32}`, then `{checked:32, remaining:0}`, then `{checked:0}`, with the toasts "50 tagihan diperiksa, 0 diperbarui. Masih ada 32 tagihan, tekan lagi untuk melanjutkan.", "32 tagihan diperiksa, 0 diperbarui." and "Tidak ada tagihan belum lunas yang perlu diperiksa sekarang."; all 82 invoices ended with a `paymentCheckedAt` stamp. Invoice detail: a DOKU payment with `channelCode = VIRTUAL_ACCOUNT_BCA` reads "Virtual Account BCA", a DOKU payment with no channel reads "Virtual Account (DOKU)". The screenshots matched `design-system`: outline button, same size and icon as the neighbouring header buttons, the badge keeps its size with the longer label. A note for later, not this diff: the toast sits over the bottom-right table rows for a few seconds.
- **T2 against real SQL after the fix** (same throwaway-test method as T1, gateway poll stubbed, handlers in production order): a past-due `SENT` invoice with an expired link ends `OVERDUE` with no link; `OVERDUE` stays `OVERDUE` with no link; `PARTIALLY_PAID` keeps its status and loses the link; a not-yet-due `SENT` goes to "Link Gagal"; an alive past-due `SENT` is promoted by the overdue job as before. A second sweep scanned 1 invoice (the alive one) and updated 0.

## Ship Notes

Not merged. PR [#666](https://github.com/ismailir10/school-erp/pull/666) is ready and labelled `needs-staging-verify` and `e2e`. The review continuation and local gate are complete at `e26ada92`; required CI checks remain pending, followed by signed-in staging verification after merge. Keep `needs-staging-verify` until that walk is complete.

- **Migration:** `20261017000000_add_payment_channel_code`, one nullable `Payment.channelCode` column, additive, no backfill. Applies through `prisma migrate deploy` in the production build.
- **Env:** none.
- **Manual steps:** none required. Optional, a production write and therefore the owner's call: fill `channelCode` on the last 90 days of DOKU payments from the stored `WebhookEvent` payloads (older payloads are purged), so recent payments read "Virtual Account BCA" instead of the generic label. Also optional and read-only first: count production invoices already stuck in the gap-2 state (`PENDING_PAYMENT_LINK` while past their due date) before deciding whether to repair them.
- **Before promoting:** DOKU's `order.status` (`ORDER_EXPIRED`) is read from the status endpoint but was not seen in a live response. After the first production sweep, check one expired invoice's `WebhookEvent` row (`manual.refresh.expired`) to confirm DOKU reports it. It is only returned to merchants registered from December 2024 or enabled by DOKU support.
- **Post-merge on staging (signed in as an admin with `payments.record`):** open `/admin/invoices`, press "Cek semua belum lunas" and expect a tally toast; open an invoice with a DOKU payment and read its channel. The new route sits under `app/api/**` and reuses the existing `payments.record` gate, so the PR is labelled `needs-staging-verify` until that is done.
- **CI:** the earlier runner-assignment blocker is historical. The current head must pass `Checks`, `Test & Build` and `E2E`; their final status is pending verification. Earlier local passes above do not substitute for the current gate.
- **Rollback:** revert the PR. The column can stay; nothing reads it except the label.
