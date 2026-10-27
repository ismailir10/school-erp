# Record money the school already took: "Sudah dibayar" invoices and SPP paid in advance

## Context

An admin at An Nisaa' Sekolahku asked two things (WhatsApp, 2026-10-27):

1. A student's **SPP is paid for the whole school year** in one go. How is that recorded?
2. A student for **TA 2027/2028 paid "biaya sekolah tahap 1" in cash before any invoice existed**. Can the invoice be entered in the web app without emailing the parents, so the transaction is still recorded?

What happens today:

- A manual invoice always gets a payment link from the gateway the moment it is created, and under DOKU the gateway emails the Virtual Account number to the primary wali. There is no way to say "this is already paid". The only workaround is to create the invoice (the parent is emailed "please pay") and record the cash afterwards. That is exactly what the school did for all 8 cash payments on production: each was recorded about 6.5 days after its invoice.
- There is no idea of "paid in advance". The monthly Billing Run bills every student for each month; a single yearly invoice does not stop it because it only skips a student that already has an invoice for the same month label.

Production facts (read-only aggregate queries on production project `vxwywmvpxetdgnxejjgk`, 2026-10-27; no writes, no personal data):

- **SPP is the only monthly fee.** Every other fee component (uang pangkal, sarana, seragam, tas, haflah, pengembangan, kemitraan, pendaftaran) is one-time.
- Billing began in **Oktober 2026**. Invoices exist for Oktober (153) and November (111, created today) plus two September stragglers. Juli to September were never billed; Desember to Juni do not exist yet.
- 28 invoices with **no SPP line** carry the label "Oktober 2026" (one-time fee bundles for about 20 new students); for 23 of them the same student has no October SPP invoice. The Billing Run's duplicate check is by label only, so it probably hid their October SPP. **Out of scope here; it needs its own cycle** (list the affected students first).
- 24 active students have **no active class enrollment** (new intake), all billed by manual invoice. These are the people item 2 serves; they also cannot be priced for SPP in advance because they have no program.
- Every invoice, including all 121 paid ones, has a payment link. 58 of 201 primary wali have no email, 61 have no phone.
- 20 bank-transfer payments, 5 of the 16 invoices still partly paid: instalments are normal. The "Admissions" fee table is empty, so "tahap 1" is an ordinary manual invoice of one-time components.

The design was reviewed against the code by a second model (Opus 5.5). Its findings changed five things, recorded in the decisions below.

## Decisions

- **D1. One shared way to record a payment.** The logic inside "Catat Pembayaran" (overpayment guard, status recompute, audit) moves into one function that the existing route and both new features call. It never schedules a new payment link; only the existing route does that. Reason: one place for money rules.
- **D2. "Sudah dibayar" pays the whole invoice.** The payment must equal the invoice total. Tahap 2 is its own invoice later. Reason: an invoice that is part-paid and has no link is picked up by the nightly job, which creates a link and emails the parent.
- **D3. A paid-at-creation invoice is stamped as sent.** No message is sent, but the "sent" mark is set. Reason: if the payment is ever reversed, an invoice that was never sent falls back to an invisible draft that nothing recovers; marked as sent it goes back to Terkirim or Lewat Tempo and the normal link flow can reissue a link (which then rightly emails the parent).
- **D4. No gateway call, so no link and no email, for both features.** New invoices created paid never touch the gateway.
- **D5. SPP in advance is one invoice per month, each fully paid.** Not one yearly invoice, not a 100% discount. Reason: the Billing Run then skips those months by itself; reports stay per month; a discount would erase income from the reports.
- **D6. SPP only.** It is the only monthly fee, so there is no choice of components.
- **D7. Month status comes from invoices that contain an SPP line, not from the label.** A month whose only SPP invoice is cancelled counts as "none" and is created, not skipped. An SPP invoice whose label does not name one month shows a warning. Reason: 28 production invoices without SPP wear month labels.
- **D8. Existing unpaid SPP invoices in the range are settled.** Oktober and November already exist and are unpaid for a prepaying family. A partly paid one gets its remaining balance.
- **D9. Settling an existing invoice clears its old payment link.** The gateway has no way to cancel a session, so the app forgets the link and the preview tells the admin when the old Virtual Account expires and to tell the parent not to pay it. If the parent pays anyway the app already flags it "Perlu dicek" and the remedy is a refund. Known gap, not widened here: the nightly check does not poll paid invoices, so a lost notification on a paid invoice goes unseen.
- **D10. Pricing is the Billing Run's, per month.** Each month's amount is the student's program SPP for the year plus any active fee waiver (keringanan) valid on that month's due date (last day of the month). A student with no program for the year gets a clear error and cannot be prepaid. No "amount received" field: a discount for paying early is entered as a keringanan first.
- **D11. Default range is the whole academic year, July to June.** Indonesian schools start the new year in mid-July and end in June (2026/2027 began 13 July 2026 for most regions), and this school's year is 1 July 2026 to 30 June 2027, so a family paying "SPP setahun" pays Juli to Juni. The admin can narrow the range. Months before the first month this school ever invoiced (here Juli to September) carry a note, "belum pernah ditagih di sistem ini", so the admin knows those invoices are new; they are not hidden or skipped.
- **D12. All or nothing, and refuse when things changed.** All months are written in one transaction. If any invoice's balance changed since the preview (for example the gateway credited October meanwhile) the action refuses and asks for a fresh preview, because the cash total is fixed. A resubmit finds the months already paid and writes nothing more.
- **D13. Permissions.** Both features need `invoices.create` and `payments.record`. The existing invoice-create route also gains the rate limit, audit entries and standard validation it lacks today.
- **D14. No schema change.** Payments of one prepay share a reference ("SPP di muka TA 2026/2027") and a note; that is how they are grouped.

