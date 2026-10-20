# Payment link expiry: store it, show it, keep invoices recoverable, and a status filter that helps

## Context

An admin opened invoice INV-2026-0118 and saw what looked like an expired payment link. The link was live. Investigation (2026-10-20, database read plus code) found two causes:

1. **The expiry date is computed and thrown away.** A link's expiry is decided when it is created, then never stored, so nothing in the app can say when the current link stops working.
2. **The activity card reads like a present-tense verdict.** It lists "Perbarui manual · kedaluwarsa" events from the invoice's two earlier links. Both were real expiries of links that were then replaced; the card does not say so. The invoice's first link expired on 17 Oct, a second made on 18 Oct lasted about a day (it predated the 7-day overdue window), and a third is current.

How links and statuses work today:

- **An invoice holds one current link.** Creation is guarded so two callers cannot make two. When a link expires and a new one is made, the old link is gone from the invoice; the only record of earlier links is the payment activity log. "Several links over time" is a replacement chain, not a list of live links.
- **Status follows money and the due date, not the link.** Draft → Link Dibuat (SENT) → Lewat Tempo (OVERDUE) once the due date passes; Dibayar Sebagian before the due date and Lewat Tempo after it when part is paid; Lunas; Dibatalkan; "Link Gagal" when a link could not be made. An expired link does not change a Lewat Tempo or Dibayar Sebagian invoice's status; it only loses its link.

Three more findings fold into this cycle (the user asked for the lifecycle follow-up on 2026-10-20; a second Opus 5.5 review then trimmed it, see Non-goals):

3. **Nothing happens at the expiry instant.** A dead link looks live until a gateway poll notices. Storing the date (above) fixes how it *looks*: it shows as expired immediately.
4. **A link that dies before its due date turns a Link Dibuat invoice into "Link Gagal"**, a status that means *creation failed*. That invoice then drops out of everything that looks at money owed: the parent's list, the outstanding total, reminders, the nightly heal. The admin's "Buat link baru" and the parent's "Minta link baru" refuse it ("tidak perlu link baru"). Lewat Tempo and Dibayar Sebagian invoices keep their status when their link dies and are healed; this is the one case that is not.
5. **The status filter does not match how the admin works.** The admin chases money: "who still owes?", "who is overdue?", "who needs a link?". The filter lists seven raw statuses in storage order (Draft is not even created any more), has no "belum lunas" view, no way to list invoices that need a link (only two buttons that act on them), and no counts.

Desired outcome: the admin can see when the current link stops working, in the detail page and in the list; earlier expiries on the activity card say they were earlier; an invoice whose link dies early stays owed and gets a new link like every other unpaid invoice; and the status filter answers the admin's actual questions.

UAT input: the newest admin report (`docs/uat/reports/2026-04-24-admin.md`) is past the 60-day rule and predates the payment-link cycles; not used.

## Decisions

