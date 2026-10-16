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

- [x] A parent returning with `paymentStatus=paid` for an unpaid invoice triggers one status check right away and one
      more ~15 s later if it is still unpaid. When the check credits the payment, the list re-reads and the existing
      "Alhamdulillah, tagihan … terbayar" toast appears once.
- [x] `paymentStatus=cancel`, an already-PAID invoice, or an invoice without a payment link triggers no check.
- [x] The parent endpoint returns 401 without a session and 403 for a non-guardian. It returns 404 for another
      family's invoice, another tenant's invoice, or a missing one, without polling. It returns 429 past the rate limit.
      Its response body carries only `code` and `status`.
- [x] Two checks of the same invoice within 10 s poll the gateway once. The second returns `NO_CHANGE` without a
      gateway call.
- [x] The nightly sweep picks never-checked invoices first, then the least recently checked. Every reconcile, from
      the admin button, the sweep or the parent path, stamps `paymentCheckedAt`.
- [x] The admin invoice list shows "Cek status pembayaran" in the row menu for an unpaid invoice with a link when the
      user may record payments, and hides it otherwise. Pressing it shows the result toast and refreshes the row and
      the stats.
- [x] The migration is additive: one nullable column, and no data change.

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

- [x] **T1: Throttle, stamp and rotation.** Add the migration and column. `reconcileInvoicePayment` gains
      `{ minIntervalMs?, now? }`: it claims and stamps `paymentCheckedAt`, and returns `NO_CHANGE` when it is
      throttled. The sweep orders by `paymentCheckedAt` (nulls first), then `dueDate`. The runbook and the cycle-doc
      guidance on the cap are corrected.
      Accept: reconcile and cron tests cover the claim, the stamp and the order.
- [x] **T2: Parent check endpoint.** `POST /api/guardian/invoices/[id]/check-payment` with guardian scoping, a rate
      limit, skip rules, the 10 s throttle, and a `{ code, status }` response.
      Accept: the route test covers every acceptance case above. Deps: T1.
- [x] **T3: Parent return triggers the check.** In the parent invoices client, the `paid` return calls the endpoint
      immediately and once more after 15 s while still unpaid, then refreshes the list when `UPDATED`.
      Accept: client tests for paid, cancel, PAID and retry; the existing return tests stay green. Deps: T2.
- [x] **T4: Admin list row action.** "Cek status pembayaran" in the invoice list row menu, using the existing admin
      refresh endpoint.
      Accept: list client tests for visibility, the call, and the refresh. Parallel with T1.
