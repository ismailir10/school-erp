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
- T1 review follow-up: added a DOKU redelivery test and an in-lock race test where the invoice is voided between the first read and the lock (AC 3 and AC 4).

## Verification

## Ship Notes