## Acceptance criteria

"Sudah dibayar" invoice:

- [ ] In Tagihan Manual an admin with both permissions can tick **Sudah dibayar**, choose Tunai, Transfer Bank or Lainnya, a paid date (today or earlier) and optionally a reference and note.
- [ ] Saving creates an invoice that is Lunas straight away, with one payment equal to its total, and the receipt shows the chosen paid date as the date paid.
- [ ] No payment link is created and no email or other message is sent to the wali. The parent portal shows the invoice as Lunas.
- [ ] A gateway method, a future date or a missing paid date is refused with a message on that field.
- [ ] An admin without `payments.record` does not see the option, and the endpoint refuses the payment part.
- [ ] Submitting twice (double click or retry) creates one invoice and one payment.
- [ ] Reversing that payment returns the invoice to Terkirim (or Lewat Tempo when past due), after which "Buat link baru" works as for any unpaid invoice.
- [ ] The invoice and its payment each leave an audit entry.
- [ ] A student without a class enrollment (an active new-intake student) can be billed this way.

SPP in advance:

- [ ] From Tagihan an admin opens **Catat SPP di muka**, picks an active student and a month range, a method, a paid date and optionally a reference, and sees a preview before anything is saved.
- [ ] The preview lists every month with the SPP amount (waivers applied for that month), what will happen (create and pay, pay the rest of the existing invoice, or skip because already paid), and the total.
- [ ] A month whose only SPP invoice is cancelled is created again; a month with no SPP invoice but another invoice carrying the same month label is still created.
- [ ] A student with no program for the year gets an explicit message and cannot be confirmed.
- [ ] Confirming settles every listed month in one step; every month ends Lunas; the payments share one reference and note.
- [ ] A partly paid existing invoice receives only its remaining balance.
- [ ] Settling an existing invoice that has a payment link clears the link; the preview shows when the old Virtual Account expires and the line "Minta wali tidak membayar VA dari email".
- [ ] No payment link is created and nothing is sent for any month; the parent portal shows the months as Lunas.
- [ ] If any invoice changed between preview and confirm, nothing is saved and the admin is told to refresh the preview.
- [ ] Confirming twice writes nothing the second time.
- [ ] The next monthly Billing Run does not bill this student for the prepaid months.
- [ ] The default range is the academic year's first to last month (Juli to Juni); the admin can narrow it but it cannot leave the academic year. Months before the school's first invoice carry a "belum pernah ditagih" note. An unreadable SPP label shows a warning on that student.
- [ ] Audit entries exist for each created invoice and each payment.

## Verify flows

1. **Cash tahap 1, no email.** Admin → Keuangan → Tagihan → Tagihan Manual. Student: an active student with no class. Add Uang Pangkal + Sarana, label "Biaya Sekolah Tahap 1 TA 2027/2028", tick Sudah dibayar, Tunai, a date three days ago. Expect: invoice Lunas, one Tunai payment, kuitansi shows that date, no link on the detail, parent portal shows Lunas. Edge: reverse the payment, the invoice is Terkirim and "Buat link baru" appears. Error: pick a future date, the Tanggal bayar field shows a message.
2. **Prepay SPP, mixed months.** Student with Oktober paid, November unpaid with a link, December onward missing. Catat SPP di muka, default range (Juli → Juni). Expect preview: Juli to September create and pay (with the "belum pernah ditagih" note), Oktober skip, November pay (old link expiry shown), Desember to Juni create and pay. Confirm: all Lunas, one shared reference; November's link gone. Then run Billing Run for Desember: this student is skipped.
3. **Drift refusal.** Open the preview, then record a payment on November from another tab, then confirm. Expect refusal with "muat ulang pratinjau"; nothing written. Confirm again after refreshing: works.
4. **Cannot price.** Student with no class enrollment, Catat SPP di muka. Expect a clear "belum punya program tahun ini" message and no Confirm.

Data: local seeded demo tenant with a student per case above; a role without `payments.record` for the permission check.

## UX notes

