# Payment links that heal themselves, and WhatsApp reminders from the invoice list

## Context

The school's finance admin reports three kinds of unpaid bills in October 2026:

- parents who forgot one month of SPP;
- annual fees that are partly paid;
- many parents during the Xendit → DOKU changeover who say they never got a payment link.

The app sends parents nothing itself. DOKU emails reach almost nobody, because few guardians have an email on file. So the admin chases every bill by hand on WhatsApp, and usually falls back to "transfer manually to the school account".

#666 and #670 (promoted to production as #671 on 2026-10-17) made expired links clear themselves. They also let a parent ask for a new link from the portal, and gave the admin bulk "Cek semua belum lunas" and "Buat link baru (N)". Four gaps remain:

1. **Links for overdue invoices die within a day.** A link lasts until the due date, with a floor of one day. A link made for an invoice that is already past due therefore expires after 24 hours: a link the admin sends today is dead tomorrow.
2. **Nothing makes a new link automatically.** The nightly sweep clears a dead link but leaves the invoice with no link until a parent or the admin presses a button. The admin's "Chat WhatsApp" then sends the parent-portal address. Most parents cannot sign in there, because login needs a Google email on file.
3. **The link's amount goes stale after a partial payment.**
   - A manual partial payment leaves a link that still asks for the old, larger amount. Paying it is credited but flagged as an overpayment.
   - A new link for a partly paid invoice sends line items that add up to the full fee while the charge is only the remainder. DOKU may reject that.
   - A partly paid invoice past its due date never becomes "Lewat Tempo", so it is missing from the overdue count, the very group the school chases for annual fees.
4. **No way to work through reminders.** The only reminder is one "Chat WhatsApp" button per invoice detail page, and nothing records who was reminded when. The admin cannot answer "I never got the link" or avoid double-messaging a family.

Desired outcome: every unpaid invoice holds a working link without anyone pressing a button. The admin can go down a list of families who owe money, one tap each, with a message that carries that link, and sees who was reminded and when.

UAT input: the newest admin report (`docs/uat/reports/2026-04-24-admin.md`) is about six months old, which is past the 60-day rule. It predates the finance cycles of August–October, so it is possibly stale, verify before acting, and no findings are carried in.

## Decisions

- **D1. Overdue links last 7 days.** When the due date is already past, a new link stays open for 7 days instead of 24 hours. A not-yet-due invoice still expires at the end of its due date, and one due today keeps the 24-hour floor.
  - Why 7: a week covers a parent who reads the message at the weekend.
  - It also caps how often the nightly job makes a new order per overdue invoice.
- **D2. The nightly maintenance job heals links.** It runs after the payment sweep. It creates a link for every unpaid invoice (Terkirim, Dibayar Sebagian, Lewat Tempo) that has none, as many as fit in its time budget, at most 50 a night.
  - The admin's "Buat link baru (N)" stays for catch-up.
  - The job runs at 08:00 WIB, after the 07:30 sweep has cleared dead links.
  - It is not added as a new scheduled job, because the Hobby plan's cron allowance is tight.
- **D3. "Lewat Tempo" wins over "Dibayar Sebagian" once the due date passes.**
  - Rule: an invoice with money still owed after its due date is Lewat Tempo, whether or not part of it has been paid.
  - This applies in the nightly promotion and whenever a payment is recorded.
  - The paid and remaining amounts still show everywhere.
  - A receipt (kuitansi) stays downloadable for any invoice with money paid, so a partial payer keeps their receipt after promotion.
  - Why: the school chases exactly these families, and the overdue figures should count them.
- **D4. A link always charges what is still owed.**
  - Recording or reversing a manual payment drops the old link in the same step and makes a new one right after, without making the admin wait for it.
  - If that immediate attempt fails, the nightly heal retries.
  - A link for a partly paid invoice carries a single line, "Sisa tagihan <invoice number>", for the remaining amount, so the line items always match the charge.
