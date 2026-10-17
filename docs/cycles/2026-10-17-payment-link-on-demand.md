# A parent can get a fresh payment link themselves (2026-10-17)

> **Status: user said "yes let's do option 1 and 3" after the discussion below (2026-10-17). Built on the same branch
> and PR as `2026-10-17-expired-link-overdue`, whose sweep makes this matter.**

## Context

A payment link dies at the end of the invoice's due date. Cycle `2026-10-17-expired-link-overdue` makes the nightly sweep
clear a dead link and keeps the invoice owed. That leaves every expired invoice with **no link**, and the parent's invoice
page then says "Link pembayaran belum tersedia. Hubungi tata usaha". So each expired invoice sends a parent to the admin,
who must open it, press "Buat Link Pembayaran" and send the link on WhatsApp, one invoice at a time.

The user asked whether an expired invoice should be replaced by a new invoice. It should not: the invoice is the debt, the
link is only a way to pay it. A second invoice would double-count in Piutang, the student's balance and the parent's amount
due, and would need the original cancelled by hand. What needs fixing is getting a fresh **link on the same invoice**
without an admin.

## Decisions

- **No new invoice.** An expired link is replaced by a new link on the same invoice.
- **Option 1: the parent gets a link on demand.** On an unpaid invoice with no link, the parent page offers "Buat link
  pembayaran". Nothing is created until someone wants to pay, so unopened Virtual Accounts do not pile up at the gateway.
- **A link that has already expired but not yet been swept** (the invoice still shows a link) gets a small "Link tidak bisa
  dibuka? Minta link baru" action. It asks the gateway first, which clears an expired link, then issues a new one; a live
  link is returned unchanged, so it can never create a second link for an invoice that still has a working one.
- **Option 3: an admin bulk button.** "Buat link baru (N)" on the invoice list creates links for every unpaid invoice that has
  none, 25 per press, and says how many are left. Shown only when N is above zero. For the admin who prefers to send links
  out proactively.
- The due date does not change. A new link keeps the existing rule: valid to the end of the due date, and never less than 24
  hours from now, so a past-due invoice gets a link good for a day.
- No message is sent to the parent. They see the link in their portal; the admin's WhatsApp reminder already carries it.

## Acceptance criteria

- [ ] A parent opening an unpaid invoice that has no link sees "Buat link pembayaran"; pressing it creates a link and the page
      then shows "Bayar sekarang" with that link.
- [ ] A parent can only do this for an invoice of their own child, in their own school; any other invoice answers as not found.
- [ ] Only `SENT`, `PARTIALLY_PAID` and `OVERDUE` invoices get a link this way; paid, cancelled, draft and "Link Gagal"
      invoices do not.
- [ ] Pressing the button twice, or from two tabs, never leaves an invoice with two different live links.
- [ ] "Minta link baru" on an invoice with a live link returns that same link; on an expired one it returns a new link.
- [ ] A gateway failure shows a calm message and the "hubungi tata usaha" help, and leaves the invoice unchanged.
- [ ] The admin's "Buat link baru (N)" creates links for at most 25 unpaid invoices of the admin's own school that have none,
      shows the count of what is left, and one failing invoice does not stop the rest.
- [ ] An admin without invoice-creation permission gets no button and a 403.

## Verify flows

Local app on a disposable Postgres, demo seed, demo gateway.

1. **Parent, no link:** parent `u_rightjet` opens an unpaid invoice whose link was cleared; presses "Buat link pembayaran"; the
   button becomes "Bayar sekarang" with a link.
2. **Parent, dead link:** an invoice that still holds an expired link; "Link tidak bisa dibuka?" returns a new one.
3. **Edge:** the same parent presses the button twice quickly; one link results.
4. **Error:** another family's invoice id returns not found; the gateway failing shows the calm message.
5. **Admin:** `/admin/invoices` shows "Buat link baru (N)" when N > 0; pressing it creates up to 25 links and the toast says how
   many remain; the button disappears at zero.

## UX notes

- Parent voice (`voice.md`): warm and short. Button "Buat link pembayaran". While working: "Menyiapkan link…". On failure: "Link
  belum bisa dibuat. Coba lagi sebentar lagi, atau hubungi tata usaha." The existing "hubungi tata usaha" box stays as help.
- Admin: outline button in the invoice list header beside "Cek semua belum lunas", label "Buat link baru (N)".

## Test seams

- API integration tests for the two new routes (auth, scoping, statuses, idempotency, failure).
- Component tests for the parent sheet states and the admin button.
- One browser walk for the parent flow and the admin button; the full Playwright suite before shipping.

## Non-goals

