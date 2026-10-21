# Unrecorded gateway payments: flag money that lands on a paid or cancelled invoice

## Context

Found in the 2026-10-21 finance review before promotion #679.

The gateway order behind an invoice stays payable at the gateway until it expires. The app has no way to cancel it: the payment port only creates sessions and reads status. So a parent can still pay an order after the invoice has stopped wanting money:

- **Paid by another route first.** An admin records a cash or transfer payment that settles the invoice. A fully settled invoice keeps its link fields, so the parent can still open the link and pay online.
- **Two links paid.** The admin replaces a link and the parent pays both the old and the new one.
- **Voided first.** The admin voids the invoice. The link is cleared locally, but the old order is still payable at the gateway, and it still resolves to the invoice by reference.

When that payment's notification arrives, what happens depends on the invoice:

- **Invoice already Lunas.** The processor marks the event *processed* and writes no payment. In the activity card the row shows a green "Diproses". Nothing anywhere says that money arrived.
- **Invoice Dibatalkan.** The event is marked *ignored*, with no readable label. Again, nobody is told.

In both cases the school holds a parent's money with no record in its books, and nobody knows to refund it.

The pendaftaran-fee path already handles the same situation: it does not credit the payment, writes an error event (`DUPLICATE_PAYMENT_AFTER_PAID`, `PAID_ON_WAIVED_FEE`), and shows staff a red "Perlu dicek" alert on the enrollment page. Invoices have none of that. The one other "verify by hand" money case on invoices, an overpayment, is credited and written as `OVERPAYMENT_FLAGGED`. But it is visible only as one line in the activity card, and no list or count points an admin at it.

Who feels it: the bendahara reconciling the gateway dashboard against Talib, and the parent waiting for a refund nobody knows is owed.

No UAT report covers this path. The newest finance report (2026-10-20, payment-link expiry) is about link display.

## Decisions

- **D1. A payment on a Lunas invoice is not credited; it is flagged.** It is the enrollment-fee precedent. Crediting it would push `totalPaid` past `totalDue`, and gateway payments cannot be reversed in the app, so the books would carry money the school must return. The event becomes an error `DUPLICATE_PAYMENT_AFTER_PAID`. The invoice, its payments and its status do not change.
- **D2. A payment on a Dibatalkan invoice is also not credited; it is flagged.** It becomes an error `PAID_ON_CANCELLED_INVOICE`, replacing today's silent *ignored*.
- **D3. A redelivery is still a no-op.** If a payment with the same gateway payment id is already recorded, the event is processed exactly as today and nothing is flagged. This check runs inside the invoice lock, before the Lunas and Dibatalkan checks. Without it, every redelivery of the payment that settled the invoice would raise a false alarm.
- **D4. Applies to every way a payment event reaches the processor.** That means both gateway webhooks (Xendit, DOKU) and the manual and parent "check payment" polls. An admin's "Perbarui pembayaran" on such an invoice reports *Perlu dicek* with the reason, never "Tagihan sudah lunas — tidak ada perubahan".
- **D5. "Perlu dicek" covers three error codes.** These are the two new ones plus the existing `OVERPAYMENT_FLAGGED`. All three are money at the gateway that a person must reconcile.
- **D6. Shown in two places.**
  - **Invoice detail:** a red "Perlu dicek" alert at the top of the page, above the invoice details. It has one line per flagged payment, naming the amount and the gateway (each one may need its own refund), and tells the admin to check the gateway dashboard and refund if needed.
  - **Admin invoice list:** a "Perlu dicek" option in the Status filter, with its count. It shows only when the count is above zero, or while it is the selected filter, so it never disappears from under the admin.

  The activity card's rows for these codes get readable labels.
- **D7. No "mark as handled" action in this cycle.** The enrollment-fee alert has none either. The alert is a permanent fact about the invoice: a second payment arrived. Hiding it would need a new state and an audited action, which is a separate decision. The list option only appears when there is something to show, so it is not noise at zero.
- **D8. Branch.** This cloud session must push to `claude/modest-rubin-kqvi4l`, not `feat/<slug>`. The work is done in that checkout, cut fresh from `origin/staging`.

## Acceptance criteria

