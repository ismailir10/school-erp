# Catat pembayaran di muka: other school fees, and "Sudah dibayar" retires

## Context

An admin asked (2026-10-30): *"gimana kalau misalkan yang dibagian "catat spp dimuka" itu, komponen biayanya diperluas
kak jadi ga cmn spp aja, tapi bisa biaya sekolah lainnya juga. nnti klo misalkan sdh diperluas, yang sudah dibayar ini
bisa dihilangkan?"* In short: let the advance-payment dialog record other school fees too, and once it does, drop the
"Sudah dibayar" option from Tagihan Manual.

What happens today (both shipped in [2026-10-27-paid-invoice-spp-prepay](2026-10-27-paid-invoice-spp-prepay.md)):

- **Catat SPP di muka** records SPP months a family has already paid. It creates or settles one invoice per month,
  already Lunas, with no payment link and no email. It only handles *recurring* fee components. In production SPP is
  the only recurring component (that cycle's D6), so it is SPP only.
- **Tagihan Manual → Sudah dibayar** records one-time fees already received in cash (uang pangkal, sarana, seragam,
  "biaya sekolah tahap 1") as an invoice that is Lunas when it is created, again with no link and no email.

So the school has two places to record money it already holds, split by fee type. The admin looks for "money already
paid" in the advance-payment dialog and does not find the one-time fees there. Tagihan Manual mixes two jobs: billing the
wali and recording cash.

## Decisions

- **D1. The dialog records one-time fees too.** Besides the SPP month range it takes one-time fee lines (component +
  amount). They become **one** invoice that is Lunas when it is created, with no payment link and no email, saved in
  the same all-or-nothing step as the SPP months. *User's choice. In production "other fees" means the one-time ones.*
- **D2. "Sudah dibayar" leaves Tagihan Manual, and the paid mode leaves the invoice-create API.** Tagihan Manual always
  bills the wali (link + email). "Catat pembayaran di muka" is the one place to record money already received. The rate
  limit, audit and validation that `POST /api/invoices` gained last cycle stay. *User's choice: one place for one job, no
  dead code. Invoices already created that way stay valid.*
- **D3. One-time amounts are prefilled from the student's program fee table and are always editable.** A partial "tahap 1"
  works, and so does a new-intake student with no program (they type the amount). *User's choice.*
- **D4. Renamed "Catat pembayaran di muka"**, both the button and the dialog title. The SPP section inside keeps its
  wording. *User's choice.*
- **D5. Either part may be empty, but not both.** "Tanpa SPP" is a valid choice, so a student with no program, or a
  payment for next year's fees, can record only one-time fees. The "cannot be priced" error now blocks only the SPP part.
  *Follows from D1 and D3: today a student with no program cannot open a usable preview, and those 24 new-intake
  students are exactly the "tahap 1" payers.*
- **D6. The one-time invoice needs a descriptive label** (Periode), e.g. "Biaya Sekolah Tahap 1 TA 2027/2028". A label
  that names a single month is refused: the Billing Run's duplicate check is by label, so a month label would hide that
  month's SPP (the open follow-up from 2026-10-27). *A refusal rather than a hint, because nothing pays a new invoice
  except this flow.*
- **D7. A caution, not a block, when the student already has an unpaid invoice carrying a chosen one-time component.**
  It names the invoice (reusing last cycle's invoice-reference block with a "Buka tagihan" link) and says to use "Catat
  Pembayaran" on that invoice instead. *Without it the admin could record the same uang pangkal twice. It is not a
  block because a second instalment of the same component is legitimate.*
- **D8. Permissions unchanged:** `invoices.create` + `payments.record`, the same as today.

## Acceptance criteria

- [ ] On Tagihan the admin sees **Catat pembayaran di muka** where "Catat SPP di muka" was. The dialog has the same title.
- [ ] The dialog has an SPP part (month range, as today, or "Tanpa SPP") and a one-time fees part: add a line, pick an
      enabled one-time component, amount prefilled from the student's program fee table for the year (empty if none),
      editable, removable. The one-time part takes a Periode label.
- [ ] The preview lists the SPP months (unchanged behavior) and, when there are one-time lines, one row for the new
      invoice with its label and total. The grand total sums both.
- [ ] Confirming writes everything in one step: the SPP months as today, plus one new invoice for the one-time lines,
      Lunas, sent-stamped, with no payment link and nothing sent to the wali, and one payment equal to its total with the
      chosen method, date and reference.
- [ ] A student with no program can record one-time fees with "Tanpa SPP". The SPP part shows the existing "belum punya
      program" message and cannot be selected.
- [ ] Neither part filled → confirm disabled with a plain message. A one-time line with a zero or empty amount, or a
      missing label, or a label that names one month → refused with a message on that field.
- [ ] An unpaid invoice of this student that carries a chosen one-time component shows a non-blocking caution with the
      invoice's number, total, status and "Buka tagihan" link.
- [ ] Confirming twice (double click or retry) writes nothing the second time. Drift between preview and confirm still
      refuses with "muat ulang pratinjau".
- [ ] Tagihan Manual no longer shows "Sudah dibayar". Saving always creates a billed invoice as before. `POST
      /api/invoices` with a `payment` object is refused (400), and nothing is written.
- [ ] Invoices created earlier with "Sudah dibayar" still display and reverse as before.
- [ ] Audit entries exist for the new invoice and its payment.

## Verify flows

1. **Tahap 1 cash, new-intake student.** Admin → Tagihan → Catat pembayaran di muka. Pick an active student with no
   class. The SPP part says "belum punya program". Choose Tanpa SPP, add Uang Pangkal Rp 5.000.000 + Sarana Rp
   1.500.000, label "Biaya Sekolah Tahap 1 TA 2027/2028", Tunai, a date three days ago. Preview → one row, total Rp
   6.500.000 → confirm. Expect: one invoice Lunas, one Tunai payment dated three days ago, no link, parent portal Lunas.
2. **SPP + seragam together.** A student with a program: range Januari to Juni + Seragam (prefilled from the fee table,
   lowered to a partial amount). Preview shows six months + one row. Confirm: seven invoices Lunas, one shared reference.
   Then run Billing Run for Januari: this student is skipped.
3. **Edge — already billed.** A student with an unpaid "Uang Pangkal" invoice: add Uang Pangkal → the caution names that
   invoice and its link opens it in a new tab. Confirm stays enabled.
4. **Error — month label.** Label "Januari 2027" → refused on the Periode field. Then Tagihan Manual: no "Sudah dibayar"
   checkbox, and saving creates a Terkirim invoice.

Data: local seeded demo tenant (a student with a program, one without, one with an unpaid one-time invoice).

## UX notes

- Primary action: "Catat Rp X lunas" (unchanged). Step 1 order: Siswa → SPP (Dari / Sampai, or Tanpa SPP) → Biaya
  lainnya (lines, "Tambah biaya", Periode) → Metode / Tanggal bayar / Referensi / Catatan.
- The one-time lines reuse the Tagihan Manual line editor pattern (component select + amount). Prefilled amounts are
  shown as ordinary values, not placeholders.
- Description line: "Catat pembayaran yang sudah diterima: SPP beberapa bulan dan biaya sekolah lainnya. Tagihan
  langsung Lunas, tanpa link pembayaran dan tanpa email."
- Tagihan Manual's helper text loses its paid-mode wording. Copy follows voice.md. Built with existing components only,
  following design-system.html.

## Test seams

- Pure planner/validation: either part empty, both empty, label naming a month, zero amount, caution for an unpaid
  invoice with the same component.
- Loader: one-time prefill from the program fee table (non-recurring, enabled), none for a student with no program.
- API (`spp-prepay` preview + confirm): one-time invoice created paid in the same transaction, no gateway call, replay
  writes nothing, drift 409, SPP-only and one-time-only paths, permissions, tenant scope.
- API (`POST /api/invoices`): `payment` refused, normal create unchanged.
- Component: dialog (one-time lines, Tanpa SPP, caution, rename), Tagihan Manual (checkbox gone).
- E2E: `admin-paid-invoice-spp-prepay.spec.ts` rewritten. The paid-at-creation case moves into the new dialog.

## Non-goals

- Settling an existing unpaid one-time invoice from this dialog (that stays "Catat Pembayaran" on the invoice; D7 points
  there).
- Recurring components other than SPP (none exist; the SPP part already handles any recurring component).
- The Billing Run's label-only duplicate check, and the October SPP it may have hidden.
- Renaming the API route or the internal names (`spp-prepay`). Only user-facing copy changes.
- Admissions fees, refunds, re-pricing existing invoices.

## Assumptions

1. "Yang sudah dibayar ini" means the "Sudah dibayar" checkbox in Tagihan Manual (the only element with that label on
   the admin side).
2. The prefill uses the program fee table of the academic year the dialog already resolves (the current one). For next
   year's fees (TA 2027/2028), the admin types the amounts, because that year's table does not exist yet.
3. One reference/note covers the whole confirm. The one-time payment's default reference is "Pembayaran di muka", and
   the SPP payments keep "SPP di muka TA …".
4. The one-time invoice's due date is the paid date.

## Gate re-openers

None. No schema change, no new dependency, no new personal data, no production write. Touches money and permission
checks on `app/api/**` (a sensitive path), so the security standard applies. It is not auth-impacting, so it gets no
`needs-staging-verify`. It touches a user flow, so the PR gets the `e2e` label.

## Tasks

- [ ] T1 Planner, loader, validation for one-time lines — accept: unit tests for both-parts rules, month-label refusal,
      prefill, unpaid-same-component caution, SPP-blocked-but-one-time-ok (deps: none, reuse: `spp-prepay-plan`,
      `parsePeriodMonth`, `IssueInvoice` reference shape)
- [ ] T2 Confirm route: one paid invoice for the one-time lines in the same transaction — accept: API tests for create +
      pay, replay, drift, one-time-only, SPP-only, no gateway call (deps: T1, reuse: `recordPaymentInTx` with
      `clear-link`, the existing lock order)
- [ ] T3 Retire "Sudah dibayar": manual dialog checkbox, `POST /api/invoices` payment mode, their validation and tests —
      accept: normal create tests green, `payment` → 400 (deps: none; **parallel with T1–T2**, disjoint files)
- [ ] T4 Dialog: rename, Tanpa SPP, one-time lines, preview row, caution, invoices-client button label — accept:
      component tests (deps: T2, T3 for `invoices-client.tsx`)
- [ ] T5 E2E rewrite, README rows, `docs/uat/jobs/admin.md` JTBD-ADMIN-INV-10/11, counts block — accept: `audit-docs.sh`
      passes, spec green locally (deps: T4)

## Implementation

- Plan: driver=claude-opus-5-5 (spec, task specs, diff review, sign-off), workers=claude-sonnet-5-5 (T1–T4 code,
  T5 e2e) and claude-haiku-4-5 (code sweeps, T5 docs). T1+T2 (one worker, prepay backend) parallel with T3 (disjoint
  files); T4 after both; T5 last.
- Branch note: this cloud session is assigned `claude/exciting-dijkstra-48q4x5`, not `feat/*`, and works in the main
  checkout of an isolated container. Local DB: throwaway Postgres 16 cluster on port 54329 (no Docker daemon here).
- T3: "Sudah dibayar" retired. `manual-invoice-dialog.tsx` loses the checkbox, payment fields, idempotency key,
  paid-mode labels/errors and the `canRecordPayment` prop (`invoices-client.tsx` stops passing it). `POST
  /api/invoices` loses the paid mode (permission check, request hash, advisory lock + replay, paid `sentAt`,
  `recordPaymentInTx`); it keeps the rate limit, `validateBody`, audit and P2002 retry. `createManualInvoiceSchema`
  declares `payment` as `never`, so a stale client gets a 400 naming the field ("Gunakan Catat pembayaran di muka")
  and nothing is written, while other extra keys are still ignored as before. `invoices-create-paid.test.ts` is
  deleted; the manual-create route, validation and dialog tests cover the refusal and the unchanged billed create.
- T1+T2: prepay backend (`lib/finance/spp-prepay-{plan,load}.ts`, `lib/validations/spp-prepay.ts`, both
  `spp-prepay` routes + tests). The SPP part is chosen by sending both `from` and `to`; neither means "Tanpa SPP"
  (one alone is a 400). A preview with neither part is allowed (it returns `oneTimeComponents` with `prefillAmount`
  and `spp.{available, reason, defaultRange}`); a confirm needs at least one part. No academic year or no program no
  longer fails the request: it only makes SPP unavailable (`NO_ACADEMIC_YEAR` / `NO_PROGRAM` block only when SPP is
  chosen). `otherFees` = label (trimmed, ≤ 64, refused when it reads as one month) + 1–20 lines (enabled, ACTIVE,
  non-recurring tenant components, else `INVALID_COMPONENT`; duplicates refused like Tagihan Manual). Prefill sums
  the student's programs' ACTIVE fee rows for the year (as the Billing Run bills each program), null without a
  program. Caution `UNPAID_SAME_COMPONENT` (non-blocking, with the invoice reference block) per unpaid invoice carrying
  a chosen component. Confirm: the one-time invoice is created after the SPP months in the same transaction and lock
  order (SENT, `sentAt`, due on the paid date, adjustment 0), paid via `recordPaymentInTx` `clear-link` with key
  `<key>:other`, reference = admin's or "Pembayaran di muka", note = label (+ admin note), audit `part: other-fees`.
  The fingerprint and request hash include the one-time payload; replay detection (`<key>:` prefix) covers it.
  `NOTHING_TO_RECORD` fires only when nothing at all would be written.

## Verification

## Ship Notes
