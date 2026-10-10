# Pendaftaran fee: pay after submit, with unpaid follow-up

## Context

Schools charge a one-time registration fee (admin, 2026-10-10: **Rp300.000 sekolah, Rp375.000 daycare**, before early-bird / sibling discounts of 20-75%). Today `/pendaftaran/[token]` has no notion of money: the parent submits, sees a thank-you card, and any fee is collected by hand. Intended outcome: the parent fills the whole form, and on submit is asked to complete payment and is redirected to a DOKU checkout link; staff see who has not paid, can nudge them with one tap on WhatsApp, and can settle by hand (cash / transfer / waiver). The fee amount is configurable per program.

The shape of the system forces the design. `Invoice.studentId` is required and a `Student` only exists after staff convert an application, so a fee paid at submit time has no invoice to attach to. Creating a placeholder student or loosening `Invoice` would touch finance code across the app; instead the fee gets its own 1:1 record that reuses the `PaymentGateway` port and the shared webhook processor. Two operational facts from `docs/runbooks/payments-gateway.md` shape the parent journey: no DOKU notification has ever verified in production (every DOKU payment so far was credited by a manual refresh or the daily sweep), and the Vercel Hobby plan allows one cron per day. A public parent has no login and cannot press "Perbarui pembayaran", so the return page itself must ask the gateway for the truth.

Discount rules (early-bird tiers, sibling %) are not yet defined by the school. This cycle ships the money path and a **staff-set discount percentage**; automatic tiers are a follow-up once Bu Ais confirms the table.

## Spec

### 1. Fee configuration (per program, default 0 = no payment step)
- [ ] `Program.enrollmentFee Decimal(15,2) @default(0)` (one additive migration). Zero everywhere on deploy, so behaviour is unchanged until staff set amounts.
- [ ] `/admin/settings/pendaftaran` gains a "Biaya pendaftaran" card: one row per active program with a rupiah input. Saves through the existing `GET/PUT /api/config/enrollment` (extended; `admissions.view` to read, `admissions.edit` to write, tenant-scoped, amounts validated as whole rupiah 0 to 100.000.000).
- [ ] Pure `computeEnrollmentFee({ programFee, dcareProgramFee, dcareAddon, discountPercent })` in `lib/enrollment/fee.ts`, used by both the form (display) and the server (authoritative). The client never sends an amount.
  - Base = chosen program's fee, plus the Day Care program's fee when `dcareAddon` is ticked and the chosen program is not itself Day Care. **Assumption A1, see below.**
  - `amount = base - round(base * discountPercent / 100)`, integers, `discountPercent` 0-100.

### 2. Parent journey
- [ ] **Tinjau step** shows a "Biaya pendaftaran" block when the computed fee is above zero: normal fee, add-on line if any, total, and one sentence that payment happens right after sending. No surprise at the end of a long multi-step form.
- [ ] **Submit** (`POST /api/enrollments/token/[token]/submit`) creates the `EnrollmentFee` row in the same locked transaction with `status UNPAID` (fee > 0) or no row (fee = 0). The 201 body gains `fee: { amount, status } | null`. The DOKU session is **not** created inside that transaction (no network call under a row lock).
- [ ] **Success screen** becomes "Langkah terakhir: bayar biaya pendaftaran" when a fee is due: amount, large **Bayar sekarang** button, a quiet "Bisa dibayar nanti lewat tautan yang sama", then the existing bring-list. With no fee the screen is exactly today's.
- [ ] `POST /api/enrollments/token/[token]/pay` (public, token = credential, rate-limited per IP and per token) creates a DOKU session via `getGateway()` + `withRetry` (reuse of `lib/payments/session.ts` pieces: `resolveAppOrigin`, `resolveSessionExpiry`), stores session id and URL on the fee row, and returns `{ paymentUrl }`. It reuses a still-valid stored URL; creates a fresh one after expiry. `referenceId` is the `EnrollmentFee.id` (a bare cuid, same shape as invoice ids, so no new DOKU `invoice_number` format).
- [ ] **Return page** `/pendaftaran/[token]/pembayaran` (already public under `/pendaftaran/`; success/cancel return URLs point here). On load it polls the gateway for an UNPAID fee (throttled by `lastCheckedAt`, at most one gateway call per 15 s per fee) and renders one of: **Lunas** (receipt card: amount, date, reference), **Menunggu pembayaran** (explains a Virtual Account can take minutes, "Periksa lagi" button, link back to the DOKU page), **Kedaluwarsa / gagal** ("Buat tautan baru"). Never trusts the redirect query alone.
- [ ] **Reopening the form link** after submit becomes payment-aware: UNPAID shows the pay card, PAID shows a "Lunas" line, otherwise today's "Formulir sudah diterima" card.
- [ ] Copy follows `voice.md` (Bapak/Ibu register); no raw gateway error text is rendered.