- **D1. The date describes the current link only.** One nullable value on the invoice, stored with the link. No links history table: earlier links stay in the activity log, which already records each expiry.
- **D2. The date stored is the expiry the app requested, not the string the gateway sends back.** The gateway's string can be a format that does not parse; saving it would fail after the gateway already made an order, and the retry would make a second one. The requested expiry is computed once, before the retry loop.
- **D3. The date goes away wherever the link goes away.** Expired, replaced, voided, or dropped after a payment. The display also requires that a link exists, so a missed clear can never show a ghost date.
- **D4. Existing links have no date, and we do not guess.** They show a muted "Tanggal berlaku belum tercatat" until the link is next replaced.
- **D5. "Kedaluwarsa" is a display state, not a status.** No new status. It shows red, only for unpaid invoices (Link Dibuat, Dibayar Sebagian, Lewat Tempo) whose link date has passed, even before the nightly sweep clears the link. Paid and cancelled invoices keep their stored link and never show it. No near-expiry warning.
- **D6. Shown on the admin invoice detail and the admin invoice list.** Not on the parent portal: parents pay on DOKU's own page, which states the expiry. The list gets one sortable column.
- **D7. Dates show in WIB with the time.** The 1-day and 7-day floors give mid-day expiries, so a date alone would mislead.
- **D8. Expired-event wording.** Both "Perbarui manual · kedaluwarsa" and "Sesi kedaluwarsa" events read "Link sebelumnya kedaluwarsa", only for events that were processed. Ignored or duplicate events keep their wording, since they do not always describe an earlier link.
- **D9. Column name is `paymentLinkExpiresAt`.** English identifier, Indonesian labels. It sits beside the `xendit*` columns, which are recorded naming debt.
- **D10. An expiring link never changes a status by itself, except past due.** A Link Dibuat invoice whose link dies before its due date stays Link Dibuat with no link, exactly as Lewat Tempo and Dibayar Sebagian already do, so the nightly heal, the admin button and the parent's request all work on it. "Link Gagal" goes back to meaning only "creating a link failed". Past its due date, Link Dibuat still becomes Lewat Tempo as today. The processor reports "link cleared" for this case so the admin's check says so instead of "no change". The glossary line for Link Dibuat is reworded: a link was made, and it may since have expired and been replaced. Invoices already stuck in Link Gagal from an early expiry are left to the existing "Coba lagi" button; no data fix.
- **D11. A poll that reports expiry while the stored date is still far off is logged, not acted on or hidden.** DOKU orders are all keyed on the invoice's own id, so whether DOKU's status check can answer for an older order than the current link is unverified (no DOKU credentials locally). Ignoring such a report would be worse than the problem: it leaves a permanent do-nothing record, so a dead link could never be cleared or replaced by anyone. So the poll behaves exactly as today and writes one warning line per occurrence when the stored date is more than 5 minutes away. If the warning ever shows up, that is the evidence for a real fix.
- **D12. The status filter shrinks from seven statuses to five questions.** The admin asks: who still owes, who is overdue, who needs a link, who has paid, what was cancelled. The dropdown offers exactly: **Semua Status, Belum lunas, Lewat Tempo, Perlu link, Lunas, Dibatalkan**.
  - **Belum lunas** = Link Dibuat + Dibayar Sebagian + Lewat Tempo, still owing. It replaces the three separate options; each row still shows its own status badge, and the summary cards still count Dibayar Sebagian and Lewat Tempo.
  - **Perlu link** = still owing with no link, plus Link Gagal. That is everything the two header buttons ("Buat link baru" and "Coba lagi") act on, so one option replaces "Tanpa link" and "Link Gagal".
  - Removed from the dropdown: Link Dibuat, Dibayar Sebagian, Link Gagal, Draft. Draft is dropped because no invoice flow creates one any more (billing-run drafts have their own banner). Their raw values still work in the address and API, so nothing that links to them breaks; the dropdown just does not advertise them.
  - "Belum lunas" and "Perlu link" are derived options, not statuses; no new status value exists.
  - Each option shows its count, taken from the page's existing summary request, which needs one new number (invoices still owing). Counts cover the whole school and ignore the search box.
  - One shared definition of "still owes money" (paid less than due) serves the filter, the summary, and the "Buat link baru" pick, so the numbers agree. Today they differ.
  - An unknown status value in the address is rejected with an error instead of crashing the list. Dashboard deep links such as `?status=OVERDUE` keep working.
  - Labels follow the glossary: Lewat Tempo keeps its name; "Belum lunas" already appears on this page.

## Acceptance criteria

- [ ] A newly created link records its expiry, and the admin detail page shows "Berlaku sampai <tanggal, jam> WIB" under the link.
- [ ] A link created before this ships shows "Tanggal berlaku belum tercatat" and no date.
- [ ] An unpaid invoice whose link date has passed shows red "Kedaluwarsa" on the detail page and in the list, even if the sweep has not run.
- [ ] A paid or cancelled invoice never shows "Kedaluwarsa", whatever its stored date.
- [ ] After a link is cleared (expired, replaced, voided, or dropped by a payment), no date is shown and none is left behind.
- [ ] If the gateway returns an expiry in a format that does not parse, link creation still stores the link and the requested expiry; no second order is made.
- [ ] The invoice list has a sortable "Link berlaku" column. Sorting puts invoices without a date last in both directions, and paging does not repeat or skip rows.
- [ ] Below the `md` breakpoint the list row shows the link expiry in its meta line.
- [ ] Payment activity events for earlier expired links read "Link sebelumnya kedaluwarsa".
- [ ] A Link Dibuat invoice whose link expires before its due date stays Link Dibuat with no link, the admin's check reports that the link was cleared, and the nightly heal gives it a new link. Past its due date it becomes Lewat Tempo as before. "Link Gagal" is set only when creating a link fails.
- [ ] On such an invoice the admin's "Buat link baru" and the parent's "Minta link baru" each produce a new link instead of refusing.
- [ ] Lewat Tempo, Dibayar Sebagian, Lunas, Draft and Dibatalkan invoices change status exactly as before.
- [ ] A poll that reports expiry while the stored date is more than 5 minutes away still clears the link as today and writes one warning line; nothing else changes.
- [ ] The Status filter lists, in order: Semua Status, Belum lunas, Lewat Tempo, Perlu link, Lunas, Dibatalkan, each with its count.
- [ ] "Belum lunas" returns every Link Dibuat, Dibayar Sebagian or Lewat Tempo invoice that still owes money. "Perlu link" returns those with no link plus Link Gagal; its count equals the "Buat link baru (N)" and "Coba lagi (N)" buttons' numbers added together.
- [ ] The derived options combine with search and sort; `?status=OVERDUE` from the dashboard, and any other raw status in the address, still filter correctly; an unknown status gives a clear error, not a crash.
- [ ] Seed data includes a link with a past date, so local demo and e2e show the expired state.

