# Expired payment links: keep past-due invoices owed (2026-10-17)

> **Status: spec awaiting approval.** T1 (reproduction) is done; the fix is not built.

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

Open, for the user (recommendation first):

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
- [ ] T2 Expiry handler keeps past-due invoices outstanding and clears dead links for all unpaid statuses — accept: T1 test passes as a plain `it`, ACs 1–5 covered (deps: T1, decisions 1–2)
- [ ] T3 Confirm DOKU's expired status wording — accept: documented from one real status response or the DOKU docs (parallel with T2)
- [ ] T4 Docs: `docs/runbooks/payments-gateway.md` states what an expiry does per status — accept: runbook matches T2

## Implementation

- **T1.** `app/api/__tests__/expired-link-past-due.test.ts`: two cases at the processor seam. The control (not-yet-due
  `SENT` reverts to "Link Gagal") passes; the gap-2 case is `it.fails`, asserting a past-due unpaid invoice stays in
  `UNPAID_INVOICE_STATUSES`. `it.fails` keeps CI green while the bug exists and goes red when it is fixed, which is
  the cue to make it a plain `it` in T2. Run as a plain `it` it fails with
  `expected [ 'SENT', 'PARTIALLY_PAID', 'OVERDUE' ] to include 'PENDING_PAYMENT_LINK'`.

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

## Ship Notes

Not shipped.