### 3. Crediting (shared processor, no second implementation)
- [ ] `processPaymentEvent` resolves `referenceId` as an `Invoice` first, then as an `EnrollmentFee`. An `EnrollmentFee` match credits through a new branch that keeps every existing guard: durable `WebhookEvent` receipt + P2002 dedup, advisory lock, IDR-only, missing/zero amount, missing payment id.
- [ ] Stricter than invoices: the paid amount must equal the fee amount (+/- 1 IDR). Otherwise `markError("AMOUNT_MISMATCH")` and the fee stays UNPAID for staff to review.
- [ ] Idempotent: `EnrollmentFee.paymentId @unique`, checked inside the lock. `SESSION_EXPIRED` clears the session fields and leaves UNPAID (the link can be regenerated).
- [ ] `reconcileEnrollmentFee(feeId)` in `lib/payments/reconcile.ts` mirrors `reconcileInvoicePayment` and goes through `processPaymentEvent`. The daily `reconcile-payments` sweep also covers UNPAID fees holding a session.
- [ ] `WebhookEvent.invoiceId` stays null for fee events (the column is a plain string, no FK).

### 4. Staff side (`/admin/enrollments`)
- [ ] **List**: a "Pembayaran" column (Lunas / Belum bayar / Dibebaskan / dash for no fee), a filter "Belum bayar", and a WhatsApp icon in the action column (`whatsappHrefWithText`) opening a prefilled reminder with the form link `/pendaftaran/{token}`. Phone resolution order: `Admission.parentWhatsapp`, `Admission.parentPhone`, Ibu `phone`, Ayah `phone`; no number = disabled icon with tooltip.
- [ ] **Detail**: a "Pembayaran pendaftaran" card (breakdown, status, method, paid date, DOKU reference, link error) with: **Chat WhatsApp** (prefilled), **Salin tautan pembayaran**, **Perbarui pembayaran** (calls `reconcileEnrollmentFee`), **Atur diskon** (percent + reason; UNPAID only; regenerates the pay link at the new amount), **Tandai sudah bayar** (CASH / BANK_TRANSFER + note), **Bebaskan biaya** (waive, with confirm). All mutations need `admissions.edit`, are tenant-scoped, rate-limited and audited (`recordAudit`). If the admission matched an existing parent (`detectedParentId`), the discount control shows a hint "Terdeteksi saudara dari keluarga terdaftar".
- [ ] **Convert** to student stays allowed when UNPAID, but the confirm dialog adds a warning line naming the unpaid amount (not a block, **assumption A3**).
- [ ] **Admin invoice detail** (`/admin/invoices/[id]`, the existing payment detail page) gets the same click-to-WhatsApp follow-up for invoices that are not paid, using the primary guardian's WhatsApp/phone. (Interpretation of "payment detail page in admin", **assumption A5**.)