## Verify flows

1. **Admin sees a fresh link's date.** Admin, `/admin/invoices`, create a manual invoice for an active student (demo gateway). Open it. The link block shows the URL and "Berlaku sampai … WIB". Edge: the date is in WIB with a time, not a bare date.
2. **Admin sees an expired link at a glance.** Admin, `/admin/invoices`, open the seeded unpaid invoice whose link date is in the past. Detail shows red "Kedaluwarsa". In the list, the row shows the same, and sorting "Link berlaku" ascending puts it first. Edge: a seeded paid invoice with a past stored date shows no "Kedaluwarsa".
3. **Old link with no recorded date.** Admin opens a seeded invoice whose link has no date. It shows "Tanggal berlaku belum tercatat", no red state. In the list the cell shows "—" and the row sorts last in both directions.
4. **Earlier expiries read as earlier.** Admin opens a seeded invoice with an expired-then-replaced link history. The activity card says "Link sebelumnya kedaluwarsa" for the old expiry, and the link block shows the new link's date. Error case: the payment activity request failing leaves the link block intact.
5. **Admin works the status filter.** Admin, `/admin/invoices`, open the Status filter. Options appear in the order above with counts that match the cards. Pick "Belum lunas": only invoices that still owe show; pick "Perlu link": the row count equals the two header buttons' numbers added together. Add a student name in search: the result is the intersection. Error case: a status with no rows shows the empty state, not an error.
6. **Early-expired link recovers.** Admin, `/admin/invoices`, open the seeded Link Dibuat invoice whose link expired before its due date. It still reads Link Dibuat and shows no link; "Buat link baru" makes one with a new date. Edge: the same invoice past its due date reads Lewat Tempo. Error case: the gateway failing the create shows the existing failure message and leaves the invoice Link Dibuat with no link.
7. **Parent can ask for a link too.** Parent, `/parent/invoices`, open the same invoice: the pay button offers "Buat link pembayaran" and produces a link.

Data needed: the seed adds one unpaid invoice with a future date, one with a past date, one with a link and no date, one paid with a past date, one with an expired event in its activity log, one Link Dibuat with an early-expired link and no link, and a mix of Lewat Tempo, Dibayar Sebagian and Link Dibuat invoices with and without links for the filter counts.

## UX notes

- Detail page: the date is the second line of the existing link block, under the URL; the copy-link button stays. Red "Kedaluwarsa" uses the existing status-absent token pair; the no-date note is muted text.
- List: new "Link berlaku" column after Status; sortable; the cell shows the date and time, red "Kedaluwarsa", or "—" when there is no link.
- Status filter: one dropdown, options and order as in D12, count inside the option label, e.g. "Lewat Tempo (12)".
- Labels follow `voice.md`: sentence case, Indonesian, no raw enums.
- Frontend gate: Verification must cite `design-system`.

## Test seams

- Session-creation unit test: the stored date equals the requested instant even when the gateway returns an unparseable expiry; no throw; no second order on retry.
- One table test over every place a link is cleared: each clears the date.
- Webhook-processor tests: early-expired Link Dibuat stays Link Dibuat and reports "link cleared"; past due becomes Lewat Tempo; a poll expiry with a far stored date still clears and logs once.
- Route tests: admin replace-link and parent payment-link on an early-expired Link Dibuat invoice return a new link, not a refusal.
- List route tests: sort puts null dates last with stable paging; each derived filter value alone and with search and sort; "Perlu link" equals the summary counts; raw statuses still work in the address; one shared "still owes money" rule across list, summary and the missing-links pick; an unknown status returns 400.
- jsdom tests for the detail block and the list cell (date, expired for unpaid only, no date recorded), the filter options and counts, and the activity-card relabel.
- e2e only if verify-local finds the list flow uncovered by the existing invoice spec.

## Non-goals