- [ ] A gateway payment notification for an invoice that is already Lunas, carrying a payment id the invoice has not recorded, writes no payment and leaves the invoice unchanged. The event is stored as an error with code `DUPLICATE_PAYMENT_AFTER_PAID`.
- [ ] A gateway payment notification for a Dibatalkan invoice writes no payment and is stored as an error with code `PAID_ON_CANCELLED_INVOICE`.
- [ ] A redelivery of the payment that settled the invoice, meaning the same payment id, is still processed as a no-op and raises no flag. This holds for both gateways.
- [ ] Both checks hold when the invoice turns Lunas or Dibatalkan between the first read and the lock, because the decision is made inside the lock.
- [ ] An admin's "Perbarui pembayaran" that hits either case returns *Perlu dicek* with an Indonesian reason, not "sudah lunas".
- [ ] The activity card shows readable Indonesian labels for both new codes. The old "invoice cancelled" ignored rows also get a label.
- [ ] The invoice detail page shows a red "Perlu dicek" alert when the invoice has any of the three flagged events. The alert shows no raw codes, and it is absent when there are none.
- [ ] The admin invoice list's Status filter offers "Perlu dicek (N)" when N > 0. Choosing it lists exactly the invoices with a flagged event, scoped to the admin's school. An unknown status still returns 400.
- [ ] The enrollment-fee path's behaviour is unchanged.

## Verify flows

1. **Second payment on a paid invoice (admin, edge case).**
   - Data: a Lunas invoice with one gateway payment.
   - Steps: post a signed payment notification for it carrying a new payment id to the local webhook.
   - Expected: totals and status unchanged, and no new payment row. `/admin/invoices/<id>` shows the red "Perlu dicek" alert, and the activity card shows a red "Gagal" row with the readable label.
2. **Redelivery stays quiet.** Re-post the notification that originally settled the invoice. Nothing changes and no alert appears.
3. **Paid after void (admin).**
   - Data: a Dibatalkan invoice.
   - Steps: post a payment notification for it.
   - Expected: no payment row, and the alert says the invoice was cancelled.
4. **List filter (admin, error case included).**
   - On `/admin/invoices`, the Status filter shows "Perlu dicek (2)". Choosing it lists the two invoices above.
   - `?status=BOGUS` on the API returns 400.
   - With no flagged events the option is absent.

## UX notes

- **Alert.** Destructive `Alert` with the title "Perlu dicek", the same component and look as the enrollment-fee card.
- **Alert copy.** One line per flagged payment, newest first, in voice.md's admin register. Proposed:
  - "Ada pembayaran kedua di {gateway} untuk tagihan yang sudah lunas (Rp …). Periksa di dashboard {gateway} dan kembalikan dana bila perlu."
  - "Ada pembayaran di {gateway} untuk tagihan yang sudah dibatalkan (Rp …). Periksa di dashboard {gateway} dan kembalikan dana."
  - "Pembayaran melebihi tagihan (Rp …) — sudah dikreditkan. Periksa dan kembalikan kelebihannya bila perlu."
- **Design system.** Cross-checked against `design-system.html` (Overlays: Alert and Toast). The "Perlu dicek" result of a payment check uses the warning toast, as gateway errors already do. The alert reuses the shadcn destructive `Alert`, so no new styling is needed.
- **Placement.** At the top of the page, above the invoice details. In the T2/T3 review it sat above the activity card, at the foot of the right column, where it was easy to miss.
- **Filter.** The Status filter's label is "Perlu dicek (N)". Its position is after "Perlu link".

## Test seams

- **Processor unit tests.** Use the webhook route tests for both gateways, plus the shared processor. They cover a paid plus new id, a paid plus the same id (redelivery), cancelled, the in-lock race, and the unchanged fee path.
- **Reconcile mapping.** Use the refresh-payment route test: the processor outcome maps to *Perlu dicek*.
- **Label mapper unit test.**
- **Invoice detail.** An API test for the flagged-problems field, with tenant scoping, and a component test for the alert.
- **Invoice list.** An API test for `status=NEEDS_REVIEW` (tenant-scoped, counts match the list), a stats count test, and a client test for the option appearing only when N > 0.
- **Playwright locally, in verify-local.** Walk flows 1–4.

## Non-goals

- **Cancelling or expiring the old order at the gateway** on void, replace or settle. The port has no such call, and it needs each gateway's API checked.
- **A "mark as handled" action**, or a refund flow (D7).
- **Dashboard counts and notifications** (email or WhatsApp to the bendahara).
- **The parent portal.** The parent sees Lunas, which is true from their side.
- **Clearing the link on an invoice settled by cash.** It would not stop payment, since the order resolves by reference.
- **The other review follow-ups:** fee-route permissions, the expiry sort, `paymentLinkError` and `sentAt`.