- **D5. "Buat link baru" on one invoice** (admin invoice detail, same permission as making links today).
  - The app first asks the gateway whether the invoice was paid, and records the payment if so.
  - Otherwise it replaces the stored link after a confirmation.
  - The old link may still accept money until it expires. If a parent pays it anyway, the payment is still credited to the invoice (an overpayment is flagged for review, as today), and the confirmation says so.
- **D6. WhatsApp reminders are a queue, not a broadcast.**
  - A "Pengingat WhatsApp" button on the invoice list opens a queue of unpaid invoices whose guardian has a usable WhatsApp/phone number.
  - Order: families never reminded first, then the oldest reminder, then the oldest due date.
  - Each row opens WhatsApp with the existing salam message and the invoice's current link, and records the reminder.
  - Why a queue: wa.me cannot send by itself and no WhatsApp API is connected. So "one tap per family, nothing forgotten" is the honest best.
  - The detail page's "Chat WhatsApp" records a reminder the same way.
- **D7. What a reminder records.** The time, the admin who opened it, and a running count, stored on the invoice and written to the audit log.
  - The UI says "Diingatkan <waktu>", never "Terkirim": the app only opened WhatsApp, the admin presses send.
- **D8. Who can use reminders.** People with the permission to record payments, the collections role that already runs "Cek semua belum lunas". Making a missing link from inside the queue additionally needs the permission to create invoices, as today.

## Acceptance criteria

- [ ] A link created for an invoice whose due date has passed stays open for 7 days. A link for a not-yet-due invoice still closes at the end of its due date (24-hour floor for one due today). Registration-fee links are unchanged.
- [ ] After the nightly maintenance run, every Terkirim / Dibayar Sebagian / Lewat Tempo invoice that had no link has one. It stops within its time budget, takes at most 50 a night, and a gateway failure on one invoice does not stop the rest.
- [ ] A Dibayar Sebagian invoice past its due date shows Lewat Tempo after the nightly run. A partial payment recorded on a past-due invoice leaves it Lewat Tempo, not Dibayar Sebagian. Paid and remaining amounts, and the kuitansi download (admin and parent), still work for it.
- [ ] Recording a manual partial payment replaces the link with one for the new remaining amount. Reversing a payment does the same. If the new link cannot be made right away, the invoice is left without a link, and the nightly heal or "Buat link baru (N)" picks it up.
- [ ] A link made for a partly paid invoice has a single line item named "Sisa tagihan <invoice number>" equal to the remaining amount. A never-paid invoice keeps its real line items.
- [ ] On an unpaid invoice that has a link, the admin can press "Buat link baru". After a confirmation the invoice holds a different, working link. If the gateway reports the invoice as already paid, the payment is recorded and no new link is made. If the gateway cannot be reached, the old link is kept and an error says so.
- [ ] The invoice list has "Pengingat WhatsApp". The queue lists unpaid invoices with a reachable guardian number, never-reminded first, each showing student, period, remaining amount, status and "Diingatkan …" or "Belum diingatkan". It says how many unpaid invoices are left out for having no number.
- [ ] Tapping a row's WhatsApp action opens wa.me to the guardian with the salam message and the invoice's payment link. The invoice records the reminder (time, admin, count), the audit log has an entry, and the row then shows "Diingatkan baru saja". A row with no link offers to make one first.
- [ ] The detail page's "Chat WhatsApp" records a reminder too, and the detail page shows when the invoice was last reminded.
- [ ] Users without the payment-recording permission see no reminder button, and the reminder endpoints answer 403. Another school's invoice answers 404.

## Verify flows

1. **Admin works the reminder queue** (`u_school_admin`, /admin/invoices, seeded unpaid invoices):
   - Press "Pengingat WhatsApp". The queue opens; check the count of excluded no-number invoices.
   - On a row with a link, tap WhatsApp. Expect a wa.me URL with the guardian's number and a message containing the link.
   - Close and reopen. That row now shows "Diingatkan baru saja" and sits below never-reminded rows.
   - On a row without a link, make the link from the queue, then tap WhatsApp.
   - Check the audit log entry.
