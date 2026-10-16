# Check payment status the moment a parent returns, and from the admin list (2026-10-16)

## Context

A parent paid an invoice through DOKU on 8 Oct, and Talib showed it unpaid for over a week
(cycle `2026-10-16-cron-get-handlers`). That cycle made the nightly reconcile sweep actually run, which caps the delay
at one day. A day is still long for a parent who has just paid, and for the admin answering their WhatsApp.

Today, when a parent comes back from DOKU checkout to `/parent/invoices?invoice=…&paymentStatus=paid`, the page shows
"Pembayaran sedang diperiksa" and re-reads our own database every 30 s. It never asks DOKU. DOKU's push notification has
never been delivered for this merchant account (`docs/runbooks/payments-gateway.md`), so the invoice stays unpaid
until the nightly sweep runs. The admin can press "Cek status pembayaran", but only on each invoice's detail page.

Codex review of the promotion PR (#663) found a second gap in the sweep. It picks the 200 oldest-due outstanding
invoices, and an invoice that comes back `NO_CHANGE` is picked again the next night. Once more than 200 invoices hold
a payment link, the ones beyond the first 200 are never polled.

## Decisions

- **The parent's return triggers a status check for that one invoice.** It uses the same read-only check as the admin
  button and the sweep, so every existing guard applies (deduped event, advisory lock, amount and currency checks).
  - It runs on `paymentStatus=paid`, never on `cancel`.
  - It runs once on return and once more 15 s later if nothing changed, because a payment can settle seconds after
    the redirect.
  - Failure is silent to the parent. They already see "sedang diperiksa", which stays true, and the nightly sweep
    remains the backstop. The failure is logged server-side.
- **New parent endpoint `POST /api/guardian/invoices/[id]/check-payment`**, next to the existing guardian invoice GET.
  - Same scoping as that GET: guardian role, own tenant, and the invoice belongs to one of their children, with a
    flat 404 otherwise.
  - Rate limited per user and invoice.
  - Returns only `{ code, status }`. The admin-voice reconcile message never reaches a parent.
- **The gateway is polled at most once per 10 s per invoice, enforced in the database.** A new nullable
  `Invoice.paymentCheckedAt` is claimed atomically before polling, the same pattern as `EnrollmentFee.lastCheckedAt`.
  This holds across serverless instances, which the in-memory rate limit does not. Only the parent path asks for the
  throttle; the admin button and the sweep always poll, and they also stamp the column.
- **The sweep rotates instead of re-picking the same 200.** It orders candidates by `paymentCheckedAt`, never-checked
  first, then by oldest due date. Every invoice with a link is reached within ⌈N/200⌉ nights. The same column serves both
  purposes, so this is one additive migration.
- **Admin list gets a "Cek status pembayaran" row action.** It is shown under the same rule as the detail page:
  `payments.record` permission, an unpaid status, and a payment link present. It calls the existing admin endpoint,
  with no new admin API.

## Acceptance criteria

- [ ] A parent returning with `paymentStatus=paid` for an unpaid invoice triggers one status check right away and one
      more ~15 s later if it is still unpaid. When the check credits the payment, the list re-reads and the existing
      "Alhamdulillah, tagihan … terbayar" toast appears once.
- [ ] `paymentStatus=cancel`, an already-PAID invoice, or an invoice without a payment link triggers no check.
- [ ] The parent endpoint returns 401 without a session and 403 for a non-guardian. It returns 404 for another
      family's invoice, another tenant's invoice, or a missing one, without polling. It returns 429 past the rate limit.
      Its response body carries only `code` and `status`.
- [ ] Two checks of the same invoice within 10 s poll the gateway once. The second returns `NO_CHANGE` without a
      gateway call.
- [ ] The nightly sweep picks never-checked invoices first, then the least recently checked. Every reconcile, from
      the admin button, the sweep or the parent path, stamps `paymentCheckedAt`.
- [ ] The admin invoice list shows "Cek status pembayaran" in the row menu for an unpaid invoice with a link when the
      user may record payments, and hides it otherwise. Pressing it shows the result toast and refreshes the row and
      the stats.
- [ ] The migration is additive: one nullable column, and no data change.

## Verify flows

1. **Parent returns from checkout.**
   - Account: the seeded guardian (`u_rightjet`), on `/parent/invoices?invoice=<unpaid id with link>&paymentStatus=paid`.
   - Expect: "Pembayaran sedang diperiksa", a `POST …/check-payment` answered 200, and the pending note in the sheet.
     The demo gateway reports PENDING, so the invoice stays unpaid.
2. **Parent cancels.** The same URL with `paymentStatus=cancel` shows "Pembayaran belum selesai" and makes no
   check-payment request.
3. **Admin list.**
   - Account: `u_school_admin` on `/admin/invoices`.
   - For a SENT invoice with a link, open the row menu and press "Cek status pembayaran". Expect a result toast and
     a reloaded list.
   - A DRAFT row has no such item.
4. **Error case.** As a different guardian, `POST` the first family's invoice: expect 404 and no gateway call.

## UX notes

- Parent:
  - No new UI. The existing "Pembayaran sedang diperiksa" toast and pending note stay.
  - A credited payment surfaces through the existing PAID-flip toast and highlight. No second success toast is added.
- Admin list:
  - The item reads "Cek status pembayaran" while idle and "Memeriksa..." while running, with the `RefreshCw` icon,
    placed after "Catat Pembayaran".
  - Toasts match the detail page: success on credit, warning when the gateway is unavailable, info otherwise.

## Test seams

- A route test for the parent endpoint, covering auth, scoping, rate limit, skip rules and the response shape.
- Reconcile tests for the throttle claim and the stamp.
- A cron test for the rotation order.
- A parent client test: the return triggers the check on `paid` and not on `cancel`, plus the 15 s retry.
- An admin list client test: the row action's visibility and its call.
- e2e: the existing parent return test also asserts the check-payment request.

## Non-goals

- DOKU notification delivery. That is a Back Office setting.
- The webhook `eventId` collision.
- An alert when the sweep credits payments.
- Polling from the parent's 30 s background refresh.

## Assumptions

- DOKU's status endpoint reports a successful payment within seconds of the redirect. The 15 s retry covers a short lag.
- A 10 s per-invoice floor is far below DOKU's rate limits and above any realistic double-tap.

## Gate re-openers

- **Schema migration:** additive. It adds `Invoice.paymentCheckedAt DateTime?`, nullable, with no backfill.
- **New parent write path:** a guardian can trigger a gateway status poll for their own child's invoice. That poll
  can credit a settled payment, exactly as the webhook and sweep do.
- No new dependency. No production data write beyond the normal payment crediting.

## Tasks

- [ ] **T1: Throttle, stamp and rotation.** Add the migration and column. `reconcileInvoicePayment` gains
      `{ minIntervalMs?, now? }`: it claims and stamps `paymentCheckedAt`, and returns `NO_CHANGE` when it is
      throttled. The sweep orders by `paymentCheckedAt` (nulls first), then `dueDate`. The runbook and the cycle-doc
      guidance on the cap are corrected.
      Accept: reconcile and cron tests cover the claim, the stamp and the order.
- [ ] **T2: Parent check endpoint.** `POST /api/guardian/invoices/[id]/check-payment` with guardian scoping, a rate
      limit, skip rules, the 10 s throttle, and a `{ code, status }` response.
      Accept: the route test covers every acceptance case above. Deps: T1.
- [ ] **T3: Parent return triggers the check.** In the parent invoices client, the `paid` return calls the endpoint
      immediately and once more after 15 s while still unpaid, then refreshes the list when `UPDATED`.
      Accept: client tests for paid, cancel, PAID and retry; the existing return tests stay green. Deps: T2.
- [ ] **T4: Admin list row action.** "Cek status pembayaran" in the invoice list row menu, using the existing admin
      refresh endpoint.
      Accept: list client tests for visibility, the call, and the refresh. Parallel with T1.
- [ ] **T5: e2e and docs.** Extend the parent return e2e to assert the check request. Update the README payments line
      and `docs/uat/jobs/parent.md` if it lists the return behaviour. Deps: T3, T4.

## Implementation

## Verification

## Ship Notes