## Assumptions

1. **Volume.** About 200 invoices and few flagged events, so the list filter can read the flagged invoice ids from the event log first (the log has no foreign key to `Invoice`), with no new index.
2. **Gateway ids.** A payment id is unique per gateway payment, which the existing redelivery check already relies on.
3. **Fee events stay out.** Enrollment-fee events store the fee id in the same column. The invoice filter joins only to invoices in the admin's school, so fee events never match.
4. **Existing `OVERPAYMENT_FLAGGED` events do count.** Overpayments flagged before this cycle will show the alert on their invoice and in "Perlu dicek (N)" from day one, and nothing dismisses them (D7). That is intended: each one is money nobody has confirmed was reconciled.
5. **Existing events are not backfilled.** Earlier silent *processed* rows on paid invoices stay as they are. The webhook payload is kept, so they can be found by hand if needed.

## Gate re-openers

- **Schema migration:** none. The event status and error message are free-text columns.
- **Payment state change:** a payment that was silently dropped is now an error event. Nothing that used to be credited stops being credited.
- **New dependency, auth/PII change, production write, paid API:** none. The list filter adds no new route, and the detail data comes from the existing invoice GET behind its existing permission.

## Tasks

- [x] **T1 Processor and reconcile.**
  - In the lock, run the redelivery check first, then flag a payment on a Lunas or Dibatalkan invoice. The pre-checks defer to the lock.
  - Map the new outcomes to *Perlu dicek* in reconcile, and add the activity-card labels.
  - Update the tests for both gateways and the fee-path test.
  - Accept: the processor tests for AC 1–5 pass, and the existing webhook, reconcile and fee suites pass. (deps: none; reuse: `markError`, `feeReviewMessage` pattern, `mapErrorLabel`)
- [x] **T2 Invoice detail alert.**
  - The invoice GET returns the flagged problems (code, amount, gateway) from the event log, scoped by tenant.
  - The page shows the "Perlu dicek" alert.
  - Accept: API and component tests pass. (deps: T1 codes; reuse: `feeAttentionFrom` shape, `enrollment-fee-card` alert)
- [x] **T3 Invoice list filter.**
  - Add `NEEDS_REVIEW` to the list status values, the list query and the stats count.
  - Add the "Perlu dicek (N)" option, shown only when N > 0.
  - Accept: API, stats and client tests pass. (deps: T1 codes; reuse: `invoice-owes` derived-filter pattern; parallel with T2)
- [x] **T4 Docs.** Update the payments runbook (what a flagged event means and what to do), the README finance line and the admin UAT jobs.
  - Accept: `audit-docs.sh` passes. (deps: T1–T3)

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5; T1 sequential first, since T2 and T3 need its codes. T2 and T3 then run in parallel; their files do not overlap. T4 is done inline because it is short doc edits that need the whole cycle as context.
- T1:
  - `lib/payments/needs-review.ts` (new) holds the codes.
  - `lib/payments/webhook-processor.ts`: the PAID and CANCELLED pre-checks are removed. In the lock, the redelivery check runs first, then a payment on a PAID invoice is flagged `DUPLICATE_PAYMENT_AFTER_PAID` and one on a CANCELLED invoice `PAID_ON_CANCELLED_INVOICE`. Neither writes a payment or changes the invoice.
  - `lib/payments/reconcile.ts`: both outcomes map to `NEEDS_REVIEW` with a message naming the gateway. A repeated click reads the stored event, so the second click also says "Perlu dicek".
  - `lib/webhook/error-labels.ts`: labels for both codes and for the legacy "invoice cancelled" rows.
  - `app/admin/invoices/invoices-client.tsx` and `app/admin/invoices/[id]/page.tsx`: `NEEDS_REVIEW` shows a warning toast.
  - Tests: Xendit and DOKU webhook, refresh-payment, the fee-path guard and the label mapper.
