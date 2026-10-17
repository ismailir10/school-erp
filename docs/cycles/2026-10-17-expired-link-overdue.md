# Expired payment links: keep past-due invoices owed (2026-10-17)

> **Status: spec approved by the user ("go with your recommendations") on 2026-10-17; T1–T4 built.** Two follow-ups raised after approval are open at the end of this doc.

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
   "Terlambat", no payment link, and the dossier balance still includes it.
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

- Plan: driver=claude-sonnet-5, workers=claude-sonnet-5 (two review subagents, standards and spec axes, in parallel); T1 done earlier, T2 and T3 sequential and inline (a small slice in one file the workers would need the whole plan for), T4 inline.
- **T1.** `app/api/__tests__/expired-link-past-due.test.ts`: two cases at the processor seam. The control (not-yet-due
  `SENT` reverts to "Link Gagal") passes; the gap-2 case is `it.fails`, asserting a past-due unpaid invoice stays in
  `UNPAID_INVOICE_STATUSES`. `it.fails` keeps CI green while the bug exists and goes red when it is fixed, which is
  the cue to make it a plain `it` in T2. Run as a plain `it` it fails with
  `expected [ 'SENT', 'PARTIALLY_PAID', 'OVERDUE' ] to include 'PENDING_PAYMENT_LINK'`.

- T2: `lib/payments/webhook-processor.ts` (`handleSessionExpired`), `lib/payments/reconcile.ts`, `app/api/xendit/create-session/route.ts` — in the advisory-locked transaction, `SENT` past its Jakarta due date becomes `OVERDUE`, `SENT` not yet due and `PENDING_PAYMENT_LINK` revert as before, `OVERDUE` / `PARTIALLY_PAID` keep their status; all three lose the dead link. The admin "Cek status pembayaran" message now says the link was cleared. The `it.fails` pin is a plain `it` with per-status, boundary (18:00 UTC is already the next day in Jakarta, clock faked) and redelivery cases.
- T2 review fixes, each from a reviewer finding: (1) a new link no longer demotes `OVERDUE` / `PARTIALLY_PAID` to `SENT`, and a failed new link no longer moves them to "Link Gagal" (both paths became reachable once dead links are cleared) in `create-session/route.ts`; (2) the invoice `EXPIRED` event id is keyed on the session id, as the enrollment-fee path already is, so a reissued link that expires later is not deduplicated away; (3) one shared admin message constant.
- T3: DOKU's Checkout check-status also returns `order.status` (`ORDER_GENERATED`, `ORDER_EXPIRED` = "Order expired without payment", changelog 24 Jul 2025). A link nobody opened has no channel and no transaction, so reading `transaction.status` alone leaves it pending forever. `parseDokuOrderStatus` now treats `ORDER_EXPIRED` as expired, **only** when the transaction state would otherwise read pending; a paid, failed or refunded transaction always wins. DOKU's docs say the field is only returned to merchants registered from December 2024 or enabled by DOKU support. **Not verified against a live DOKU response** (no credentials in this environment), and the docs show no example of an expired response.
- T4: `docs/runbooks/payments-gateway.md` states what an expiry does per status.

## Known residuals (recorded, not built)

- A not-yet-due `SENT` invoice whose link expires early goes to "Link Gagal", outside the outstanding statuses, and `finance-maintenance` never promotes it afterwards (Decision 2, accepted). Rare in practice since links expire at the end of the due date.
- A stale `EXPIRED` event can clear a newer live link on an `OVERDUE` / `PARTIALLY_PAID` invoice if the sweep races an admin issuing a new link. The window is one gateway poll; the same pattern already existed for `SENT`.
- The two-job cron-order test named under Test seams is not written: with Decision 2 the order no longer matters, and `finance-maintenance` only touches `SENT`.

## Open follow-ups (raised by the user after approval, undecided)

- **Show the real VA channel** (for example "Virtual Account BCA") instead of "Virtual Account (DOKU)". The channel is in the notification and status payloads (`channel.id`), but `processPaymentEvent` drops it and `Payment` has no column for it. Needs a nullable `Payment.channelCode` column: a schema change, so it re-opens the gate.
- **A button to refresh every unpaid invoice at once** on the admin invoice list.

## Verification

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
- No frontend file changed; `design-system` frontend gate not applicable.

## Ship Notes

Not shipped.
