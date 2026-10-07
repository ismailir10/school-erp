# Finance + payroll money guards — Rupiah input, invoice status bypass, billing-run zero/duplicate rows, payroll bounds

## Context
The 2026-10-07 finance/HR persona UAT (SUPER_ADMIN at 1440×900 with SCHOOL_ADMIN / teacher / parent boundary checks, disposable local Postgres) confirmed the payment core is solid — two-step record payment, overpay rejection, concurrent payments, reversal, KPIs reconciling to the database, payroll gross − deductions = net with zero drift. It also found places where a normal admin action silently produces wrong money:

- **FINX-1 (major)** `RupiahInput` strips every non-digit, so the common Indonesian way of typing a decimal, `1.500.000,50`, becomes **Rp 150.000.050**; `1500000.5` becomes 15.000.005 and `-5` becomes 5. The component is used for manual invoices, tariffs, keringanan and salaries. The billing-run line editor uses a raw `type=number` that rejects `1.500.000` and (in Chrome) drops a typed comma.
- **FINX-3 (major)** `PUT /api/invoices/[id]` accepts any status: a PARTIALLY_PAID invoice can be set to CANCELLED, PAID (with Rp 299.000 still owed — the list then shows "Lunas" and the KPI counts it) or DRAFT, also by SCHOOL_ADMIN. No UI calls it with anything but SENT.
- **FINX-4 (major)** A billing run commits Rp 0 invoices (keringanan ≥ SPP, or a line edited to 0) that get stuck as PENDING_PAYMENT_LINK / "Link Gagal" with a recovery work item no one can clear except by cancelling.
- **FINX-5 (major)** A billing run bills a student whose status is WITHDRAWN when an enrollment row is still ACTIVE (the materialiser filters on enrollment only; the keringanan picker already hides such students).
- **FINX-6 (major)** The "already invoiced this period" guard compares the free-text period label exactly, so a run for `oktober 2026` or `Okt 2026` after `Oktober 2026` would double-bill every student.
- **FINX-2 (major)** Billing-run line edits and payroll adjustments above the column range return a 500 with a generic toast.
- **HRX-3 / HRX-4 / HRX-5 (major)** Payroll "Hari Kerja Aktual" accepts 0 or 999 and changes nothing in the items; line adjustments are unbounded (a line can go negative or fractional, which the BSI integer export does not expect); a run can be approved while its period is still running, which locks attendance and shows teachers their slip mid-period.
- Minors: HR-8 (payroll item sheet has no padding), HR-11 (no UI to cancel a draft payroll run although the API exists), HR-19 (raw English / "Gagal" strings in payroll), billing-run wizard footer not pinned, default due date ignores the period.

The user asked for an uninterrupted multi-hour UAT-and-fix session ("work 5 hours straight, dont stop"), which is the authorization for running this cycle without stopping at the Spec gate.

## Spec
- [ ] FINX-1: `RupiahInput` treats `,` as the decimal separator and `.` as the thousands separator (id-ID): everything after a comma is dropped (rupiah are whole); a trailing `.` + 1–2 digits (`1500000.5`) is read as a decimal and dropped, never multiplied; a minus sign is ignored as before but never silently changes magnitude. Unit tests cover `1.500.000,50` → 1.500.000, `1500000.5` → 1.500.000, `1.500.000` → 1.500.000, paste and caret behaviour. The billing-run line editor uses `RupiahInput`.
- [ ] FINX-3: `PUT /api/invoices/[id]` only performs DRAFT → SENT; any other requested status is a 409 with an Indonesian message pointing to the proper action (Catat Pembayaran / Batalkan tagihan).
- [ ] FINX-4: billing-run rows whose total is Rp 0 are not turned into invoices; the wizard shows them as "Rp 0 — tidak ditagih" and the commit summary counts them. FINX-5: only students with `status = ACTIVE` are billed. FINX-6: the duplicate guard compares a normalised period (case, whitespace, Indonesian month abbreviations) so `Okt 2026` / `oktober 2026` are recognised as `Oktober 2026`. FINX-2: line amounts are bounded (integer, ≤ the fee-structure maximum) with an inline message. The wizard footer is pinned; the default due date follows the typed period's month when it can be parsed.
- [ ] HRX-3: actual work days must be 1..days in the period. HRX-4: a line adjustment is an integer within ±Rp 1.000.000.000 and may not make the line negative. HRX-5: approve is refused while the period has not ended (Asia/Jakarta), with a clear message. FINX-2 (payroll): out-of-range values are a 400 with a field message, never a 500.
- [ ] HR-8: the payroll item sheet has standard body padding. HR-11: a draft payroll run has "Batalkan draf" (confirm dialog) wired to the existing cancel API. HR-19: payroll toasts and labels are Indonesian (no bare "Gagal", "Edit", "Draft").

### Non-goals
- No schema migration, no new dependency. No change to `lib/validations/invoice.ts` / `employee.ts` / `text.ts` (the api-integrity cycle owns them); payment date and admin kuitansi (FINX-9) wait for a follow-up cycle.
- No recalculation engine change for "Hari Kerja Aktual" beyond bounding it (whether the field should re-prorate is a product call — noted in Ship Notes).

### Assumptions
1. Whole rupiah everywhere (the codebase rounds to 0 dp in billing and payroll).
2. A Rp 0 billing row is "nothing to bill", not "paid"; it stays visible in the run so the admin sees why the student was skipped.
3. Period normalisation maps `jan/januari, feb/februari, mar/maret, apr/april, mei, jun/juni, jul/juli, agu/agt/agustus, sep/sept/september, okt/oktober, nov/november, des/desember`.

## Tasks
- [ ] **T1 — Rupiah input.** `components/ui/rupiah-input.tsx`, `components/admin/invoices/billing-run-wizard/line-editor.tsx` (+ tests). FINX-1. Independent.
- [ ] **T2 — Invoice PUT guard.** `app/api/invoices/[id]/route.ts` (+ tests). FINX-3. Independent.
- [ ] **T3 — Billing run.** `lib/finance/build-billing-run.ts`, `lib/finance/materialize-billing-run.ts`, billing-run routes under `app/api/billing-runs/[id]/**`, `components/admin/invoices/billing-run-wizard/**` except `line-editor.tsx` (+ tests). FINX-4/5/6, FINX-2 (lines), wizard footer + due date. Independent of T1 except the line editor (T1 owns it).
- [ ] **T4 — Payroll.** `lib/validations/payroll.ts`, `app/api/payroll/**`, `app/admin/(hr)/payroll/**` (+ tests). HRX-3/4/5, FINX-2 (payroll), HR-8, HR-11, HR-19 (payroll). Independent.
- [ ] **T5 — End-of-cycle gate, verification, Ship Notes.** Depends on T1–T4.

## Implementation

## Verification

## Ship Notes