2. **Admin replaces a link** (invoice detail of a seeded unpaid invoice with a link): "Buat link baru" → confirm → the link on the page changes and opens.
   - Error case: with the gateway made to fail, the old link stays and an error toast shows.
3. **Partial payment on an overdue annual fee** (seeded past-due SENT invoice):
   - Create a link, then record a partial manual transfer.
   - Expect status Lewat Tempo, "Dibayar X / Sisa Y", a new link for Y with a single "Sisa tagihan" line, and the kuitansi still downloadable (admin, and parent as `u_rightjet` if it is their child).
4. **Nightly maintenance** (call the maintenance job locally with the cron secret):
   - A past-due Dibayar Sebagian invoice becomes Lewat Tempo.
   - Unpaid invoices without links get links, with a 7-day expiry for overdue ones.
   - Edge case: a guardian with no number is absent from the queue and counted in the "no number" note.

## UX notes

- **Invoice list header.** "Pengingat WhatsApp" sits beside "Cek semua belum lunas" (same permission). The queue opens in the standard responsive dialog: a Dialog on desktop, a Sheet on mobile.
- **Queue rows.**
  - Content: student name and period; remaining amount (tabular numerals); status badge; "Diingatkan 3 hari lalu · oleh <nama>" or "Belum diingatkan".
  - Primary action: "Buka WhatsApp", a real link so the phone opens WhatsApp directly.
  - When the invoice has no link, the action is "Buat link dulu". Once a link exists it becomes "Buka WhatsApp".
- **Queue footer and empty state.** A footer note: "<n> tagihan belum lunas tanpa nomor WhatsApp wali — lengkapi di data wali." The empty state is "Semua tagihan belum lunas sudah diingatkan hari ini" or "Tidak ada tagihan belum lunas", not a generic "no data".
- **Replacing a link.** Detail-page action "Buat link baru". The confirmation follows voice.md: "Link lama akan diganti. Jika orang tua sudah membayar lewat link lama, pembayarannya tetap tercatat." Buttons are "Buat link baru" and "Batal".
- **Detail page.** The Kontak Wali card shows "Terakhir diingatkan …".
- **Copy.** The admin chrome uses no Arabic greeting. The salam stays only in the message to the parent. Never "Terkirim".

## Test seams

- Unit:
  - The link expiry rule (overdue → 7 days).
  - Session building (partial-invoice line item).
  - Invoice payment-state derivation (past-due partial → Lewat Tempo).
  - The reminder message helper.
- API route tests, with the mocked-db style already used:
  - The maintenance job: promotion SQL and the heal phase with its budget and cap.
  - Manual payment record/reverse: link dropped, recreation scheduled.
  - Replace-link route: paid, gateway error, replaced, permission, tenant.
  - Reminder list and reminder record routes: permission, tenant, ordering, no-number count.
- Component tests:
  - The invoice list queue: open, row actions, capability off.
  - The detail page: replace link, last-reminded, stamp on chat.
- e2e: the admin reminder queue opens from /admin/invoices and records a reminder through the API, extending the existing invoice spec. The mobile-layout route list keeps /admin/invoices green.

## Non-goals

- Sending WhatsApp messages automatically (no WhatsApp Business API), and email or SMS reminders.
- Retrying "Link Gagal" (PENDING_PAYMENT_LINK) invoices nightly. "Coba Lagi Link" stays the path.
- Cancelling the old order at DOKU/Xendit when a link is replaced.
- Combined "pay all invoices" links, installment plans, carry-over of arrears, surat penagihan, and parent proof-of-transfer upload.
- Fixing guardian contact data, and backfilling historical reminders.
- Production promotion: that only happens when the user asks.

## Assumptions

- A single "Sisa tagihan" line item is accepted by both DOKU and Xendit. It always sums to the charged amount, which is the safe shape whatever DOKU's rule is.
- The maintenance job can run for up to 60 seconds, the same as the other bulk routes. The heal phase stops starting new links about 22 seconds after the job begins, the pattern already proven in "Buat link baru (N)".
- Demo mode's stub gateways stand in for DOKU/Xendit in local verification. A real DOKU sandbox is not available here.
- The guardian used for reminders is the invoice's primary active guardian, the same one the detail page uses today.