- [x] **T5: e2e and docs.** Extend the parent return e2e to assert the check request. Update the README payments line
      and `docs/uat/jobs/parent.md` if it lists the return behaviour. Deps: T3, T4.

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5; T1 ∥ T4 (disjoint files), then T2 → T3 sequential (T2 needs T1's reconcile signature, T3 needs T2's endpoint), T5 inline (why: a test assertion and two doc lines). The driver reviews every diff and re-runs the gates itself.
- T1: `prisma/schema.prisma` + `prisma/migrations/20261016000000_add_invoice_payment_checked_at/` (nullable `Invoice.paymentCheckedAt`). `lib/payments/reconcile.ts`: `reconcileInvoicePayment(id, { minIntervalMs?, now? })` stamps the column before every gateway call; with `minIntervalMs` the stamp is an atomic `updateMany` claim, and a lost claim returns `NO_CHANGE` "Baru saja diperiksa." with no gateway call. `app/api/cron/reconcile-payments/route.ts` orders candidates `paymentCheckedAt asc nulls first, dueDate asc`. The runbook names the rotation. Tests: `invoice-refresh-payment.test.ts` (+4: stamp order, lost claim, claim `where`, no stamp on NOT_FOUND) and `cron-reconcile-payments.test.ts` (rotation order).
- T2: `app/api/guardian/invoices/[id]/check-payment/route.ts` — `POST`, guardian scoping copied from the guardian invoice GET (401 / 403 / flat 404 incl. the null-email guard), rate limit `guardian-check-payment:<user>:<invoice>` 6/min after scoping, `SKIPPED` without polling when the invoice is not SENT/PARTIALLY_PAID/OVERDUE or has no link, else `reconcileInvoicePayment(id, { minIntervalMs: 10_000 })`; body is only `{ code, status }`; a thrown reconcile is logged and answered 200 `GATEWAY_ERROR`. README parent row. Tests: `guardian-invoice-check-payment.test.ts` (22).
- T3: `app/parent/invoices/client.tsx` — after the unchanged return handling, a `paid` return (also legacy `xenditStatus`) for an invoice that is not PAID or CANCELLED calls the check endpoint; `UPDATED` → `router.refresh()` (the existing PAID-flip toast does the rest), `NO_CHANGE`/`UNAVAILABLE`/`GATEWAY_ERROR` → one retry after 15 s, anything else stops. No toast on failure, by decision; a `console.warn` with no body. A mount-scoped ref and timer stop it on unmount without cancelling it when the return effect re-runs. PARTIALLY_PAID returns are checked too: the parent may have just paid the remainder. design-system: no visual change on the parent page. Tests: `client.test.tsx` (+7: request, UPDATED refresh, one retry, no retry on SKIPPED, cancel, PAID, unmount); `fetch` is now stubbed for the whole file.
- T4: `app/admin/invoices/invoices-client.tsx` — row action "Cek status pembayaran" / "Memeriksa..." (RefreshCw) after Catat Pembayaran, shown for `payments.record` + SENT/OVERDUE/PARTIALLY_PAID + a link; calls the existing `POST /api/invoices/[id]/refresh-payment` with the detail page's toast mapping, then reloads the list and stats. The shared row-menu item has no `disabled`, so the handler ignores clicks while a check runs. design-system: no new visual pattern — the existing DataTable row menu, icon size and sonner toasts. README finance line names the three reconcile paths. Tests: `invoices-client.test.tsx` (+5: shown and calls, no link, PAID, no permission, 429 error toast).
- T5: `e2e/payment.spec.ts` — the legacy paid-return test waits for the `POST …/check-payment`, asserts 200 with exactly `code` and `status` and no `UPDATED` (demo gateway never settles), before the existing assertions. `docs/uat/jobs/parent.md` (INV-00 Done when) and `docs/uat/jobs/admin.md` (INV-02 step 5) describe the new behaviour.

## Verification

### Verified locally on 2026-10-16, head `e9effc04` (base `origin/staging` `b579b3e`)

Compared `origin/staging...HEAD`. The diff touches:
- `prisma/` (one migration and the schema)
- `lib/payments/reconcile.ts`
- `app/api/cron/reconcile-payments/`, and the new `app/api/guardian/invoices/[id]/check-payment/`
- `app/parent/invoices/client.tsx` and `app/admin/invoices/invoices-client.tsx`
- `e2e/payment.spec.ts`, README, the runbook and the UAT jobs

**Migration.** On a disposable local Postgres 16, I pushed `origin/staging`'s schema, applied `20261016000000_add_invoice_payment_checked_at/migration.sql` (`ALTER TABLE`), and ran `prisma migrate diff` from the database to the branch schema. The diff is empty, then the database was seeded.

**Full gate.**
- `npm run lint`: clean.
- `verify-rls-coverage.sh`: `43 / 43`.
- `verify-api-auth.sh`: `210 / 210`.
- `npx vitest run`: `Test Files 622 passed | 2 skipped (624)`, `Tests 7263 passed | 42 todo`.
- `DEMO_MODE=true npm run build`: exits 0. `ƒ /api/guardian/invoices/[id]/check-payment` and `ƒ /api/cron/reconcile-payments` are dynamic.
- `npx playwright test`: `189 passed (5.3m)`. It uses an untracked local config that points `launchOptions.executablePath` at the container's pre-installed Chromium, because the pinned `@playwright/test` expects a newer browser build. Nothing in the repo changed for this.