- T2:
  - `lib/finance/payment-problems.ts` (new) turns flagged events into Indonesian lines with the amount (`extractDisplayFields`, `formatRupiah`) and the gateway.
  - `app/api/invoices/[id]/route.ts`: GET returns `paymentProblems`, read after the tenant check, with no provider filter and at most 20.
  - `components/admin/invoices/payment-problems-alert.tsx` (new): destructive "Perlu dicek" `Alert`, the same pattern as the enrollment fee card.
  - `app/admin/invoices/[id]/page.tsx`: the alert sits above the activity card.
  - Tests: helper, API (including the cross-tenant 404 that never reads events), component and page.
- T3:
  - `lib/payments/needs-review-invoices.ts` (new) reads the flagged invoice ids. It is kept apart from the pure constants module so label mappers never load the database client.
  - `lib/constants/invoice-status.ts` adds `NEEDS_REVIEW` to the derived filters, so the schema and `?status=` deep links accept it.
  - `app/api/invoices/route.ts`: `NEEDS_REVIEW` puts `{ id: { in: ids } }` under `AND`, with `tenantId` kept.
  - `app/api/invoices/stats/route.ts`: `needsReview` is counted with the same rule, and is 0 with no query when nothing is flagged.
  - `app/admin/invoices/invoices-client.tsx`: "Perlu dicek (N)" sits after "Perlu link" and shows when N > 0 or while it is selected.
  - Tests: list filter (tenant and fee ids never match, stats equal the list total), stats, client and helper.
- T4:
  - `docs/runbooks/payments-gateway.md`: new paragraph, "Money on a closed invoice is flagged, not credited", covering what each code means, where it shows and what to do. The old-order sentence is corrected.
  - `README.md`: finance line, committed with T2.
  - `docs/uat/jobs/admin.md`: new JTBD-ADMIN-INV-08, and Last audited bumped.
  - The counts block is regenerated.
- T2/T3 review follow-up: moved the alert to the top of the invoice page. It had been placed above the activity card, at the foot of the right column, where it was easy to miss. The review also found that `needsReviewInvoiceIds` scans `WebhookEvent` on every stats call. This is not fixed here, because an index is a schema migration the spec did not name. It is recorded in Ship Notes as a follow-up.
- verify-local round 1: the alert sat flush against the cards below it, so it now takes `mb-4`, the same spacing as the link-error card above it.
- verify-local round 2: two flagged payments of the same amount rendered as identical lines. Each line now starts with the payment's time in WIB (`formatDateTime`), so the admin can tell them apart and match each one in the gateway dashboard.
- T1 review follow-up: added a DOKU redelivery test and an in-lock race test where the invoice is voided between the first read and the lock (AC 3 and AC 4).

## Verification

### Verified locally — 5ae6147, 2026-10-21
- **Route:** other code. The diff touches `app/api/invoices/**` but no session, cookie or auth guard, so no signed-in staging check is needed. Compared `origin/staging...5ae6147` (base `d008967`, 0 behind). Changed: `lib/payments/{webhook-processor,reconcile,needs-review,needs-review-invoices}.ts`, `lib/webhook/error-labels.ts`, `lib/finance/payment-problems.ts`, `lib/constants/invoice-status.ts`, `app/api/invoices/{route,stats/route,[id]/route}.ts`, `app/admin/invoices/{invoices-client,[id]/page}.tsx`, `components/admin/invoices/payment-problems-alert.tsx`, tests, README, CLAUDE.md counts, runbook, UAT jobs, this doc.
- **Gate** (all on the disposable Postgres, `localhost:54329`):
  - `npm run lint`: clean.
  - `npx vitest run`: `Test Files 679 passed | 2 skipped (681)`, `Tests 8031 passed | 42 todo (8073)`.
  - `verify-rls-coverage.sh`: `RLS coverage OK: 43 / 43`.
  - `verify-api-auth.sh`: `API auth coverage OK: 216 / 216`.
  - `DEMO_MODE=true` build: `Compiled successfully`.
  - `npx playwright test`: `244 passed (6.6m)`. It ran through an untracked local config wrapper, because the container has Chromium 1194 and Playwright 1.64 expects 1248. The wrapper sets `launchOptions.executablePath` to `/opt/pw-browsers/chromium` and changes nothing else.