- A separate "Link" filter or new status values; Kedaluwarsa is display only.
- **Polling date-expired links first.** At the current volume (about 200 invoices) every link is already polled every night, so reordering changes nothing, and a link the gateway keeps reporting as pending would hold one of the 50 slots forever. Revisit if the nightly summary ever reports it hit the 200 cap.
- **Making the replacement link in the same sweep.** It saves about 30 minutes once a day. The sweep has no explicit time limit today, polls have a 10-second timeout and a link create can take 32 seconds, so a safe create phase would cut the nightly payment check (which credits payments the gateway never told us about) from 200 invoices to about 60. Needs the real function limit confirmed first. D10 already makes the nightly heal pick up every expired link.
- **Ignoring a poll's expiry report while the stored date is far off.** It would leave a permanent do-nothing record and block every later clear or replace, including the admin's and the parent's buttons. Replaced by the log line in D11.
- A table of past links per invoice.
- Making the nightly heal retry Link Gagal invoices (creation failures keep the admin's "Coba lagi" button).
- Parent portal display of the date, WhatsApp reminder text, backfilling dates for existing links, enrollment fee links (they already store their own expiry).

## Assumptions

1. Showing time as well as date is wanted (D7).
2. Volume is about 200 invoices, so the new column and filters need no database index; recorded in Ship Notes.
3. Showing only the current link's date is enough; the activity log is the history.
4. A Link Dibuat invoice without a link is acceptable: it already happens when a payment is reversed and the new link fails, and the list already shows Lewat Tempo and Dibayar Sebagian invoices without links.
5. The held-back items are a later cycle if wanted, after the DOKU question has evidence: the new log line, and a read-only look at whether the nightly poll after INV-2026-0118's third link cleared it.

## Gate re-openers

- **Schema migration:** one nullable column on `Invoice`, additive, no backfill, default-not-assert so a staging database that e2e writes to stays valid. Apply to staging before verify; note the prod step in Ship Notes.
- **Payment state change:** an expiring link no longer reverts Link Dibuat to Link Gagal (D10). It runs through the existing processor and its session-and-link compare-and-set; no new gateway call and no new link-creation path.
- No new dependency, no auth or PII change, no production write, no paid API use. Touches sensitive paths: payment session and webhook processor (security reviewer on those tasks).

## Tasks

- [x] T1 Migration + store the requested expiry — accept: a created link's expiry is saved with the link, and an unparseable gateway expiry neither throws nor makes a second order (deps: none, reuse: enrollment-fee expiry pattern)
- [x] T2 Clear the date wherever the link is cleared — accept: table test over the shared clear helper, both webhook-processor clears and void (deps: T1)
- [ ] T3 Seed fixtures — accept: the fixtures in Verify flows exist after seeding, in app seed, prisma seed, reseed script and finish-xendit (deps: T1; parallel with T2)
- [x] T4 Detail page link block — accept: three states render (date, expired for unpaid only, no date recorded) in WIB (deps: T1; parallel with T5)
- [x] T5 Activity card relabel — accept: processed expired events read "Link sebelumnya kedaluwarsa", others unchanged (deps: none; parallel with T4)
- [x] T6 List: sortable column and mobile line — accept: route sort test (nulls last, stable paging) and jsdom cell test pass (deps: T1)
- [x] T7 Status filter, five questions — accept: the six options in order with counts, "Belum lunas" and "Perlu link" derived filters, raw statuses still accepted, unknown → 400, one shared owes-money rule across list, summary and the missing-links pick, composes with search and sort (deps: none; parallel with T6)
- [ ] T8 Expiry keeps Link Dibuat — accept: processor tests in Test seams; admin replace-link and parent payment-link route tests pass; the admin check reports "link cleared"; glossary line reworded; no leftover code or comment treats Link Gagal as the expired-link signal (deps: T2)
- [ ] T9 Far-from-expiry log line — accept: a poll reporting expiry with a stored date more than 5 minutes away clears as before and logs one warning (deps: T1, T8)
- [ ] T10 README/docs touch — accept: README covers the stored expiry and the filter; `bash scripts/audit-docs.sh` exits 0 (deps: T1–T9)

## Implementation

- Plan: driver=claude-opus-5-5, workers=claude-sonnet-5-5; T1+T5+T7 parallel (disjoint files), then T2+T3+T4+T6 parallel (T6 waits on T7: same list route and client), T8 → T9 sequential (both edit the webhook processor), T10 inline (docs only, a worker would need the whole cycle as context). Workers do not commit; the driver runs the task gate per wave and commits each task on its own.
- T1: `prisma/schema.prisma`, `prisma/migrations/20261020000000_add_invoice_payment_link_expires_at/`, `lib/payments/session.ts`, `lib/payments/__tests__/session-link-expiry.test.ts` — nullable `Invoice.paymentLinkExpiresAt`; `createPaymentSessionForInvoice` (the only writer of a new link: ensure-link, xendit-retry, create-session and replace-payment-link all call it) resolves the requested expiry once before `withRetry`, sends it on every attempt, and stores it in the same write as the session id and URL. The gateway's echoed string is never read.
- T6: `app/api/invoices/route.ts`, `components/admin/invoices/payment-link-expiry-cell.tsx` (new) + test, `app/admin/invoices/invoices-client.tsx` + test, `app/api/__tests__/invoices-list-sort.test.ts` (new) — `paymentLinkExpiresAt` joins the sort allowlist with `nulls: "last"` both ways; every sort now ends in `id asc` so ties (a billing run shares one `createdAt`/`dueDate`) page stably (one T7 assertion updated for the tie-breaker). "Link berlaku" column after Status (`priority: low`, hidden below `md`), and the same cell in the `md:hidden` meta line under the student name (renders nothing when there is nothing to say). Cell: date · time WIB, red "Kedaluwarsa" + old date, muted "Belum tercatat", or "—". Reuses T4's helper and tokens, so it adds nothing new to cross-check in `design-system.html`. Sort is by the stored date: a paid invoice keeps its link and date (D5), so sorting ascending over Semua Status puts old paid links first with "—"; pair the sort with Belum lunas for the chase view.
- T7: `lib/finance/invoice-owes.ts` (new), `lib/constants/invoice-status.ts`, `lib/validations/invoice.ts`, `app/api/invoices/route.ts`, `app/api/invoices/stats/route.ts`, `lib/payments/missing-links.ts`, `app/admin/invoices/{page,invoices-client}.tsx`, tests (`app/api/__tests__/invoices-list-status-filter.test.ts` new; `invoices-stats`, `stats-groupby`, `invoices-client` updated) — one owes-money rule (`totalPaid < totalDue`) as Prisma where-builders used by the list filter, the summary and the "Buat link baru" pick. `?status=UNPAID` (Belum lunas) and `?status=NEEDS_LINK` (Perlu link) are derived and sit under `where.AND` so they compose with search; raw statuses still work; an unknown value is a 400 before any read. Summary gains `owing`; the Piutang card's sublabel uses it so one page shows one number. A raw status from the address that the dropdown does not offer (e.g. `?status=SENT`) appears as one extra uncounted option, so the select never reads "Semua Status" over a filtered list. Behaviour change: a SENT/PARTIALLY_PAID/OVERDUE invoice already fully paid no longer counts toward "Buat link baru (N)", matching the pick that never acted on it. Dropdown built with the existing FilterBar select, cross-checked against `design-system.html`.
- T2: `lib/payments/link-cleared.ts` (new, import-free), `lib/payments/ensure-link.ts`, `lib/payments/webhook-processor.ts`, `app/api/invoices/[id]/void/route.ts`, table test `app/api/__tests__/payment-link-cleared.test.ts` + six existing tests' exact-object assertions — `LINK_CLEARED` (session id, URL, expiry → null) is spread at every clear: `staleLinkCleared` (which the record-payment, reverse and replace-link routes already apply), both processor expiry clears, and void. Reconcile, session, seeds and filters only read or write links, never clear them. Removing the field from the constant fails all 8 table rows.
- T4: `lib/finance/payment-link-expiry.ts` (new) + test, `app/admin/invoices/[id]/page.tsx` + test — pure `paymentLinkExpiryState(invoice, now)` → `active` / `expired` / `unrecorded` / `null` (no link, or PAID/CANCELLED; `expired` only for SENT/PARTIALLY_PAID/OVERDUE; the instant itself counts as expired). The detail page renders it as the second line of the link block, "Berlaku sampai <date · time> WIB" via the existing `formatDateTime` (Asia/Jakarta) with `tabular-nums`, red "Kedaluwarsa" in `text-status-absent-text` per `design-system.html`, or muted "Tanggal berlaku belum tercatat". The detail API already spreads the full row, so no route change.
- T5: `components/admin/invoices/payment-activity-card.tsx`, `components/admin/invoices/__tests__/payment-activity-card.test.tsx` — `webhookEventLabel` takes the event status; PROCESSED `payment_session.expired` / `manual.refresh.expired` read "Link sebelumnya kedaluwarsa"; IGNORED and ERROR keep the literal label (no separate duplicate status exists on the wire). Copy-only change inside the existing Badge; cross-checked against `design-system.html` (no visual change).

## Verification

## Ship Notes