**Verify flows.** I walked these with a real browser against `DEMO_MODE=true npm run start`, signed in with demo cookies.
1. **Parent paid return.** `u_rightjet` (390×844) opened `/parent/invoices?invoice=<SENT invoice with link>&paymentStatus=paid`.
   - The toast "Pembayaran sedang diperiksa…" and the pending note both showed.
   - One `POST …/check-payment` returned `200 {"code":"NO_CHANGE","status":"SENT"}`; the demo gateway reports PENDING.
   - The params were stripped, and the stamp `paymentCheckedAt` was written.
2. **Parent cancel.** The same URL with `paymentStatus=cancel` showed "Pembayaran belum selesai" and made 0 check requests.
3. **Admin list.** `u_school_admin` opened `/admin/invoices`.
   - The SENT row's menu offers `["Catat Pembayaran","Cek status pembayaran","Batalkan"]`.
   - Pressing the new item sent `POST /api/invoices/<id>/refresh-payment` and got 200 `NO_CHANGE`; the toast read "Belum ada pembayaran masuk.".
   - A DRAFT row's menu offers only `["Batalkan"]`.
4. **Errors and scoping.**
   - Another family's guardian (`u_kbaster_parent_d4`) gets `404 {"error":"Not found"}`.
   - An anonymous caller gets `401`.
   - The owner posting twice gets `200 {"code":"NO_CHANGE","status":"SENT"}` both times. The bodies never carry the admin message. The 10 s throttle itself is proven in Vitest: a lost claim makes no gateway call.

**Highlights:** `admin-row-menu.png` (the new row action) and `parent-paid-return.png` (the parent page, visually unchanged).

**design-system:** the admin item reuses the existing DataTable row menu, the 14 px `RefreshCw` icon and the sonner toasts. The parent page has no visual change.

**Glossary:** the copy uses "Cek status pembayaran", "Memeriksa...", "Link Dibuat" and "Tagihan". No banned terms appear.

### Review round 1 (Codex on #664): re-verified on 2026-10-16

- **Parent page.** A webhook that credits the invoice between the first check and the 15 s retry made the retry answer `SKIPPED`/`ALREADY_PAID` with `status: PAID`. The client refreshed only on `UPDATED`, so the page stayed stale until its 30 s poll. It now also refreshes when the returned status differs from the one it rendered.
- **Admin list.** The memoized row menu kept the handler from an earlier render, so a check after a filter change reloaded the table with the previous query. The reload now goes through a ref that an effect keeps pointed at the current `fetchInvoices`/`fetchStats`.
  - `handleRowRetry` ("Coba Lagi Link") has the same stale-closure shape. It is pre-existing and out of scope, so it is noted here and not changed.
- **Regression tests.** Each new test fails against the old source and passes now:
  - parent: retry with `SKIPPED`/`PAID` refreshes, and `NO_CHANGE` with the same status does not;
  - admin: a check after searching "Aisyah" reloads with `search=Aisyah`.
- **Re-run.**
  - `npx vitest run app/parent/invoices app/admin/invoices <guardian check route test>`: `Tests 139 passed`.
  - `npm run lint`: clean.
  - `DEMO_MODE=true npm run build`: exit 0.
  - Playwright `payment`, `parent`, `admin-payments`, `admin-manual-invoice-layout`, `admin`: `46 passed`, on a fresh disposable database.

## Ship Notes

- **Route: other code.** The new guardian endpoint authenticates with the existing `getSession()` and repeats the guardian invoice GET's scoping, unchanged. No login, session, cookie or shared guard code changed, so no `needs-staging-verify` label.
- **Migration.** `20261016000000_add_invoice_payment_checked_at` is additive: one nullable column. `prisma migrate deploy` applies it in the staging and production builds.
- **After promotion:**
  - Every existing invoice starts with a NULL stamp, so the first sweep picks never-checked invoices first. Its order matches today's due-date order until stamps accumulate.
  - A parent returning from DOKU now triggers `POST /api/guardian/invoices/<id>/check-payment`. If it fails, the log line is `[GUARDIAN CHECK PAYMENT] failed`.