- **Soft-skip delta:** baseline 26, current 26.
- **App:** production build, demo auth and the disposable local Postgres on `http://localhost:3000`, with the Xendit and DOKU stubs from `playwright.config.ts`. Signed in with the `u_super_admin` cookie.
- **Walked:** a script posted signed Xendit notifications to `/api/xendit/webhook` (the real path, no DB writes), then checked the API, the DB (read-only) and the pages at 1440×900 and 390×844. 46/46 checks pass.
  - **Flow 1:** a new payment id on Lunas INV-2026-0105 gave `ERROR:duplicate_payment_after_paid`. The invoice stayed PAID, 300.000/300.000, one payment row, and the event is `ERROR DUPLICATE_PAYMENT_AFTER_PAID`. The red "Perlu dicek" alert shows at the top with time, Rp amount and Xendit, and no raw code. The activity row reads Gagal with the readable label.
  - **Flow 2 (edge):** a redelivery of the seeded settling payment gave `PAID:already`, PROCESSED. An invoice settled through the webhook and then redelivered gave `PAID:already`, kept one payment row and shows no alert.
  - **Flow 3:** a payment on a just-voided invoice gave `ERROR:paid_on_cancelled_invoice`. The invoice kept 0 payment rows and the alert says "sudah dibatalkan".
  - **Flow 4:**
    - With nothing flagged, the Status filter shows no "Perlu dicek" option.
    - After flagging it shows "Perlu dicek (N)" right after "Perlu link". N equals `stats.needsReview` and the list total, and selecting it lists exactly the flagged invoices.
    - Error case: `?status=BOGUS` returns 400, and a wrong webhook token returns 401.
  - **AC 5:** the poll answering "Perlu dicek" cannot be walked locally. In demo mode the gateway poll answers pending, and "Cek status pembayaran" is hidden on Lunas and Dibatalkan invoices. It is covered by `invoice-refresh-payment.test.ts`.
- **Timings:** slowest page 1.6 s content-ready, slowest API 399 ms. None is over a `/uat` threshold.
- **Console/network:** the only errors are 404s for `/_vercel/insights/script.js` and `/_vercel/speed-insights/script.js`, which Vercel serves only on its own hosts. Nothing else is at 4xx or 5xx.
- **design-system:** cross-checked against `design-system.html` (Overlays: Alert and Toast). It uses the shadcn destructive `Alert` and the existing warning toast, with no new tokens or colours.
- **Screenshots:** in the session scratchpad `walk/shots/`: `detail-{paid,cancelled,settled-no-alert}-{desktop,mobile}`, `perlu-dicek-{alert,alert-cancelled,filter,list-selected}-{desktop,mobile}`, `activity-card-{desktop,mobile}`.
- **Highlight:** `perlu-dicek-alert.png` (three flagged payments on one Lunas invoice) and `perlu-dicek-filter.png` (the Status filter with "Perlu dicek (2)").
- **Rounds:** 3.
  - Round 1: the alert sat flush against the cards below it, so it got `mb-4`.
  - Round 2: two flagged payments of the same amount showed as identical lines, so each line now leads with the time.
  - Round 3: clean.

## Ship Notes

- **Migrations:** none.
- **Env vars:** none.
- **Behaviour changes to watch:**
  1. A gateway payment on a Lunas invoice that isn't a redelivery is now an `ERROR` event and a red alert, where it used to be marked processed silently. A payment on a Dibatalkan invoice is now an `ERROR`, where it used to be ignored silently.
  2. Overpayments flagged before this ship (`OVERPAYMENT_FLAGGED`) light up "Perlu dicek" on their invoices from day one (Assumption 4). Expect a non-zero count on staging and production at once, if any exist.
  3. "Cek status pembayaran" on such an invoice shows a warning toast.
- **Follow-ups (not in this cycle):**
  1. `needsReviewInvoiceIds` scans `WebhookEvent` on every `/api/invoices/stats` call. An index on `(status, errorMessage)` is a schema migration for its own cycle, if the event table grows.
  2. A "mark as handled" action (D7).
  3. Expiring or cancelling the old gateway order on void, replace or settle.
  4. The other 2026-10-21 review items: fee-route permissions, the expiry sort, `paymentLinkError`, `sentAt`.
- **Post-merge checks:**
  - The Vercel staging deploy is `READY` for the merge SHA.
  - `/api/health` returns 200.
  - On staging, `/admin/invoices` loads its Status filter.
  - Not auth-impacting, so no signed-in staging check.
- **Rollback:** revert the squash commit. No data needs undoing: flagged events are ordinary `WebhookEvent` rows, and old code shows them in the activity card.