- **Tagihan Manual:** one checkbox row "Sudah dibayar" under the lines. Ticking it reveals Metode, Tanggal bayar, Referensi, Catatan, and shows a plain line: "Tagihan langsung Lunas. Tidak ada link pembayaran dan tidak ada email ke wali." The primary button reads "Simpan sebagai lunas" while ticked. The period field hints at a clear label ("Biaya Sekolah Tahap 1 TA 2027/2028") because month labels collide with the monthly run.
- **Catat SPP di muka:** a second button beside Tagihan Manual, same dialog family. Step 1 picks the student, range and payment; step 2 is the preview table (Bulan, Jumlah, Tindakan) with a total, warnings in a calm alert above it (old VA expiry, unreadable label), and the primary button "Catat Rp X lunas". Empty and error states in the voice standard: a student with no program says what to fix and where.
- Frontend work follows design-system.html and the voice and CRUD standards; Dialog uses the existing overlay pattern.

## Test seams

- Unit: shared payment function; the SPP month planner (pure: month status, cancelled, unreadable labels, waivers per month, no program, range); `defaultDueDateForPeriod` after its move.
- API integration: `POST /api/invoices` with and without `payment` (no gateway call, status, sentAt, idempotency, permissions, tenant scope); the prepay preview and confirm routes (link cleared, drift 409, replay, all-or-nothing, locks do not deadlock a concurrent payment).
- Component: the two dialogs.
- E2E (one spec, labelled `e2e`): admin creates a paid invoice, then prepays SPP and sees the months Lunas.

## Non-goals

- Fixing the Billing Run's label-only duplicate check, and the October SPP it may have hidden for new students.
- Cancelling or expiring a gateway session; polling paid invoices in the nightly check.
- Changing the existing "Catat Pembayaran" behavior (partial payments, relink) or the Admissions fee.
- Fee structures or an academic year for TA 2027/2028.
- An "amount received" field, refunds, or re-pricing an existing invoice.
- Entering the actual students' data (the admin does that after it ships).

## Assumptions

1. The TA 2027/2028 payers are already active Student records (like the 24 new-intake students). If they are still Admissions applicants they must be converted first. Not verifiable from the data.
2. "Tahap 1" is the whole invoice being entered; tahap 2 is a separate later invoice.
3. A family that pays SPP for the year pays all twelve months, Juli to Juni, including the months before this school started billing in the system (Juli to September). Those months are created as paid invoices; the admin narrows the range if some were settled elsewhere.
4. If a parent pays a cleared Virtual Account anyway, the existing "Perlu dicek" flag plus a refund is accepted as the remedy.
5. Whether DOKU emails the VA is taken from the existing code comment; it was not observed live.
6. Future-dated paid invoices (Desember to Juni) are acceptable; the dashboard "collected" figure will look high this month while billed months are in the future (cosmetic).

## Gate re-openers

None: no schema migration, no new dependency, no new personal data. Touches money and permission checks on `app/api/**` (a sensitive path), so the security standard applies; it is not auth-impacting (no auth or session logic changes), so no `needs-staging-verify` label is expected.

## Tasks

- [x] T1 Shared payment function — accept: the existing "Catat Pembayaran" route behaves exactly as before (its tests stay green) and the function never schedules a relink (deps: none, reuse: payments route, `recomputeInvoiceFromPayments`)
- [ ] T2 Move the due-date-for-period helper into `lib/finance` and add the SPP month planner — accept: planner unit tests cover month status, cancelled, unreadable label, waivers per month, no program, range (deps: none, reuse: `parsePeriodMonth`, `applyAdjustments`, `BILLABLE_FEE_COMPONENT_WHERE`) — parallel with T1
- [ ] T3 `POST /api/invoices` "payment" mode plus rate limit, audit, standard validation, idempotency — accept: paid invoice with no gateway call, `sentAt` set, replay safe, permission and tenant tests (deps: T1)
- [ ] T4 Tagihan Manual dialog "Sudah dibayar" — accept: component tests; the reveal, labels and errors per UX notes (deps: T3)
- [ ] T5 SPP prepay preview and confirm routes — accept: link cleared on settle, drift returns 409, replay writes nothing, one transaction with an explicit timeout, lock order documented in code (deps: T1, T2)
- [ ] T6 Catat SPP di muka dialog and button — accept: component tests; preview table, warnings, empty and error states (deps: T5, parallel with T4)
- [ ] T7 E2E spec, README module line, `docs/uat/jobs/admin.md` job text, counts block via `bash scripts/audit-docs.sh --write` — accept: audit-docs passes (deps: T4, T6)

## Implementation

- Plan: driver=claude-sonnet-5-5, workers=claude-sonnet-5-5 (this session runs on Sonnet, so there is no higher tier to keep for the driver; the design was reviewed by Opus 5.5 before the spec). T1 and T2 parallel (disjoint files); T3 and T5 parallel after them; T4 after T3 and T6 after T5, parallel with each other; T7 inline (docs, e2e wiring, counts).
- Branch note: this cloud session is assigned `claude/charming-rubin-j6dkje`, not `feat/*`, and works in the main checkout of an isolated container.
- Local DB note: no Docker here, so the disposable Postgres 16 is a throwaway cluster on port 54329 (`/var/lib/postgresql/talib-verify`); `prisma db push` without `--force-reset` on the empty database (Prisma refuses `--force-reset` for agents).


## Ship Notes