- Notifying the parent (WhatsApp, email) when a link is made.
- Extending the due date or giving a grace period.
- Creating links for "Link Gagal" invoices from the parent page (that is the admin's retry queue).
- Regenerating links automatically in the nightly sweep (a past-due invoice would be re-created every night, unseen).
- Changing the Pendaftaran fee flow, which already regenerates its own link.

## Assumptions

1. The user's "yes" to option 1 means parents may create their own payment link for their own child's unpaid invoice. If the
   school wants an admin to approve before a family can pay, this changes.
2. The due date stays; the new link follows the existing expiry rule.
3. `payments` stay read-only here: creating a session writes only the link fields on the invoice, as the admin button does.
4. A double press can still ask the gateway twice, but the second answer replaces the first on the same invoice number, so the
   invoice ends with one link.

## Gate re-openers

A new parent-facing endpoint changes what a guardian may do (it creates a gateway session). The user approved that behaviour in
the discussion above. No schema change, no new dependency, no environment variable.

## Tasks

- [x] T1 Parent endpoint `POST /api/guardian/invoices/[id]/payment-link` — accept: ACs 1 to 5 at the API (reuse: `check-payment` scoping, `createPaymentSessionForInvoice`, `reconcileInvoicePayment`)
- [x] T2 Parent sheet: "Buat link pembayaran" and "Minta link baru" — accept: ACs 1 and 6 (deps: T1)
- [x] T3 Admin bulk: `POST /api/invoices/create-missing-links`, count in stats, "Buat link baru (N)" — accept: ACs 7 and 8 (reuse: `limit`, the T6 batch pattern)
- [x] T4 Docs: runbook, README, JTBD parent and admin — accept: docs match the behaviour

## Implementation

- Plan: driver=claude-sonnet-5, workers=claude-sonnet-5 (security reviewer on the two new routes); T1-T4 sequential and inline, each depending on the previous slice's helper; reviews after T3.
- T1: `lib/payments/ensure-link.ts` (new; one owner of "give an unpaid invoice a link, once"), `app/api/guardian/invoices/[id]/payment-link/route.ts` (new). The helper creates a link only for `SENT` / `PARTIALLY_PAID` / `OVERDUE` invoices of the right school that have none, behind a database claim: a conditional `updateMany` stamps `paymentCheckedAt` only if the invoice still has no link and was not claimed in the last 30 s, so one of several simultaneous callers creates the session and the rest wait up to 6 s for its link instead of making a second one; a failed attempt gives the claim back. It needs no schema change. The route mirrors `check-payment`'s scoping (401 / 403 / flat 404), rate limits 6 a minute per parent and invoice after scoping, asks the gateway first when a link is held (so an expired link is cleared and a payment credited) and answers only `{ paymentUrl, created }`, a 409 `NOT_PAYABLE`, or a calm 502. Tests: helper (statuses, existing link, claim, losing the claim, failure release) and route (auth, scoping, pre-check order, outcomes).
- T2: `app/parent/invoices/invoice-detail-sheet.tsx`. With no link the sheet offers a full-width "Buat link pembayaran" above the existing contact box (kept as help, text unchanged); with a link it keeps "Bayar sekarang" and adds a quiet ghost action "Link tidak bisa dibuka? Minta link baru". Both call the T1 endpoint and swap the new URL into the sheet's own state, so "Bayar sekarang" appears without a reload. Every message is ours (success, "masih berlaku", 409 re-reads the status, 429, calm failure, lost connection); the server's text is never shown. The button disables and reads "Menyiapkan link…" while working. Standards loaded: `portal.md` (error contract, never silently ignore), `voice.md` (parent: warm, actionable, never a caught error), and cross-checked against `design-system.html`: the existing primary `Button` size lg beside the existing outline contact actions, no new component or colour. `better-accessibility` applied to the two buttons: real `<button>`s, `aria-busy` while working, 44 px targets from `size="lg"`, the ghost action sized like the page's other controls. Tests: 12 component cases in `invoice-detail-sheet-link.test.tsx` (offer, swap, double-tap guard, failure, offline, rate limit, 409, live link kept, replaced link, paid and "being prepared" states offer nothing).
- T3: `app/api/invoices/create-missing-links/route.ts` (new; `invoices.create`, tenant-scoped, 6 a minute per admin, `maxDuration` 60), `app/api/invoices/stats/route.ts` (`unpaidWithoutLink`), `app/admin/invoices/invoices-client.tsx`, `lib/payments/ensure-link.ts` (option `releaseOnFailure`). The server takes the tenant's next 25 unpaid invoices with no link (untouched first, then by due date, skipping any claimed in the last 30 s) and makes each link through `ensurePaymentLink`, five at a time, with the same 40 s start deadline as the bulk status check. A failed invoice keeps its claim stamp so it sorts behind untouched ones and cannot starve them; a batch never waits on a racing winner. It answers `{ created, failed, skipped, remaining }`. The header button "Buat link baru (N)" shows only with `invoices.create` and N > 0, N coming from the stats call, and reloads list and stats afterwards. `design-system`: an outline `Button` with the existing `LinkIcon`, the same size and weight as its header neighbours. Tests: route 13, stats, helper option, client 7.
- T4: README (finance and parent lines), `docs/runbooks/payments-gateway.md` ("Replacing an expired link"), `docs/uat/jobs/admin.md` (INV-02 step 7) and `docs/uat/jobs/parent.md` (INV-01 step 5), "Last audited" bumped.
- **Security review** (independent; the parent endpoint lets a guardian cause a gateway session to be created): no IDOR, tenant leak or response leak; scoping and the flat 404 mirror `check-payment`. It found one functional bug the mocked tests could not and several hardening points. Fixed:
  - **The claim was blocked by the pre-check's own stamp.** The parent route asks the gateway first when a link is held, which stamps `paymentCheckedAt` with "now"; the claim then read that stamp as "someone is creating this" and the first press 502'd. The claim is now a stamp **in the future** (now + 45 s), and only a future stamp counts as a claim, so a payment check's past stamp is harmless. Proven on real Postgres (below).
  - **A failing invoice was retried on every press** (the claim was given back on failure), so a malicious or unlucky parent could hammer the gateway. A failed attempt now keeps its claim, which expires on its own: one attempt per 45 s per invoice across every instance. The DOKU session create also had no timeout; it now aborts at 10 s (3 tries stay inside the claim).
  - A release or completion now only touches its own claim (`paymentCheckedAt` equals the claim time), so it never overwrites a newer stamp; on success the claim becomes an ordinary check stamp.
  - The guardian lookup counts only `ACTIVE` guardian links, since this route writes.
- **Known residuals, not built:** (1) a payment landing in the second or so between reading the remaining amount and writing the new link could leave a link on a just-paid invoice; the same window exists in the admin's "Buat Link Pembayaran" and the fix belongs in `createPaymentSessionForInvoice`, shared by every flow. (2) For `PARTIALLY_PAID` the session's line items still sum to the full amount while the amount is the remainder (the admin action does the same; DOKU may or may not reject it). (3) Return URLs use the request origin, as every other route does; on Vercel the host is validated. (4) After a failed batch the "remaining" count excludes the failed invoices for 45 s, while the button's own count includes them.

## Verification

Final tree on this branch, nothing recorded from memory:

- `npm run lint` (max-warnings 0) and `npx tsc --noEmit` clean; `npx vitest run` `Test Files 634 passed | 2 skipped (636)`, `Tests 7401 passed | 42 todo`; `verify-api-auth.sh` "213 / 213 routes"; `verify-rls-coverage.sh` "43 / 43"; `audit-docs.sh` 0 fail; `DEMO_MODE=true NEXTAUTH_SECRET=local-dummy npm run build` exit 0.
- **Playwright**, full suite on a disposable Postgres 16 with the demo seed, Chromium, against `DEMO_MODE=true npm run start`: `240 passed (6.7m)`, no failures, none flaky (the pre-installed Chromium was launched by path through a throwaway config override, deleted afterwards).
- **The parent flow on real Postgres** (throwaway test, gateway stubbed): a `SENT` invoice past its due date holding an expired link, parent presses "Buat link pembayaran": `200 {"paymentUrl":".../new-1","created":true}`, the invoice ended `OVERDUE` with the new link (the sweep's rule applied on the way). Two presses at the same moment on a link-less invoice: both `200`, **one** session created (`sessionsCreated 1`), both returned the same link. This run is what proved the claim fix: before it, the pre-check's own stamp blocked the claim and the first press failed.
- **Browser walk** (Playwright script; parent `u_rightjet` on a 390 x 844 viewport, super admin on desktop, demo gateway). Parent, Agustus 2026 (overdue, no link): "Buat link pembayaran" shown above the contact help; pressing it answered `200 created:true`, the toast read "Link pembayaran sudah siap. Silakan ketuk Bayar sekarang.", "Bayar sekarang" appeared with the new link and the contact box went away. Parent, September 2026 (holds a link): "Bayar sekarang" plus the quiet "Link tidak bisa dibuka? Minta link baru"; pressing it answered `created:false` and the toast read "Link pembayaran masih berlaku." Another family's invoice id: `404 {"error":"Not found"}`. Admin: "Buat link baru (79)" in the header; three presses created 25, 25, 25 with 54, 29, 4 left. `design-system` check against the screenshots: the primary button is the page's existing size-lg control, the help box and the Cara Bayar card keep their spacing, the ghost action sits quietly under the primary one.
- One copy fix from the walk: under the new button the help box said "Link pembayaran belum tersedia", which now contradicts the button above it; it reads "Bila link belum bisa dibuat, silakan hubungi bagian tata usaha sekolah ..." and keeps the wording the existing tests pin.

## Ship Notes
