# Catat SPP di muka — "Perlu diperiksa" names the invoice

## Context

An admin recording SPP paid in advance (Januari–Juni 2026) saw this caution and did not know what to do with it:
"Tagihan lunas dengan label "SPMB Tahap 1" memuat SPP tetapi tidak menyebut satu bulan, jadi bulan-bulannya tidak terbaca.
Pastikan SPP bulan-bulan itu belum dibayar sebelum mencatat."

The app cannot tell which months such an invoice covers (its label names no month), so it asks a person to check it
before recording. The warning only gives the label, so the admin has to leave the dialog and hunt for the invoice. The same
gap exists for the other caution that points at one invoice: "this invoice also carries one-time fees".

## Decisions

1. **The caution names the invoice itself**: its number, what it totals, how much of it is SPP, its status, and a link that
   opens it in a new tab (the dialog stays open, nothing typed is lost).
2. **Same treatment for both cautions that point at one invoice**: the unreadable-label one and the "also carries one-time
   fees" one. Other cautions are unchanged.
3. **The wording of the cautions stays as it is**; the invoice details are added beneath each, so the message the admin
   already saw still reads the same and nothing about what blocks or allows recording changes.
4. **The "SPP di dalamnya" amount is the sum of the invoice's recurring (SPP) lines**, so the admin can compare it with the
   months being recorded without opening anything.

## Acceptance criteria

- [ ] A caution about an invoice whose label names no month shows, under its message: invoice number, label, status,
      total, and the SPP amount inside it, plus an "Buka tagihan" link to that invoice that opens in a new tab.
- [ ] The "also carries one-time fees" caution shows the same details.
- [ ] Cautions without an invoice (none exist today besides these two) render exactly as before.
- [ ] Recording behaviour is unchanged: the same cautions appear for the same data, none becomes blocking, the recorded
      invoices and totals are identical.
- [ ] The link goes to the right invoice and does not navigate the dialog away.

## Verify flows

1. **Admin, desktop:** a student who has a fully paid invoice labelled without a month that includes an SPP line (create
   one through "Tagihan Manual" with a label like "SPMB Tahap 1" and the SPP component, marked already paid) → open
   "Catat SPP di muka" for that student → pick a month range → the "Perlu diperiksa" box lists the invoice number, total,
   SPP amount and status; the link opens the invoice in a new tab; the dialog is still open and the confirm button is
   unchanged.
2. **Edge:** an unpaid invoice with an unreadable label shows its (different) message and the same details.
3. **Error/regression:** a student with only monthly-labelled invoices shows no caution box at all.

## UX notes

- Under each caution message: a muted line "INV-2026-0123 · SPMB Tahap 1 · Lunas · Rp 3.000.000 (SPP di dalamnya
  Rp 1.650.000)" and a "Buka tagihan" text link with an external-link icon, `target="_blank"` and `rel="noopener noreferrer"`.
- Existing Alert, list and link styles only; no new component. Copy follows voice.md (sentence case, "Tagihan").

## Test seams

- Pure planner: the two issues carry the invoice reference (number, label, status, total, SPP amount).
- Loader: the reference's amount sums only recurring lines.
- Dialog component test: details and a new-tab link render; a caution without a reference renders as before.

## Non-goals

- Changing which cases are cautions or blocking, or trying to guess the months of an unreadable label.
- The Billing Run's "already invoiced" logic, the invoice list, or any other screen.
- A way to mark an unreadable invoice as reviewed.

## Assumptions

1. "SPP" means the recurring fee component lines (the planner already uses that definition).
2. Invoice detail pages live at `/admin/invoices/{id}` (the dialog opens from the invoice list there).
3. Amounts are shown in the invoice's own totals (`totalDue`), not the remaining balance.

## Gate re-openers

None: no schema change, no new dependency, no auth or permission change (the preview route and its permission are
untouched; it already returns the issues).

## Tasks

- [x] T1 Planner + loader: `PlanInvoice` gains `invoiceNumber` and `monthlyAmount`; the two invoice-pointing issues carry an
      `invoice` reference — accept: planner and loader unit tests
- [x] T2 Dialog: render the reference under each caution with a new-tab link — accept: dialog component test, then walk it in
      the browser
- [ ] T3 README/docs touch, local gate, PR (deps: T1, T2)

## Implementation

- Plan: driver=claude-sonnet-5-5, workers=sonnet; T1+T2 in one worker (two small slices that share one type, the dialog reads what the
  planner emits), T3 inline (docs, local gate, browser walk, PR). No Opus consult this cycle: no schema, auth or money-flow change.
