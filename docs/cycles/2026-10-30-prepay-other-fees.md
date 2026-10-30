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
- T4: `components/admin/invoices/spp-prepay-dialog.tsx` (+ test, 30 cases), `app/admin/invoices/invoices-client.tsx`
  (menu label) and its test. Title "Catat Pembayaran di Muka". SPP is a radio pair ("Catat SPP beberapa bulan" with
  Dari/Sampai, or "Tanpa SPP"); when SPP is unavailable the range option is disabled, Tanpa SPP is selected and the
  server's reason shows (with an "Atur kelasnya di halaman Siswa" link for no program). "Biaya lainnya" lines reuse
  the Tagihan Manual line editor (component select without already-used components, prefilled editable
  `RupiahInput`, remove), "Tambah biaya", and a Periode field once a line exists. Picking a student runs a no-parts
  preview and then one with the defaults; later edits re-preview after 350 ms; the confirm body carries exactly the
  parts the shown preview was computed for, so a stale preview disables the button rather than sending other data.
  The one-time invoice is one preview row ("Buat & lunasi"); the `UNPAID_SAME_COMPONENT` caution reuses the
  invoice-reference block (its "SPP di dalamnya" part only when > 0). The button "Catat Rp X lunas" uses the grand
  total; a plain line explains a disabled button. Two `invoices-client` tests still expecting the T3 checkbox now
  assert it is absent. Built from existing components following design-system.html.
- T5: `e2e/admin-paid-invoice-spp-prepay.spec.ts` rewritten (3 tests: Tagihan Manual has no "Sudah dibayar" and the
  API refuses `payment`; one-time only with Tanpa SPP; SPP months + a prefilled one-time fee together, then a second
  preview shows the months "Sudah lunas"). The old "Perlu diperiksa" e2e case is dropped: its fixture was built with
  the retired paid mode, and the 2026-10-29 unit and component tests still cover it. `docs/uat/jobs/admin.md`
  JTBD-ADMIN-INV-10/11 and FEE-03 rewritten; README rows; counts block.
- Fixes from the verify-local walk (dialog + test): a Periode that reads as one month is caught in the browser and
  the message lands on the field, with no preview sent (before, the admin saw only a generic "Validasi gagal" alert);
  any preview 400 with field errors is put on those fields with a neutral "Periksa isian yang ditandai." line; the
  Dari/Sampai selects are hidden while Tanpa SPP is chosen (they showed a confusing disabled "Pilih siswa dulu");
  rupiah amounts and the Tindakan cell no longer wrap mid-value. The e2e spec now waits for the default-range
  preview before narrowing the months (it opened "Dari bulan" before the first preview landed).

## Verification

- App: `DEMO_MODE=true` production build, demo auth (`u_school_admin`), disposable Postgres 16 on port 54329,
  freshly seeded. design-system: the dialog reuses the existing Dialog, RadioGroup, Select, RupiahInput, DatePicker,
  Alert and table components and the Tagihan Manual line-editor look; copy follows voice.md.
- Full gate (on `42cbf52e`, the last product commit before the walk fixes): `npx tsc --noEmit` clean; `npm run lint`
  exit 0; `npx vitest run` 734 files passed / 2 skipped, 9033 tests passed; `verify-rls-coverage` 46/46;
  `verify-api-auth` 225/225; `audit-docs.sh` 13 ok / 1 warn (existing ADR 60-day warning) / 0 fail; `DEMO_MODE`
  build exit 0. After the walk fixes: tsc, eslint and `vitest run components/admin/invoices app/admin/invoices`
  (14 files, 257 tests) green, `DEMO_MODE` build exit 0.
- Playwright (container Chromium via a git-excluded wrapper config; the installed Playwright expects a newer browser
  build than the container ships), production build, freshly seeded DB: the whole suite **269 passed in 8.2 min**,
  including the rewritten spec (3 passed). After the walk fixes and a rebuild: the prepay spec plus
  `admin-manual-invoice-layout.spec.ts`, 9 passed.
- Verify flows walked in the browser (1440x900 and 390x844), facts read back from the database:
  1. Tahap 1 cash, student with no class: SPP option disabled with the reason and a link to Siswa, Tanpa SPP
     selected; Daftar Ulang Rp 5.000.000 + Seragam Rp 1.500.000 (typed — no program, no prefill), label "Biaya Sekolah
     Tahap 1 TA 2027/2028", Tunai, three days ago → one invoice PAID, total 6.500.000, `sentAt` set, no payment link
     or link error, two lines; one CASH payment dated that day, reference "Pembayaran di muka", note = the label;
     audit rows for the invoice (`part: other-fees`) and the payment.
  2. SPP + seragam, student with a program: default range Juli 2026–Juni 2027 prefilled; Seragam prefilled at
     650.000 from the fee table, lowered to 300.000; Mei–Juni 2027 → preview 850.000 + 850.000 + 300.000 = 2.000.000;
     three invoices PAID, no links; SPP payments referenced "SPP di muka TA 2026/2027", the one-time one "Pembayaran
     di muka". A second preview shows both months "Sudah lunas" (e2e).
  3. Already billed: a normal Tagihan Manual Seragam invoice (Terkirim, with a link) → adding Seragam in the dialog
     shows the caution with the invoice number, label, status, total and a "Buka tagihan" link that opens it in a new
     tab; confirm stays enabled.
  4. Month label: "Januari 2027" → the field message appears at once and no preview is sent (after the fix). Tagihan
     Manual has no "Sudah dibayar"; saving creates a billed invoice with a link.
  5. Neither part: Tanpa SPP with no lines → "Catat lunas" disabled with "Pilih bulan SPP atau tambahkan biaya
     lainnya."
  No horizontal scroll at 390; no console errors besides the absent Vercel analytics scripts.
- Not walked: the Billing Run skipping prepaid months (unchanged code path; the month invoices are created exactly as
  before) and the parent portal view of a one-time paid invoice (same invoice shape as the SPP months).

## Ship Notes

- Migrations: none (no schema change, no RLS change). Env vars: none. Manual steps: none.
- Not auth-impacting: the routes keep their `invoices.create` + `payments.record` checks; no session, role or tenant
  logic changed. No `needs-staging-verify`. Touches a user flow, so the PR carries `e2e`.
- Rollback: revert the squash-merge commit on `staging`. Invoices and payments recorded with the feature stay valid
  and are reversed or cancelled through the normal screens. A revert brings "Sudah dibayar" back.
- For the school: money already received (SPP months, uang pangkal, seragam, tahap 1…) is now recorded only through
  "Catat pembayaran di muka". Tagihan Manual always bills the wali. A one-time fee for a student who already has an
  unpaid invoice for it should be recorded with "Catat Pembayaran" on that invoice; the dialog warns about this.
