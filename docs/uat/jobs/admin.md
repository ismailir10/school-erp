# Admin Portal — Jobs to be Done

> Last audited: 2026-10-17 in cycle `payment-link-reminders` (new JTBD-ADMIN-INV-07: Pengingat WhatsApp queue on the invoice list; JTBD-ADMIN-INV-02 steps 4 and 8: Chat WhatsApp records the reminder and the detail shows "Terakhir diingatkan", and Buat link baru replaces one invoice's link; JTBD-ADMIN-INV-03: a partial payment on a past-due invoice reads Lewat Tempo, and the link is remade for what is still owed). Prior: 2026-10-17 in cycles `expired-link-overdue` and `payment-link-on-demand` (JTBD-ADMIN-INV-02 step 7: Buat link baru (N) in the invoice list header makes a fresh payment link for every unpaid invoice that has none, 25 at a time; JTBD-ADMIN-INV-02: Cek semua belum lunas in the invoice list header checks the next 50 unpaid invoices at the gateway; an expired link on an unpaid invoice clears the dead link and a past-due one reads Lewat Tempo; a DOKU payment shows its channel, e.g. Virtual Account BCA). Prior: 2026-10-15 in cycle `pendaftaran-pay-after-form` (the pendaftaran fee is paid after the parent submits the formulir, not before: Kirim Formulir is one tap with no Program / Day Care or fee, the result card has no fee block, the "Menunggu pembayaran" count is gone, staff settle the fee from the formulir after submit; the parent form's kode pos address lookup, with three new address boxes in Ubah data; JTBD-ADMIN-ADM-01, -04, -05 and -06 updated). Prior: 2026-10-11 in cycle `pendaftaran-simplify` (one Pendaftaran list with a derived Tahap and Pembayaran per row, replacing the separate Formulir list; pay-first formulir fee; walk-ins need no email; staff edit and submit a formulir on the parent's behalf; one *Terima & Jadikan Siswa* convert with duplicate and wali confirmation; JTBD-ADMIN-ADM-01 to -04 rewritten, new JTBD-ADMIN-ADM-05 and -06; HOME-01 precondition updated). Prior: 2026-10-10 in cycle `pendaftaran-fee-payment` (Pengaturan → Pengaturan Pendaftaran now also holds the per-program pendaftaran fee, JTBD-ADMIN-ADM-03 step 1; new JTBD-ADMIN-ADM-04: payment column, filter, WhatsApp reminder and the Pembayaran pendaftaran card on `/admin/enrollments`; JTBD-ADMIN-INV-02 step 4: Chat WhatsApp reminder on the invoice detail). Prior: 2026-10-06 in cycle `enrollment-docs-followups` (new JTBD-ADMIN-ADM-03: required-berkas setting, KK/KTP copied to guardians on convert, documents on the student page). Prior: 2026-10-06 in cycle `enrollment-signature-handover-and-checklist` (new JTBD-ADMIN-ADM-02: Kelengkapan Berkas card on `/admin/enrollments/[id]`, staff can open parent-uploaded files and tick papers received physically). Prior: 2026-09-29 in cycles `finance-safety` (payment review step, reversal of manual payments, cancel overdue invoices, Rupiah KPIs on `/admin/invoices`) and `journal-ux` (new admission inquiries — status Pertanyaan, last 14 days — join the Dasbor tiles and `/admin/work-queue?kind=inquiry`). Prior: 2026-09-26 in cycle `admin-dmmt-overhaul` (sidebar cut to daily work + `/admin/settings` hub; one-screen Dasbor replaces the full home queue, with the full list moved to `/admin/work-queue?kind=`; `/admin/penilaian` → `/admin/assessments` and `/admin/raport` → `/admin/report-cards`; job steps updated accordingly — engineering review, representative-user UAT remains pending).

> Prior reviews: 2026-09-25 in cycle `role-redesign-completion` (engineering review and acceptance-job updates; representative-user UAT remains pending). Prior: 2026-09-25 in cycle `intuitive-ui-foundation` (manual invoice scroll/keyboard/reflow acceptance added to JTBD-ADMIN-INV-01; engineering regression verification). Prior: 2026-09-24 in cycle `guardian-primary-fix` (guardian card gained a one-click **Jadikan wali utama** action, confirm-gated, replacing the buried Edit Wali switch as the only way to promote; new JTBD-ADMIN-GUARD-04). Prior: 2026-08-21 in cycle `siswa-wali-linking` (one Parent record is shared across siblings — Tambah Wali opens on a search and links an existing wali, retyping an existing one raises an overridable duplicate warning; siswa ↔ wali navigation is bidirectional and a Saudara row lists siblings; wali bio saves through the parent route so an unlinked wali is editable; new JTBD-ADMIN-GUARD-02 and -03, GUARD-01 updated). Prior: 2026-08-18 in cycle `admin-ui-copy-consistency` (admissions conversion action is gated to `ADMITTED` applicants, with actionable Indonesian fallback errors; JTBD-ADMIN-ADM-01 updated). Prior: 2026-08-14 in cycle `billing-run-wizard-b2` (step 2 of the Billing Run wizard is now editable — per-line amount edits, ad-hoc potongan, extra catalog components, line removal; step 3 gained "Hitung Ulang" and the resume banner gained a discard; JTBD-ADMIN-INV-05 updated). Prior: 2026-08-14 in cycle `billing-run-wizard` (bulk generate is now a three-step Billing Run wizard on a persisted draft — scope by class/student, review rows with keringanan applied, commit; the three-field dialog is retired; new JTBD-ADMIN-INV-05). Prior: 2026-08-13 in cycle `keringanan-fee-adjustments` (Keringanan tab on `/admin/fees` — durable per-student fee adjustments applied automatically by bulk generation; new JTBD-ADMIN-INV-04). Prior: 2026-08-05 in cycle `admin-ui-audit-fixes` (interface-audit remediation across Kesiswaan/Akademik/Penilaian/Kelas Harian: form controls given accessible names, raport editor unsaved-changes guard, glossary + label corrections; `/admin/penilaian` H1 is now "Pemantauan"). Prior: 2026-07-29 in cycle `class-picker-year-scoping` (enroll/promote pickers year-scoped to ACTIVE/PLANNING, searchable, grouped by kampus; archived-year targets rejected server-side; class names campus-free). Prior: 2026-06-23 in cycle `ui-shadcn-audit` (Penerimaan payments-received ledger on /admin/payments — date-range, search, method filter, pagination, invoice view action, per-method summary, CSV export)
> Portal root: `app/admin/`
> Default persona: Ibu Nur (SUPER_ADMIN) — see `.claude/personas/ibu-nur.md`

This file is the living catalog of what an admin user can and should be able to do in this system. `/uat admin` reads it, picks jobs scoped to the requested area, and role-plays each one via Playwright MCP. When a cycle adds, removes, or materially changes an admin-facing capability, edit this file as part of that cycle and bump the "Last audited" date.

**Note on roles:** This cycle ships with 3 personas (Pak Budi, Bu Sari, Ibu Nur). A 4th persona — regular `SCHOOL_ADMIN` (Bu Lina or equivalent) — is deferred until the parallel `role-split` cycle merges. Once it does, add `JTBD-ADMIN-PAY-02` (payroll access expects 403 as SCHOOL_ADMIN) and any other salary-403 variants.

Each job declares `Role:` (`SUPER_ADMIN` | `SCHOOL_ADMIN` | `either`) so once role-split ships, `/uat` can pick the correct persona automatically. `Expected perf:` is per-job and takes precedence over the global thresholds in `SKILL.md`.

**Area groups** (align with `config/admin-nav.ts`; used by `/uat admin/<group>`):
- `/uat admin/hr` — employees, attendance, leave, payroll
- `/uat admin/academic` — students, student-attendance, academic, enrollments, teaching-assignments, admissions, assessment-templates
- `/uat admin/finance` — invoices, fees
- `/uat admin/penilaian` — assessments (scores + templates)
- `/uat admin/settings` — campuses, holidays, users, roles, salary-components

---

## Area: home

### JTBD-ADMIN-HOME-01 — Act on an authorized pending record
- **Persona:** School administrator, repeated with restricted finance, HR, and admissions roles
- **Preconditions:** Unconverted submitted (Formulir masuk) enrollment forms, pending leave, an invoice awaiting a payment link, and draft payroll. Include authorized records outside the list's initial page/filter.
- **Steps:** Open the Dasbor (`/admin`); read the top-5 urgent list (or a queue count tile); for anything beyond the top 5, follow a tile or "Lihat semua" to the full queue at `/admin/work-queue?kind=<kind>`; open a named record; confirm its identity and permitted actions; dismiss or return; complete the original domain workflow when authorized; return to the queue.
- **Done when:** A new public `/daftar` inquiry appears as a **Pertanyaan pendaftaran baru** tile/row (until its status moves on or 14 days pass) and links to Pendaftaran. Dasbor, `/admin/work-queue`, navigation, and endpoints agree on access. A leave dialog stays closed after Cancel/Escape and Back behaves predictably. Only authoritative domain-state changes remove work. No generic completion control exists. Real zero, unavailable data, and loading are distinguishable, with a working retry for unavailable sources.
- **Permission checks:** Read-only accounts have no mutation affordances or working mutation endpoints. Recording money follows `payments.record`, creating invoices follows `invoices.create`, and voiding follows `invoices.void`. HR links also satisfy the HR destination guard. Foreign-tenant records never appear or open.
- **Verification status:** Engineering acceptance contract; record browser/API results in the cycle. No measured usability claim.

---

## Area: students

### JTBD-ADMIN-STUDENT-01 — Create a new student end-to-end
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** form submit click-to-confirm <1.5s; list refresh <1s
- **Preconditions:** Logged in as SUPER_ADMIN, at least one active class section exists in seed
- **Steps (user intent, not UI clicks):**
  1. Open the students list
  2. Initiate "new student"
  3. Fill the essentials (name, DOB, gender, class assignment, at least one guardian)
  4. Save
  5. See the new student in the list
- **Done when:** New student appears in the list with `ACTIVE` status, assigned to the chosen class, with ≥1 guardian linked. List refresh does not lose scroll/filter position.
- **Why this job matters:** Ibu Nur onboards students frequently during admissions season. Target: under 5 minutes per student. Friction here compounds across hundreds of rows.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-STUDENT-02 — Enroll a student into a class section
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** enrollment submit click-to-confirm <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 active student not yet enrolled, ≥1 class section with capacity
- **Steps:**
  1. Open a student's detail page
  2. Click "Daftarkan ke Kelas"
  3. Search the class picker by class name ("B 3") or kampus ("Aster") — the picker is a searchable combobox grouped by kampus, and offers only ACTIVE/PLANNING academic years
  4. Pick a class section
  5. Submit
  6. See success toast + enrollment in the student's "Riwayat Kelas" tab
- **Done when:** Student has an ACTIVE enrollment in the chosen class. If class is full, duplicate enrollment, or age-out-of-range: toast shows the specific error message in Indonesian. "Daftarkan" button never stays stuck (spinner resets on both success and error).
- **Error scenarios to verify:**
  - Duplicate enrollment → 400 "Siswa sudah terdaftar di kelas lain"
  - Full class → 400 "Kelas penuh (X/Y)"
  - Archived academic year → 403 "Tahun ajaran sudah diarsipkan. Pilih kelas pada tahun ajaran yang aktif." (the picker no longer offers these, so exercise via direct API call)
  - Network error → toast "Terjadi kesalahan jaringan"
- **Why this job matters:** Every new student must be enrolled. Button stuck = admin confused.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: invoices

### JTBD-ADMIN-PAY-01 — Check today's cash received (Penerimaan)
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** ledger load <1.5s; CSV download starts <1s
- **Preconditions:** Logged in as SUPER_ADMIN; ≥1 payment recorded in the chosen range
- **Steps:**
  1. Open Keuangan → Penerimaan (`/admin/payments`)
  2. Default view shows today's payments + Total Penerimaan + Jumlah Transaksi
  3. Widen the date range (e.g. month-to-date) and/or filter by method (Tunai / Transfer Bank / Virtual Account)
  4. Search by student name, invoice number, or payment reference
  5. Read the per-method summary badges and paginate if the result set exceeds one page
  6. Open a payment row via "Lihat" and confirm the linked invoice detail opens
  7. Click "Ekspor CSV"
- **Done when:** Summary cards + table reconcile against the filtered range, method/date/search filters narrow both the table and summary, pagination works without duplicate/missing rows, row "Lihat" opens the correct invoice, CSV downloads with matching filtered totals and a Bahasa filename. REVERSED payments never appear.
- **Why this job matters:** Treasurer daily/period cash recap previously required opening every invoice one by one.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-INV-01 — Create a manual invoice for a specific student
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** save click-to-confirm <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 active student in seed, ≥1 fee component definition in seed
- **Steps:**
  1. Open the invoices area
  2. Initiate "new invoice"
  3. Pick a student, pick fee components, set due date
  4. Add eight components, including a long label; enter different amounts. At 320/390/768/1440px and a short desktop window, scroll the body to the final row and Total. Confirm Batal and Buat Tagihan stay visible and no control escapes horizontally.
  5. Tab through the final amount, remove/add controls, and footer; open a component dropdown and close it with Escape. Resize while open and confirm entered values persist.
  6. Save and inspect the created invoice detail.
- **Done when:** Invoice detail shows the correct student, due date, components, total and server-returned billing status. Long forms scroll within the shared Dialog/Sheet body; header and action buttons stay reachable. Cancel/Escape closes the overlay and returns focus to the trigger. Repeat at the reflow equivalent of 200% desktop zoom; record native toolbar zoom separately when used.
- **Why this job matters:** Manual invoice creation is the escape hatch for anything the batch system doesn't handle. Ibu Nur does this weekly.
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-ADMIN-INV-04 — Grant a keringanan so it applies every month
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** save click-to-row-visible <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 active student, ≥1 fee component, ≥1 academic year
- **Steps:**
  1. Open `/admin/fees` and switch to the Keringanan tab
  2. Add a keringanan: pick the student, the academic year, the fee component
  3. Choose discount or surcharge, percentage or fixed amount, enter the value
  4. Type the reason (required) and optionally a validity window
  5. Save, then run bulk generate for the next period
- **Done when:** The grant appears in the list, and the generated invoice for that student shows the reduced amount with the reason on the line. The confirm dialog before generation says how many students carry a keringanan.
- **Why this job matters:** Before this existed, a sibling discount or beasiswa meant hand-building that child's invoice every single month, or editing nothing at all. This is the difference between billing 180 families in one run and billing 175 plus five by hand.
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-ADMIN-INV-05 — Bill one class for the month without billing everyone
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** draft materializes <3s for ~30 students; commit progresses visibly throughout
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 class with active enrollments, fee structure set for its program
- **Steps:**
  1. Open `/admin/invoices` and click "Buat Tagihan"
  2. Step 1 — set periode and jatuh tempo, pick one or more classes, optionally add or exclude individual students
  3. "Lanjutkan" — the draft is built server-side
  4. Step 2 — scan the rows, expand one to check its components; adjust a component's amount, add a potongan or an extra component where a family needs it, and drop anyone who should not be billed
  5. Step 3 — check the totals; if the draft is old, "Hitung Ulang" rebuilds it from current fee data (edits are discarded, exclusions kept). Then commit
- **Done when:** Only the scoped students are invoiced. Rows with a keringanan show the badge and the reduced total, and any hand-edited row shows a "Diedit" or "Manual" badge. Skipped rows state why. The committed invoice carries exactly the amounts reviewed in step 2. The invoice list reflects the run.
- **Why this job matters:** Before the wizard, bulk generate billed *every* active student with no filter and no preview — the only way to bill one class was to hand-build each invoice. This is also the first version where closing the tab mid-run doesn't lose the work.
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-ADMIN-INV-02 — View an invoice's detail and payment status
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** detail open <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 invoice with payment records in seed
- **Steps:**
  1. Open the invoices list
  2. Click "Lihat" on an invoice
  3. See: line items, subtotal, payments applied, outstanding balance, status history
  4. On an unpaid invoice, tap Chat WhatsApp in the Kontak Wali card
  5. A parent says they paid through DOKU but the row still reads Link Dibuat: from the list's row menu, tap Cek status pembayaran
  6. To catch up on every unpaid invoice at once, tap Cek semua belum lunas in the list header; it checks 50 at a time and says how many are left
  7. When Buat link baru (N) shows in the header (unpaid invoices whose link expired), tap it to make a fresh link for 25 of them; it says how many are left
  8. On an unpaid invoice whose link the parent cannot open, choose Buat link baru from the detail `⋯` menu and confirm
- **Done when:** Detail page shows line items + payment trail + outstanding balance. All Rupiah amounts formatted via `formatRupiah()`. Status transitions (PENDING → SENT → PAID / OVERDUE) visible with timestamps. For a billed invoice with money left, Chat WhatsApp opens WhatsApp in a new tab on the wali's number with a courteous reminder naming the child, the invoice and what is left, plus the payment link (or the parent portal); with no usable number the card says so, and a paid, cancelled or draft invoice offers no reminder. Cek status pembayaran is in the row menu of an unpaid invoice that holds a payment link, answers with a toast, and the row shows Lunas when the gateway has the payment. Cek semua belum lunas reports how many invoices were checked, how many changed and how many are left. Tapping Chat WhatsApp records the reminder, and the Kontak Wali card then reads "Terakhir diingatkan baru saja · oleh Anda". Buat link baru asks for confirmation, then shows a different working link, or says the invoice was already paid, or keeps the old link with an error when the gateway cannot be reached. A DOKU payment in the payment trail names its channel (for example Virtual Account BCA); payments from before the channel was kept read Virtual Account (DOKU).
- **Why this job matters:** When a parent disputes a charge, Ibu Nur needs the full story in one place — not three queries. If payment history is hidden, she defaults to WhatsApp.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-INV-07 — Remind every family that still owes, one tap each
- **Persona:** Ibu Nur
- **Role:** either (needs the Catat Pembayaran permission)
- **Expected perf:** queue opens <2s on mobile
- **Preconditions:** Logged in as SCHOOL_ADMIN, ≥3 unpaid invoices whose wali has a WhatsApp or phone number, ≥1 without a number
- **Steps:**
  1. Open `/admin/invoices` and tap Pengingat WhatsApp in the header
  2. On the first row tap Buka WhatsApp; send the message in WhatsApp and come back
  3. On a row that shows Buat link dulu, tap it, then Buka WhatsApp
  4. Close and reopen the queue
- **Done when:** The queue lists unpaid invoices that still owe money, families never reminded first. Each row shows the child, period, Sisa in Rupiah, the status, and "Belum diingatkan" or "Diingatkan … · oleh …". Buka WhatsApp opens the wali's chat with the salam message and the invoice's payment link, and the row then reads "Diingatkan baru saja". Reopened, that row has moved below the not-yet-reminded ones. The footer says how many unpaid invoices have no WhatsApp number. Nothing says "Terkirim": the admin presses send in WhatsApp.
- **Why this job matters:** Parents who forgot, or missed the DOKU email during the switch from Xendit, used to wait until they chatted the admin. Now the admin can work down the list in minutes and answer "saya belum dapat link" with when they were last reminded.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-INV-06 — Cancel an overdue invoice and see what is owed in Rupiah
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** invoices list + KPI cards <2s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 `OVERDUE` invoice with no payments and ≥1 with a manual payment
- **Steps:**
  1. Open `/admin/invoices` — read "Piutang" and "Diterima Bulan Ini" next to the counts
  2. Open the row menu on the unpaid overdue invoice and choose "Batalkan"; confirm
  3. On the overdue invoice that has a payment, choose "Batalkan Tagihan" from the detail `⋯` menu
- **Done when:** The unpaid overdue invoice becomes Dibatalkan (no red "Sisa"). The invoice with payments explains, in Indonesian, that the payments must be reversed first. Piutang equals the sum of remaining on Link Dibuat / Dibayar Sebagian / Lewat Tempo invoices; Diterima Bulan Ini equals the non-reversed payments of the current Jakarta month.
- **Why this job matters:** A wrong or withdrawn-student invoice used to sit as overdue forever, and the treasurer had to add rows by hand to know what is owed.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-INV-03 — Mark an invoice as paid manually (offline cash/transfer)
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** mark-paid click-to-status-change <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 invoice with status `SENT` or `OVERDUE` for a guardian who paid via bank transfer outside Xendit
- **Steps:**
  1. Open the invoice detail
  2. "Catat Pembayaran" — amount (prefilled with the balance), method (Tunai / Transfer Bank / Lainnya), reference note; press "Tinjau Pembayaran"
  3. Read the review (invoice, student, Rp amount, method, date, resulting status) and press "Catat Rp …"; if it was a mistake, use "Batalkan pembayaran" on that payment row and give a reason
  4. Confirm the invoice moves to `PAID` (and back to its previous state after a reversal)
  5. On a past-due annual fee, record only part of the amount
- **Done when:** Nothing is saved until the review is confirmed. Invoice status is `PAID`. Payment shows in the payment trail with the recorded method + reference and "Dicatat oleh <nama>". A reversed payment stays visible struck-through as "Dibatalkan", is excluded from the invoice total, the penerimaan ledger and the parent view; gateway payments cannot be reversed. Parent portal reflects `PAID` within one refresh. A partial payment on a past-due invoice leaves it Lewat Tempo, with "Dibayar … / Sisa …" and the kuitansi still downloadable. Its payment link is replaced by one for what is still owed.
- **Why this job matters:** Many An Nisaa' parents still transfer via BSI mobile outside Xendit. Without manual mark-paid, Ibu Nur's books and the ERP diverge.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: payroll

### JTBD-ADMIN-PAY-01 — Run payroll for this month (SUPER_ADMIN)
- **Persona:** Ibu Nur (`SUPER_ADMIN`)
- **Role:** SUPER_ADMIN
- **Expected perf:** payroll preview calculation <3s for ≤50 employees; finalize click-to-confirm <2s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥3 active employees in seed, payroll period for the current month not yet run
- **Steps:**
  1. Open the payroll area
  2. Start a new payroll run for the current month
  3. Review the calculated numbers (gross, deductions, net per employee)
  4. Finalize
  5. See slips generated and available to teachers in their portal
- **Done when:** Payroll period shows as `FINALIZED` (or equivalent), every active employee has a slip, and the numbers visibly add up. No stale spinner, no silent errors.
- **Why this job matters:** Salary. The one thing Ibu Nur cannot tolerate a bug in. Any blocker here is a P0.
- **Follow-up after role-split ships:** Add `JTBD-ADMIN-PAY-02` — same steps as Bu Lina (`SCHOOL_ADMIN`), expected outcome: `/admin/payroll` route returns 403 at the middleware, sidebar does not show Payroll, employee list API response does not include salary fields. This is the "role split holds" verification.
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-ADMIN-PAY-03 — Export a finalized payroll run to BSI Excel (SUPER_ADMIN)
- **Persona:** Ibu Nur (`SUPER_ADMIN`)
- **Role:** SUPER_ADMIN
- **Expected perf:** export generate + download <3s for ≤50 employees
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 payroll run in `FINALIZED` status
- **Steps:**
  1. Open the finalized payroll run
  2. Trigger "Export BSI" (`GET /api/payroll/[id]/export/bsi`)
  3. Receive an Excel file compatible with BSI mass-transfer upload (account number + amount per row)
- **Done when:** Excel downloads with no server error, column headers match BSI's expected format, row count equals the number of active employees in the run, all amounts are integer Rupiah (no decimals, no currency symbol).
- **Why this job matters:** Ibu Nur's goal #5 — "Export anything to Excel on demand." Payroll export is the single lever she pulls to actually pay people. A broken export = everyone's salary is late.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: employees

### JTBD-ADMIN-EMP-01 — Deactivate an employee who is leaving
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** list search filter <500ms; deactivate confirm <800ms
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 active employee in seed
- **Steps:**
  1. Open the employees list
  2. Find the employee (search by name)
  3. Use the row action to deactivate (soft-delete via status change, per CRUD Standard)
  4. Confirm in the dialog
  5. See the employee move to `INACTIVE` status
- **Done when:** Employee status is `INACTIVE`. List default filter (active only) no longer shows them. Toggling the filter to "semua status" or "tidak aktif" reveals them. Never a hard delete.
- **Why this job matters:** HR lifecycle, happens a few times a year. Must be reversible.
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-ADMIN-EMP-02 — Create a new employee with salary components (SUPER_ADMIN)
- **Persona:** Ibu Nur (`SUPER_ADMIN`)
- **Role:** SUPER_ADMIN
- **Expected perf:** save click-to-confirm <1.5s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 salary component defined in settings, ≥1 active campus
- **Steps:**
  1. Open the employees list
  2. Click "Tambah Karyawan"
  3. Fill identity (name, NIK, role, campus, hire date), then attach salary components (base salary, allowances)
  4. Save
  5. See the new employee in the list with `ACTIVE` status and salary components attached
- **Done when:** Employee exists with salary components correctly linked. Next payroll run includes them at the expected gross. Form surfaces validation inline (no submit-then-5-errors).
- **Why this job matters:** Teacher turnover during admissions season is real. Every new hire must be able to receive their first salary on schedule. A broken create = a 3-week delay.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: leave

### JTBD-ADMIN-LEAVE-01 — Approve a pending leave request
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** approve click-to-status-change <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 leave request with status `PENDING` in seed
- **Steps:**
  1. Open the leave area
  2. See pending requests first (or filter to pending)
  3. Click "Lihat" to view the request details in a dialog
  4. Use the ⋮ dropdown to pick "Setujui"
  5. Confirm in the review dialog
  6. See the request's status change to `APPROVED`
- **Done when:** Request is `APPROVED`, the teacher who requested it sees the status updated in their portal (or would, in a subsequent login). Audit trail records who approved and when. Action buttons (approve/reject) are accessible via dropdown at all viewport widths ≥1024px — no horizontal clipping.
- **Why this job matters:** Weekly rhythm. If Ibu Nur can't find pending requests in under 3 seconds, they pile up.
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-ADMIN-LEAVE-02 — Reject a leave request with a reason
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** reject click-to-status-change <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 `PENDING` leave request in seed
- **Steps:**
  1. Open the leave area
  2. Open a pending request
  3. Pick "Tolak" from the ⋮ dropdown
  4. Enter a required reason (Indonesian, min 10 chars)
  5. Confirm
- **Done when:** Request shows `REJECTED` with the reason visible to the requesting teacher. Audit trail records who rejected + when + reason. Reason field rejects empty / whitespace-only submissions.
- **Why this job matters:** Rejecting without a reason breaks trust. Teachers need to know *why* their request was denied to plan around it.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: assessments

### JTBD-ADMIN-ASSESS-01 — Publish a student's report card
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** publish click-to-confirm <1.5s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 StudentAssessment in `DRAFT` with an AssessmentTemplate attached and all indicators scored
- **Steps:**
  1. Open the assessments area
  2. Find a draft report card for a TKIT student
  3. Open it; verify all indicators have scores filled
  4. Change status to Published
  5. Confirm the parent portal shows the report card in their reports area
- **Done when:** Assessment status is `PUBLISHED`. A parent logged in for that student sees it under their Reports tab. Any indicator missing a score shows a visible validation error before publish — silent failure is a blocker.
- **Why this job matters:** Quarterly ritual. Publishing wrong or incomplete report cards is a trust-destroying event. Feedback must be explicit.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-ASSESS-02 — Enter scores into a draft report card
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** save-indicators click-to-confirm <1.5s; no loss of entered scores on navigate-away
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 StudentAssessment in `DRAFT` with an AssessmentTemplate attached
- **Steps:**
  1. Open a draft assessment
  2. Enter scores (BB/MB/BSH/BSB) or narrative feedback against each indicator
  3. Save without publishing
  4. Navigate away and back; confirm all entered values persist
- **Done when:** All indicators persist with the entered values. Partial saves are allowed (she doesn't have to fill everything in one sitting). Draft stays `DRAFT` — not accidentally published.
- **Why this job matters:** Bu Sari (or Ibu Nur on her behalf) enters ~20 indicators × 18 students = 360 data points per quarter. Losing work to a refresh is a trust-killer.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: admissions

### JTBD-ADMIN-ADM-01 — Take an inquiry from Pertanyaan to student on one list
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** list full load <1.5s (stats arrive in the same request); Catat Pertanyaan and Kirim Formulir click-to-confirm <1s; convert click-to-toast <3s; no full-page reload between steps
- **Preconditions:** Logged in as SUPER_ADMIN; ≥1 lead in Tahap *Baru* in seed (from `/daftar` or staff-created); one lead stored as `VISITED` or `UNDER_REVIEW` from before this change, if the data has one.
- **Steps:**
  1. Open Pendaftaran (`/admin/admissions`). Read the stat cards (there is no "Menunggu pembayaran" card; "Belum bayar" is the one payment count) and the Tahap and Pembayaran columns; filter Tahap to *Baru*.
  2. Catat Pertanyaan with only Nama orang tua and a No. HP/WhatsApp; expand "Data anak" and confirm it is optional. Save and find the new *Baru* row.
  3. On a *Baru* row tap Kirim Formulir. Confirm it sends in one tap without asking for Program or Day Care and shows no fee, and that the result card says the parent pays the fee after sending the form. Confirm the row becomes *Formulir dikirim*. Tap Kirim Formulir again on the same row and confirm the card says the old link no longer works.
  4. After the parent submits, confirm the row shows *Formulir masuk* with a Pembayaran state (Belum bayar for a priced program, none for a free one); open the formulir from the row (Buka formulir).
  5. Tap *Terima & Jadikan Siswa*, read the single confirmation, and confirm. Confirm the row becomes *Siswa* and "Lihat siswa" opens the new student.
  6. Edit a lead and clear its email; reopen it and confirm it stayed cleared. Batalkan another *Baru* lead and confirm it shows *Batal*.
  7. Open `/admin/enrollments` and confirm it lands on this list; a bookmarked `/admin/enrollments/[id]` still opens.
- **Done when:** One list shows every family with its Tahap (Baru, Formulir dikirim, Formulir masuk, Diterima, Siswa, Ditolak or Batal) and Pembayaran; there are no visit steps and no second Formulir list. A lead needs only a parent name and one contact. Sending a formulir needs no Program, Day Care or fee: no fee exists until the parent submits. The primary row action follows the stage. A legacy `VISITED` lead reads *Baru* and an `UNDER_REVIEW` one reads *Formulir masuk*, and both continue normally. After convert the linked student prevents a second conversion, and every error is an actionable Indonesian message.
- **Why this job matters:** Admissions season is high-volume. Ibu Nur tracks 20+ leads at once; the stage on the row and one obvious next click are the whole point.
- **Known friction (from last UAT):** <filled by /uat reports>

---

### JTBD-ADMIN-ADM-02 — Check an application's Kelengkapan Berkas and tick papers received on paper
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** page full load <1.5s; "Diterima fisik" tick click-to-confirm <800ms with no full-page reload; "Lihat" opens the file in a new tab
- **Preconditions:** Logged in as SUPER_ADMIN; ≥1 formulir (a Pendaftaran row in *Formulir dikirim* or *Formulir masuk*, opened with Buka formulir at `/admin/enrollments/[id]`) where the parent uploaded at least one berkas (e.g. Kartu Keluarga) and others are missing.
- **Steps:**
  1. From the Pendaftaran list open the formulir's detail page and find the Kelengkapan Berkas card
  2. Read how many of the required papers are complete and which are missing
  3. Open an uploaded file (Lihat) and confirm it is the right document
  4. A parent hands over a paper copy of the akta kelahiran at the front desk; tick it as received and confirm the count goes up
  5. Reload the page and confirm the tick stayed
- **Done when:** Each item shows one clear state (Diunggah, Diterima fisik, or Belum) and the card shows "x / 9 berkas lengkap". Lihat opens the real file. The tick saves without a page reload, updates the count immediately and survives a reload. A failed save reverts the tick with an Indonesian message, and a read-only user sees the card but cannot tick.
- **Why this job matters:** Admissions staff used to track the paper checklist by hand. The card replaces that tally, so the count and the per-item state must be right.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-ADM-03 — Choose which berkas parents must upload, then convert and find the documents on the student
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** settings page full load <1.5s; save click-to-confirm <800ms; convert click-to-toast <3s
- **Preconditions:** Logged in as SUPER_ADMIN; a submitted formulir (*Formulir masuk*) whose parent uploaded KTP Ayah, KTP Ibu and KK, and whose guardians have no KTP/KK on file yet.
- **Steps:**
  1. Open Pengaturan → Pengaturan Pendaftaran. Enter the pendaftaran fee for each program (0 = no payment step), mark KK and Akta as required, and save.
  2. Open that formulir and tap *Terima & Jadikan Siswa*; confirm once and read the result. If it asks about a possible duplicate student or an existing wali with another name, read the question and answer it.
  3. Open the new student, find the Pendaftaran section and the rail, and check the berkas status.
  4. Open the Ayah's guardian page and confirm the KTP and KK are there.
- **Done when:**
  - The setting saves with a clear confirmation, and a read-only user sees it but cannot change it.
  - One confirmation converts the formulir; a possible duplicate student or a wali name mismatch is asked first and nothing is merged silently. The convert toast says which files were copied to the guardian.
  - The student page shows the Kelengkapan Berkas card, and the rail shows "Berkas pendaftaran (x / 9)", updating after a tick.
  - The guardian's KTP/KK open from the guardian page, and any KTP/KK the guardian already had were not overwritten.
- **Why this job matters:** Without this, staff re-upload documents the parent already sent and hunt for them on the application page after the child is a student.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-ADM-04 — Chase an unpaid pendaftaran fee and record how it was settled
- **Persona:** Ibu Nur
- **Role:** either (finance actions need the payments/fees permissions)
- **Expected perf:** list full load <1.5s; WhatsApp opens in a new tab <1s after the tap; "Perbarui pembayaran" click-to-toast <3s
- **Preconditions:** Logged in as SUPER_ADMIN; ≥2 *Formulir dikirim* rows whose program has a fee — one unpaid with a WhatsApp number, one whose parent says they paid by bank transfer. The fee exists only after the parent submits the formulir (or staff use Tandai formulir masuk), so these rows are *Formulir masuk*; a *Formulir dikirim* row has no fee yet.
- **Steps:**
  1. Open Pendaftaran. Filter Pembayaran to "Belum bayar" and read the "Belum bayar" count; confirm there is no "Menunggu pembayaran" card.
  2. On the unpaid row open the menu and tap "Ingatkan bayar (WhatsApp)"; confirm WhatsApp opens on the parent's number with the reminder and the link that leads to payment already written.
  3. Open the formulir. In "Pembayaran pendaftaran" read the normal fee, the discount and what is owed; give a sibling discount with a reason and confirm the new amount.
  4. On the one that paid by transfer tap "Tandai sudah bayar", choose Transfer bank, add a note, and record it.
  5. Tap "Perbarui pembayaran" on one the parent says they paid through DOKU and read the result.
  6. Open a *Formulir masuk* formulir whose parent pays cash at the desk, and in "Pembayaran pendaftaran" tap *Tandai lunas (tunai)* then confirm; on another formulir tap *Bebaskan biaya* and confirm. Confirm each fee card shows Lunas or Dibebaskan with who and how, and that the parent's link now shows the payment as settled.
  7. Convert a *Formulir masuk* row whose fee is still unpaid and read the warning.
- **Done when:** The filter, count and badges agree. WhatsApp opens in a new tab with the parent's number, the amount and the link, and a row with no number says so instead of offering a dead button. A discount needs a reason and shows what the parent will owe; if the parent already holds a payment link the dialog says it will be cancelled. Marking paid needs a chosen method and shows Lunas with who/how; Tandai lunas and Bebaskan biaya ask once more because they cannot be undone. A payment the gateway took but Talib could not credit shows "Perlu dicek" with what to do. Convert warns about the unpaid fee without blocking. A user without finance permissions sees the facts and the WhatsApp/copy actions but no money buttons. The Kirim Formulir result card never offers Tandai lunas or Bebaskan, because there is no fee before submit.
- **Why this job matters:** Registration fees are the first money a family pays. An unpaid fee nobody chases is lost revenue, and a wrongly recorded one is a ledger error.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-ADM-05 — Walk-in family: catat, Kirim Formulir without email, fill together, Terima & Jadikan Siswa
- **Persona:** Ibu Nur
- **Role:** either (settling the fee needs the payments/fees permissions)
- **Expected perf:** Kirim Formulir click-to-result <1s; "Isi bersama orang tua" opens the form in a new tab <2s; convert click-to-toast <3s
- **Preconditions:** Logged in as SUPER_ADMIN; a parent standing at the front desk with a phone number and no email, and the child's papers (KK, akta) to hand.
- **Steps:**
  1. Catat Pertanyaan with Nama orang tua and the phone number only. Confirm the row is *Baru* and the source was set automatically (walk-in).
  2. Tap Kirim Formulir (one tap, no Program or Day Care question, no fee shown). Confirm no email is required and the result card offers Kirim lewat WhatsApp, Salin tautan and Isi bersama orang tua, and says the parent pays the fee after sending the form.
  3. Tap *Isi bersama orang tua*; on the parent form choose the Program (prefilled from the lead if set) and Day Care with the parent, fill the seven steps (type the kode pos and confirm kelurahan, kecamatan, kota and provinsi fill in), read the price at Tinjau, and let the parent sign on the screen. Submit.
  4. Back on the list, confirm the row is *Formulir masuk* and *Belum bayar*. Open the formulir and, because the parent pays at the desk, tap *Tandai lunas (tunai)* in the fee card and confirm.
  5. Tap *Terima & Jadikan Siswa* and confirm.
- **Done when:** The whole flow works without an email address; the form opens straight on the first step with no payment screen, and the fee is created only when the form is submitted and settled afterwards from the formulir; the signature is the parent's own. The row ends *Siswa* with the student, an Ayah and an Ibu wali created and linked, and their address reads the full joined address. Every message is actionable Indonesian.
- **Why this job matters:** Most walk-ins have no email. Before this, they could not receive a formulir at all, and the school lost the family at the desk.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-ADM-06 — Correct a formulir with Ubah data, or submit it with Tandai formulir masuk
- **Persona:** Ibu Nur
- **Role:** either (needs `admissions.edit`; repricing needs `fees.edit`)
- **Expected perf:** Ubah data save click-to-toast <1.5s; Tandai formulir masuk click-to-toast <2s
- **Preconditions:** Logged in as SUPER_ADMIN; one *Formulir masuk* formulir with a wrong parent phone number, and one *Formulir dikirim* formulir the parent has not finished while standing in the office. An unpaid fee on one of them; a second login with a viewer role.
- **Steps:**
  1. Open the first formulir (Buka formulir) and tap *Ubah data*. Type a malformed phone, save, and read the inline error; confirm nothing was saved.
  2. Fix the phone, change Day Care, read the live fee, and save. Confirm the unpaid fee was recomputed; on a Lunas or Dibebaskan fee confirm the screen says the fee was left alone. In the address, confirm Kelurahan / Desa, Kota / Kabupaten and Provinsi are plain boxes (no kode pos lookup for staff), edit one, and confirm it saves.
  3. Clear an optional field (for example Ibu's email) and save; confirm it stays cleared.
  4. Open the second formulir, tap *Tandai formulir masuk*, read the confirmation (consent "disetujui langsung di sekolah"), and confirm. If something required is missing, read what the message lists. Confirm the formulir now has a fee (unless the program is free).
  5. Confirm the row is *Formulir masuk* with no signature drawn by staff, then convert it.
  6. Sign in as the viewer role and confirm *Ubah data*, *Tandai formulir masuk* and *Terima & Jadikan Siswa* are absent; after conversion confirm *Ubah data* is gone for everyone.
- **Done when:** Every formulir section can be corrected; malformed phone, email or date shows an inline error and changes nothing. Clearing a field works. An unpaid fee reprices with the program or Day Care; a paid or waived one never does. The three address boxes (Kelurahan / Desa, Kota / Kabupaten, Provinsi) can be corrected like the rest. *Tandai formulir masuk* creates the fee like a parent submit, records who and when with the consent note and never fabricates a signature. Viewers and converted formulirs have no edit controls.
- **Why this job matters:** Parents mistype on phones and some never finish. Staff must be able to fix the record without re-asking the family or leaving the form half-done, and without forging their consent.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: guardians

### JTBD-ADMIN-GUARD-01 — Find and update a guardian's contact details
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** search <500ms; save <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥10 guardians in seed
- **Steps:**
  1. Open the guardians list
  2. Search by name or phone
  3. Open the guardian's detail
  4. Edit phone / email / address
  5. Save
- **Done when:** Updated contact reflects on the linked student's detail page within one refresh. Phone validation accepts Indonesian formats (`08xxx`, `+628xxx`). No hard delete — status toggle only. A wali with no linked student is editable too — bio saves through `PUT /api/parents/[id]`, not a junction row.
- **Why this job matters:** Wrong phone = Bu Sari can't reach the parent when a kid is sick. Happens ~5x/month.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-GUARD-02 — Add a second child's wali without duplicating the family
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** parent search <1s; link save <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 wali already linked to a student, plus a second student from the same family with no wali yet
- **Steps:**
  1. Open the second student's detail → Orang Tua / Wali tab → **Tambah**
  2. Search the existing wali by name or phone
  3. Set Hubungan and (optionally) Anak ke-, then **Tautkan Wali**
  4. Repeat on a third student, but this time use "Tidak ketemu? Tambah wali baru" and type a name that already exists
- **Done when:** Step 3 links the existing wali and the guardians-list total does **not** grow. Step 4 stops on *Wali serupa sudah terdaftar*, naming why it matched, offering **Tautkan** and **Tetap Buat Baru**. The wali's detail page then lists both children.
- **Why this job matters:** Most families here have two or three children enrolled. Before this, a wali without an email on file got a fresh Parent record per child — two profiles, two KK slots, and invoices split across both, which surfaces later as a billing mess nobody can trace back.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-GUARD-03 — Move between a student and their wali
- **Persona:** Bu Sari
- **Role:** either
- **Expected perf:** each hop <2s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 student with a wali who has another enrolled child
- **Steps:**
  1. Open the student's detail → Orang Tua / Wali tab → click the wali's name
  2. On the wali page, click one of the listed children
  3. On that student, use the **Saudara** row to jump to a sibling
  4. From `/admin/students`, click a name in the **Wali** column
- **Done when:** Every hop navigates without going through the sidebar or search. Saudara is hidden entirely for an only child.
- **Why this job matters:** Bu Sari fields a phone call about one child and needs the family's context immediately — the parent's number, the sibling's class. Backtracking through search costs her the call.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-GUARD-04 — Make a different guardian the wali utama with one click
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** confirm + save <1s
- **Preconditions:** Logged in as SUPER_ADMIN, a student with ≥2 ACTIVE guardians, one already marked **Utama**
- **Steps:**
  1. Open the student's detail → Orang Tua / Wali tab
  2. On the non-primary guardian's card, click the star icon (**Jadikan wali utama**)
  3. Read the confirm dialog — it names both the guardian being promoted and the one being demoted
  4. Confirm
- **Done when:** The promoted guardian now carries the **Utama** badge and the previous primary no longer does — no second guardian card ever shows the badge at once. The action is not offered on the card that is already primary, nor on an INACTIVE guardian. This replaces having to open **Edit Wali** and find the Wali Utama switch below the fold to do the same thing.
- **Why this job matters:** Tagihan dan tautan pembayaran DOKU/Xendit go to the wali utama — an admin who cannot quickly fix a wrong primary risks billing the wrong parent, which is exactly what happened on production 2026-09-23.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: teaching-assignments

### JTBD-ADMIN-TA-01 — Assign a wali kelas (homeroom teacher) to a class section
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** assignment save <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 class section without a wali kelas, ≥1 active employee with TEACHER role
- **Steps:**
  1. Open teaching-assignments
  2. Pick a class section missing a wali kelas
  3. Assign an employee as HOMEROOM
  4. Save
- **Done when:** Class section shows the assigned teacher. The teacher sees the class in their teacher portal class-attendance screen on next login. Duplicate-assignment error returns a specific message in Indonesian.
- **Why this job matters:** Without a wali kelas, teacher-portal attendance is empty — the class is invisible. Start-of-term blocker.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: fees

### JTBD-ADMIN-FEE-01 — Update a fee component amount for next term
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** save <1s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 fee component in seed
- **Steps:**
  1. Open the fees area
  2. Edit a component's amount (e.g. SPP Bulanan Rp500.000 → Rp550.000)
  3. Save
  4. Confirm a new manual invoice uses the new amount; existing unpaid invoices keep their original amount
- **Done when:** New amount is applied to invoices created *after* the change; historical invoices are unchanged. UI makes this contract visible (i.e. "berlaku untuk tagihan baru" hint near the field).
- **Why this job matters:** Fee revisions happen ~2x/year. Silent retroactive changes would be a disaster — parents would see their old invoices change under them.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: academic

### JTBD-ADMIN-ACAD-01 — Review academic year and class section setup
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** list load <1.5s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 academic year + ≥1 class section in seed
- **Steps:**
  1. Open Pengaturan → Sekolah → Tahun Ajaran (`/admin/academic-years`)
  2. See the list of academic years
  3. Navigate to the current year's class sections
  4. Confirm each class section shows student count and wali kelas assignment
- **Done when:** User can answer "are all classes set up correctly for this term?" in under 30 seconds. Empty states (if any class has no wali kelas) are visually distinct and actionable.
- **Why this job matters:** Start-of-term ritual. Ibu Nur does it once every 6 months but if it's broken, everything downstream (attendance, invoices, payroll) breaks.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-ACAD-02 — Promote a whole class to the next year (Naik Kelas Massal)
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** roster preview <1.5s; promotion submit click-to-confirm <2s
- **Preconditions:** Logged in as SUPER_ADMIN; a source class with ≥1 ACTIVE enrollment; a target class (typically next academic year) with enough capacity
- **Steps:**
  1. Open Kelas (`/admin/classes`)
  2. Click "Naik Kelas Massal"
  3. Pick source year + class — roster of active students appears, all checked
  4. Untick any student who stays behind
  5. Pick target year + class — capacity hint shows remaining seats vs. needed
  6. Click "Naik Kelas (N siswa)"
- **Done when:** Toast confirms `N siswa naik kelas` (+ `M ditahan` when some were unticked); old enrollments become GRADUATED, new ACTIVE enrollments exist in the target class. Over-capacity attempt shows the Bahasa error inline and the dialog stays open.
- **Why this job matters:** Year-end ritual (July). Before this dialog the only path was per-student promotion — untenable for a 20-student class.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-ACAD-03 — Pull the monthly attendance recap for the yayasan report
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** recap load <1.5s; CSV download starts <1s
- **Preconditions:** Logged in as SUPER_ADMIN; ≥1 class with marked attendance in the chosen month
- **Steps:**
  1. Open Kehadiran Siswa (`/admin/student-attendance`)
  2. Switch to the "Rekap Bulanan" tab
  3. Pick the month (and optionally a class)
  4. Review per-student Hadir / Sakit / Izin / Alpa counts
  5. Click "Ekspor CSV"
- **Done when:** Table shows every ACTIVE student (zero-count rows included); CSV downloads with the same numbers and a Bahasa filename. Never-marked students are visible with 0 totals, not silently missing.
- **Why this job matters:** Monthly yayasan/Dinas reporting previously required manual tallying from the daily list.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Area: settings

### JTBD-ADMIN-SET-HOLIDAY-01 — Add a national holiday to the calendar
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** save <1s
- **Preconditions:** Logged in as SUPER_ADMIN
- **Steps:**
  1. Open Pengaturan → Sekolah → Hari Libur (`/admin/settings/holidays`)
  2. Add a new holiday (date, name, applies-to campuses)
  3. Save
  4. Confirm student and employee attendance screens mark that date as "Libur" and do not require marking
- **Done when:** Holiday appears in the list and downstream attendance screens treat the date as non-school. Payroll pro-rating respects the holiday (working-days calculation excludes it).
- **Why this job matters:** Indonesian public holidays shift year to year (lunar calendar). Missing one = attendance is marked wrong and pro-rated salaries are incorrect.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-SET-USER-01 — Invite a new teacher's login account
- **Persona:** Ibu Nur
- **Role:** either
- **Expected perf:** invite send <1.5s
- **Preconditions:** Logged in as SUPER_ADMIN, ≥1 active employee with no user account yet
- **Steps:**
  1. Open Pengaturan → Akses → Pengguna (`/admin/settings/users`)
  2. Invite by email, pick role (TEACHER), link to the employee record
  3. Send
- **Done when:** Invited user can sign in via Google and lands in the correct portal. Linking is explicit — an orphan user account (no employee) is not allowed.
- **Why this job matters:** Onboarding blocker. If invite fails silently, a new hire can't use the system and Ibu Nur gets a WhatsApp the next morning.
- **Known friction (from last UAT):** <filled by /uat reports>

---

## Appendix: jobs not yet catalogued

These areas exist in the product but don't have first-class JTBD entries yet. Add them when a cycle touches the corresponding area.

- **Bulk invoice generation** — `POST /api/invoices/generate`; needs a dedicated JTBD once the flow is stabilised
- **Student detail inline edit** (`/admin/students/[id]`) — edit-toggle pattern exists; add JTBD once field coverage is final
- **Admission → enrolled student conversion** — covered by `JTBD-ADMIN-ADM-01`, `-03`, `-05` and `-06`
- **Teacher-portal leave request submission** — teacher-side form not yet shipped (see teacher.md Appendix)
- **Penilaian monitor** (`/admin/assessments`) — covered by `JTBD-ADMIN-PENILAIAN-01`. The legacy assessment-template authoring surface (`/admin/assessment-templates`) was retired in the `penilaian-consolidation` cycle and now redirects to `/admin/assessments`; the route itself was renamed from `/admin/penilaian` to `/admin/assessments` (English-only slugs) in the `admin-dmmt-overhaul` cycle, with a 308 redirect from the old path. The new IKTP penilaian is authored via Kurikulum (Semester → IKTP) + entered by teachers.
- **Settings: campuses, roles & permissions, salary components, work hours** — low-frequency configuration; add JTBD only when a cycle touches them
- **Enrollment move** (move student between class sections mid-term) — edge case, low-frequency
- **Guardian create & link to student** — covered obliquely by `JTBD-ADMIN-STUDENT-01`; promote to first-class if friction shows up in UAT

### JTBD-ADMIN-PENILAIAN-01 — Monitor walas + sentra penilaian completion
- **Persona:** Ibu Nur (stands in for Kepala Divisi Pendidikan)
- **Role:** either (gated by `assessments.read`)
- **Expected perf:** page load <4s; week/day change → table refresh <2s
- **Preconditions:** Logged in with `assessments.read`; active academic year set; ≥1 active class section; some `AssessmentEntry` rows for the selected week/day
- **Steps (user intent, not UI clicks):**
  1. Open Penilaian → Pemantauan (`/admin/assessments`)
  2. Read walas-weekly completion (assessed/enrolled) per class for the current week
  3. Change the week or sentra-day selector to inspect another period
  4. Read sentra-daily entries-made counts per center
- **Done when:** Each active class shows an `N/M dinilai` badge for the resolved week; the 8 sentra cards show entries + distinct-students for the selected day; changing the date re-queries without a full reload.
- **Why this job matters:** The academic head needs to see which walas/sentra are behind on penilaian during the pilot + before each triwulan raport — without this, gaps surface only at report-compile time.
- **Known friction (from last UAT):** <filled by /uat reports>

### JTBD-ADMIN-RAPORT-01 — Draft, override & publish a student's triwulan raport
- **Persona:** Ibu Nur (stands in for Kepala Divisi Pendidikan)
- **Role:** either (gated by `reportCard.read`/`write`/`publish`)
- **Expected perf:** page load <4s; open a student's raport (auto-draft) <3s
- **Preconditions:** Logged in with `reportCard.*`; active semester set; ≥1 Term (triwulan) created; ≥1 class with active students; some `AssessmentEntry` rows in the term window
- **Steps (user intent, not UI clicks):**
  1. Open Penilaian → Rapor (`/admin/report-cards`); if no triwulan exists, create one (semester + number + dates)
  2. Pick a triwulan + class → read the roster with per-student status (Belum dibuat / Draft / Terbit)
  3. Open a student → see narrative sections pre-filled with a suggested level (from penilaian) + the "saran penilaian" count hint, and attendance auto-pulled
  4. Override a level / edit a narrative / adjust attendance; Simpan
  5. Simpan & Terbitkan; then Unduh PDF
- **Done when:** A new student opens with suggested levels + attendance (not blank); edits persist on save (status → Draft); publishing flips status → Terbit; the PDF downloads with the saved sections, attendance, hafalan, and signature lines.
- **Guard:** leaving the editor with unsaved edits (the "Kembali ke daftar" control, or closing/reloading the tab) raises a confirmation first. Saving clears it. Known gap: navigating away via the sidebar or a breadcrumb is a client-side route change and is **not** guarded — see cycle `2026-08-05-admin-ui-audit-fixes`.
- **Why this job matters:** Raport compile was ~640 hand-assembled docx/year. The admin surface turns penilaian already in the system into a draft the academic head reviews + overrides, instead of re-typing from paper.
- **Known friction (from last UAT):** <filled by /uat reports>

### Negative-access (deferred until role-split ships)

Add these once Bu Lina (`SCHOOL_ADMIN`) persona exists. They verify the role split holds — they are **access-control smoke tests**, not timed JTBDs, and `/uat` grades them on "expected 403 received" rather than page-load thresholds.

- **`JTBD-ADMIN-PAY-02`** — `SCHOOL_ADMIN` → `/admin/payroll` returns 403; sidebar does not show Payroll; `GET /api/employees` response has salary fields stripped
- **`JTBD-ADMIN-SET-SALCOMP-02`** — `SCHOOL_ADMIN` → `/admin/salary-components` returns 403
- **`JTBD-ADMIN-EMP-SAL-02`** — `SCHOOL_ADMIN` opens employee detail; salary section is absent (not just hidden via CSS)