- T1: lib/finance/spp-prepay-plan.ts, lib/finance/spp-prepay-load.ts + tests — `PlanInvoice` gains `invoiceNumber` and
  `monthlyAmount` (sum of the recurring lines' finalAmount); the two cautions that point at one invoice (unreadable label in both
  variants, "also carries one-time fees") carry a plain-number `invoice` reference. Messages and blocking behaviour unchanged.
- T2: components/admin/invoices/spp-prepay-dialog.tsx + test — under those cautions a muted line "no · label · status · total (SPP di
  dalamnya …)" and a "Buka tagihan" link that opens the invoice in a new tab (dialog stays open). Checked against design-system
  (existing Alert/list/link styles, text-small, 44px touch floor on coarse pointers).
  The link is an `aria-label`led `next/link` with `rel="noopener noreferrer"`; a caution without an invoice reference renders as the
  plain message it was (component-tested), blocking cautions are untouched.
- T2 e2e: e2e/admin-paid-invoice-spp-prepay.spec.ts gains a test that creates a paid invoice labelled without a month (through the API), opens
  "Catat SPP di muka", and asserts the caution names the invoice, shows its total and SPP amount, and that "Buka tagihan" opens it in a
  new tab while the dialog stays open and still confirmable.
- Test robustness (found by the full local suite on a database earlier specs had already used): the SPP prepay spec settles every month
  of one student's year, and the student-leave spec (previous cycle) bills the last month of the year, so on a shared DB the leave
  fixture could land on a student whose invoice for that month already exists (draft row read SKIPPED_ALREADY_INVOICED). The leave spec now
  skips students already invoiced for its month; the new caution test looks only at the caution about its own invoice.

## Verification

**Verified locally — e45e317e** (later commits, if any, are cycle-doc evidence only)

- Diff classified from `origin/staging...HEAD` (0 behind, 6 ahead, 12 files): **other code**. No schema, auth, session, proxy or
  dependency change; the preview route and its permission are untouched. No signed-in staging check required.
- App: production build, demo auth + disposable local Postgres 16 (localhost:54329).
- Full gate on this head: `npm run lint` exit 0 · `npx tsc --noEmit` clean · `verify-rls-coverage.sh` 45/45 · `verify-api-auth.sh`
  224/224 · `audit-docs.sh` 0 fail (1 pre-existing warn) · `npx vitest run` 722 files passed | 2 skipped, **8722 tests passed** ·
  `DEMO_MODE=true npm run build` exit 0 · `npx playwright test` whole suite **263 passed, 0 failed, no retries**, twice: once on a
  freshly recreated database (what CI does) and once more on the same, now dirty, database.
- Playwright note: the installed Chromium is build 1243 and the repo's Playwright asks for 1248, so the repo config was run through a
  wrapper kept outside the repo that only sets `executablePath`; webServer, DB guard and workers are the repo's own.
- Looked at (desktop 1280x900 and mobile 390x844, production build): "Catat SPP di muka" for a student with a paid "SPMB Tahap 1"
  invoice — the caution keeps its original message and shows "INV-2026-2014 · SPMB Tahap 1 · Lunas · Rp 3.000.000 (SPP di dalamnya
  Rp 1.650.000)" with a "Buka tagihan" link; no horizontal overflow; the only console errors are the Vercel analytics script 404 that
  any non-Vercel production build shows. Design-system styles reused (Alert list, text-small, link). Shots: `prepay-caution-desktop.png`,
  `prepay-caution-mobile.png`.
- Verify flows: 1 (paid unreadable-label invoice → details + new-tab link, dialog stays open and confirmable) is covered by the new e2e
  test and the browser walk; 3 (no caution box for a normal student) by the existing prepay e2e test, which still passes. Flow 2 (an
  unpaid invoice with an unreadable label) is covered by the planner unit test only, not walked in a browser.
- The first full run on a used database failed two tests through shared state (see Implementation, "Test robustness"); both specs were
  fixed and the two passes above are the proof.


## Ship Notes

- No migration, env var, config or manual step. Rollback: revert the PR (no data involved; the preview JSON gains an optional `invoice`
  field on two cautions, which older clients ignore).
- Post-merge: Vercel staging deploy READY for the merge SHA. Not auth-impacting, so no signed-in check is required; a quick manual look:
  "Catat SPP di muka" for a student with a paid invoice whose label names no month (for example "SPMB Tahap 1").
- Known limit: for an unpaid invoice with an unreadable label the caution still says it is not counted; the new details only help the
  admin find it.
