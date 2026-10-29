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

## Verification

## Ship Notes