### 5. Data model
- [ ] New `EnrollmentFee`, 1:1 with `EnrollmentApplication` (`applicationId @unique`, tenant-scoped, FK Restrict, application Cascade): `baseAmount`, `discountPercent Int`, `discountReason`, `amount`, `status` (UNPAID | PAID | WAIVED), `method` (DOKU | CASH | BANK_TRANSFER | WAIVED), `paymentId @unique`, `gatewaySessionId`, `paymentUrl`, `linkError`, `lastCheckedAt`, `paidAt`, `markedBy`, `note`, timestamps. The amount, base fee and discount are **snapshotted at submit**; later changes to the program fee never rewrite a past application.
- [ ] RLS: ENABLE ROW LEVEL SECURITY + policy in the migration so `scripts/verify-rls-coverage.sh` stays green.

### Non-goals
- Automatic early-bird / sibling tiers (follow-up once the school's table is known).
- Posting this revenue into finance reports or invoices (there is no ledger; it lives on the application and is reported from there). Revisit if finance wants it in the revenue totals.
- Refunds, partial payments, instalments.
- Automatic reminders by email/WhatsApp (staff tap the wa.me button).
- Changing `Invoice`, `Payment`, or the parent portal.
- A separate top-level "Pembayaran pendaftaran" page; the payment detail lives on the application page.

### Assumptions I'm making (correct me now)
- **A1. Daycare add-on charges both**: school-program fee plus the Day Care program's fee (Rp675.000 for a school child with the add-on). Rationale: the parent sees the full breakdown on Tinjau before submitting, staff can discount it, and under-charging is easier to fix than a refund. It is one function (`computeEnrollmentFee`) to change.
- **A2. Fees are set per program**, and "sekolah" = every non-Day-Care program (KB, TKIT, ...) set to 300.000, "daycare" = the Day Care program at 375.000. Staff enter the amounts after deploy; nothing is charged until they do.
- **A3. An unpaid application is visible to staff and convertible**, flagged "Belum bayar", with a warning on convert instead of a block.
- **A4. Discount is staff-set per application while UNPAID** (percent 0-100 + reason), snapshotted. A 100% discount marks the fee WAIVED and skips payment.
- **A5. "Payment detail page in admin"** = the new payment card on the application page **and** the existing admin invoice detail, both with wa.me.
- **A6. The pay link is not tied to the 14-day form token.** The fee row stays payable after submit for as long as the form link stays resolvable by token (submitted tokens never expire for reading, see `classifyEnrollmentAccess`).
- **A7. Branch**: this session is told to push to `claude/berkas-pendaftaran-payment-1lys7o`. I work in the `feat/pendaftaran-fee-payment` worktree per CLAUDE.md and push that head to the designated remote branch; the PR targets `staging`.
- **A8. Cycle needs a schema migration** (two additive tables/columns). Approving this Spec covers it. After merge it needs a signed-in staging check (payment crediting + public route), so the PR is labelled `needs-staging-verify`.

## Tasks

Dependencies: T1 first. T2 after T1. T3, T4 after T2 (independent of each other). T5 after T1+T2. T6 after T4+T5. T7 after T5. T8 after T7. T9 independent after T1. T10 last.

- [x] **T1 Schema + migration.** `Program.enrollmentFee`, `EnrollmentFee` model + relation, RLS statements, `prisma generate`. *Done when:* `npx prisma validate`, `bash scripts/verify-rls-coverage.sh` and `npm run build` pass.
- [x] **T2 Fee lib.** `lib/enrollment/fee.ts` (`computeEnrollmentFee`, rupiah formatting reuse) + Vitest incl. rounding, add-on, 0 and 100 percent. *Done when:* tests cover every branch in Spec 1.
- [ ] **T3 Fee settings.** Extend `/api/config/enrollment` + `enrollment-config` validation + settings page card. *Done when:* admin can read and save per-program fees; viewer without edit sees read-only; route + page tests pass.
- [ ] **T4 Submit + Tinjau.** Submit route creates `EnrollmentFee` in the locked tx and returns `fee`; `page.tsx` passes program fees; Tinjau shows the breakdown. *Done when:* route tests cover fee/no-fee/waived and a mismatching client amount is ignored.
- [ ] **T5 Gateway path.** `lib/enrollment/fee-payment.ts` (create/reuse session), `POST .../pay`, processor fee branch, `reconcileEnrollmentFee`, sweep inclusion. Reuse `resolveAppOrigin`, `resolveSessionExpiry`, `withRetry`, `getGateway`. *Done when:* tests cover credit, duplicate event, amount mismatch, expired session, DEMO_MODE session, rate limit.
- [ ] **T6 Parent UI.** Success pay card, reopen-link states, `/pendaftaran/[token]/pembayaran` return page with throttled gateway check. design-system + `better-*` + voice.md loaded. *Done when:* component/page tests cover paid, pending, expired, no-fee states.
- [ ] **T7 Admin API.** Fee actions (discount, mark paid, waive, refresh) with permissions, tenant scope, rate limit, audit; list API adds fee status + resolved phone; `?payment=unpaid` filter. *Done when:* route tests cover 401/403/cross-tenant/validation/idempotency.
- [ ] **T8 Admin UI.** List column + filter + wa.me action; detail payment card; convert warning. *Done when:* page tests cover each action and the disabled wa.me with no number.
- [ ] **T9 Admin invoice wa.me.** Follow-up button on unpaid admin invoice detail via primary guardian phone. *Done when:* test covers visible/hidden/no-number.
- [ ] **T10 E2E + docs.** Playwright: configure fee, parent submits, sees pay card (DEMO_MODE synthetic link), admin sees "Belum bayar" and wa.me href. README module line, `docs/runbooks/payments-gateway.md` section (enrollment fee path, reconcile), `bash scripts/audit-docs.sh --write`. *Done when:* end-of-cycle gate green and `audit-docs.sh` exits 0.

## Implementation

- Subagent plan: driver=claude-sonnet-5-5 (already the dirty-work tier, so there is no cheaper tier to hand slices to), dirty-work=none; tasks [1-10] sequential and run inline because T2-T9 share the `EnrollmentFee` shape, the gateway reference convention and the Indonesian copy, so a subagent would need the whole plan as context. Every task diff goes to a general-purpose reviewer subagent (the named `feature-dev:code-reviewer` agent type is not installed in this harness) before its commit.
- Task 2: Fee lib — `lib/enrollment/fee.ts`, `lib/enrollment/fee.test.ts` — pure `computeEnrollmentFee` (program fee + Day Care add-on, percent discount, whole rupiah, `discountAmount + amount === base` by subtraction), `applyDiscount`, `initialFeeStatus`; 16 tests. Reviewer: no issues.
- Task 1: Schema + migration — `prisma/schema.prisma`, `prisma/migrations/20261010000000_add_enrollment_fee/migration.sql` — `Program.enrollmentFee` (default 0) and the 1:1 `EnrollmentFee` model with tenant Restrict / application Cascade FKs, unique `applicationId` and `paymentId`, service-role RLS policy.

## Verification

- Task 2: gates passed (build + vitest run, 575 files / 5790 tests on the final run). The first full run, executed while a build and a reviewer subagent were using the CPU, failed once in the untouched `components/ui/__tests__/rupiah-input.test.tsx` ("keeps the caret in place when a digit is typed mid-number", `expected 3 to be 2`). It did not reproduce: 3/3 alone, 6/6 under `scripts/flake-hunt.sh` with 12 CPU hogs, and the full suite re-run clean. Not root-caused; if it recurs in CI it is a pre-existing caret-timing flake in RupiahInput, not this cycle's.
- Task 1: gates passed. `npx prisma validate` ok, `verify-rls-coverage.sh` 43/43, `npx tsc --noEmit` clean, `npm run build` (CI env: `DEMO_MODE`, dummy `DATABASE_URL`) ok, `npx vitest run` 574 files / 5774 tests passed.

## Ship Notes