## Gate re-openers

- **Schema migration:** additive and nullable. Invoice gets last-reminded time, last-reminded-by and a reminder count. Named here, so it is approved.
- **New mutating routes**, so auth-sensitive: replace a link, list reminders, record a reminder. The PR is labelled `needs-staging-verify`.
- **Automatic gateway orders from the nightly job:** it creates payment orders with no human pressing a button. This is the intended behavior, approved with this spec.
- No new dependency, no PII change (WhatsApp numbers are already shown to admins), no production write by this cycle.

## Tasks

- [x] T1 Overdue links last 7 days — accept: expiry unit tests for past-due (7d), due-today (24h floor), future (end of due date), cap (30d). (deps: none; reuse: existing expiry tests) **parallel A**
- [x] T2 Partial-invoice link charges one "Sisa tagihan" line — accept: session test shows one line equal to remaining for a partly paid invoice, real lines otherwise. (deps: none) **parallel A**
- [ ] T3 Nightly maintenance promotes past-due partial invoices and heals missing links — accept: route tests for the SQL covering both statuses, a heal phase under a deadline, at most 50, failure isolation, cache bust. Selection and budget are shared with "Buat link baru (N)". (deps: none; reuse: create-missing-links selection and deadline, ensurePaymentLink) **parallel A**
- [ ] T4 Reminder bookkeeping and API — accept: migration plus schema fields, a list route (ordering, no-number count, permission, tenant) and a record route (stamp, count, audit, rate limit, permission, tenant) with tests. (deps: none; reuse: invoice-reminder helpers, recordAudit, primary-guardian include) **parallel A**
- [ ] T5 Lewat Tempo wins once past due, and receipts follow money paid — accept: payment-state unit tests, gateway payment path uses the same rule, kuitansi routes and buttons allowed for any invoice with money paid (admin and parent) with tests. (deps: none) **after A** (touches the admin detail page)
- [ ] T6 Manual record/reverse drops the stale link and remakes it — accept: route tests show the link cleared in the payment transaction and recreation scheduled after the response. (deps: T2 for amounts) **after A, parallel with T5**
- [ ] T7 Replace the link on one invoice — accept: route tests (paid → recorded, gateway error → kept, live → replaced, permission, tenant), plus the detail-page action with confirmation and component tests. (deps: T5 on the same page) **after T5**
- [ ] T8 Reminder queue on the invoice list, plus last-reminded and stamping on detail — accept: component tests (open, ordering shown, WhatsApp href, stamp call, "Buat link dulu", capability off), detail page shows "Terakhir diingatkan" and stamps on chat, e2e queue flow. (deps: T4, T7) **after T7**
- [ ] T9 Docs: README finance line, `docs/uat/jobs/admin.md` (reminder queue, replace link), payments runbook (nightly heal, 7-day overdue links) — accept: `bash scripts/audit-docs.sh` clean. (deps: all)

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5.
  - T1, T2, T3 and T4 run in parallel: disjoint files.
  - T5 and T6 then run in parallel.
  - T7 and T8 run sequentially: both touch the admin invoice detail page, and T8 needs T4's API.
  - T9 is inline: a docs-only sweep after the code lands.
  - Workers edit and test only; the driver runs the gate, reviews and commits one commit per task.

- T2: `lib/payments/session.ts`, `lib/payments/__tests__/session-line-items.test.ts`. New `sessionLineItems()`: a partly paid invoice goes out as one "Sisa tagihan <no>" line for the remainder; the adapters still round both amount and price.
- T1: `lib/payments/expiry.ts`, `lib/payments/__tests__/resolve-session-expiry.test.ts`. A due date before today (WIB, from the injectable `now`) floors the window at 7 days; due today keeps the 24-hour floor; the 30-day cap is unchanged. Registration fees use `defaultExpiresAt` and are unaffected.

## Verification

## Ship Notes
