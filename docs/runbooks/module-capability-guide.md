# Talib — Module Capability Guide

Plain-language reference for what each part of the app can actually do today. Written for the school owner/admin, not developers — no code terms, no file paths. Covers the Admin portal (7 module groups), the Teacher portal (6 tabs), and the Parent portal (7 pages, built but not yet turned on for real families).

This is a snapshot of what's implemented, not a promise of what's planned. Update it when a module's capabilities meaningfully change.

---

## Admin Portal

### Kesiswaan (Students)

**1. Create**
- **Add a Student** — full name (required), nickname, gender, date of birth, address, notes, official ID numbers (NIS, NISN, national ID/NIK, Family Card/KK), "lives with" info, initial status. Profile photo uploadable after (JPG/PNG, max 2MB).
- **Add a Parent/Guardian** to a student — name, relationship, phone, WhatsApp, email, plus optional background (education, occupation, income bracket, employer + address, national ID, number of children, home address). First guardian added becomes primary automatically.
- **Record an Inquiry (Admissions)** — child's name, birth date (age auto-calculated), gender; parent's name, phone, WhatsApp, email, relationship, education/occupation/income; program of interest, preferred campus, how they heard about the school, notes, follow-up date.
- **Custom fields** on any student's profile (free-form key/value, e.g. allergies).
- Family documents (ID card per parent, Family Card per family) uploadable and previewable (JPG/PNG/PDF, max 5MB).

**2. View / list / search / filter**
- Students list: searchable by name, filterable by status (Active/Inactive/Graduated/Withdrawn), sortable, paginated, with total/active/graduated summary cards. Exportable to spreadsheet.
- Student detail: full profile, official IDs, family documents, class history, monthly attendance history, all linked guardians.
- Pendaftaran (admissions) list: one list for every family, searchable, with a derived Tahap (Baru, Formulir dikirim, Formulir masuk, Diterima, Siswa, Ditolak, Batal) and Pembayaran per row, filters for Tahap and Belum bayar, stat cards in one request, flags "sibling detected" when a new inquiry matches an existing family.
- Guardians list: searchable, filterable by active/inactive, shows child count per guardian.
- Formulir (enrollment application): sent from a Pendaftaran row and opened at `/admin/enrollments/[id]`; the old `/admin/enrollments` list redirects to Pendaftaran.

**3. Edit / update**
- Student, guardian, and admission records all editable via their creation forms.
- Student photo replaceable/removable any time.
- Withdrawal reason correctable after the fact (withdrawal date itself is locked).
- A guardian can be promoted to primary — automatically demotes the previous primary (only one primary per student).

**4. Delete / deactivate**
- Nothing is permanently deleted — students, guardians, and family links are deactivated/reactivated, never erased.
- Deactivating a student cancels unpaid invoices and ends active enrollment.
- Deactivating a guardian just hides them from the active list.
- Cancelling an admission marks it "Cancelled," doesn't remove it.

**5. Special actions**
- Withdraw (reason required, flags unpaid invoices), Graduate (requires active enrollment), Promote to next class (capacity-checked).
- Enroll directly from student profile.
- Admission lead status is only Baru / Batal (Cancel); the Tahap is derived from the lead, its formulir and the student link.
- Send online enrollment form (Kirim Formulir: one tap, no email needed; the parent picks Program + Day Care in the form and pays the fee after submitting) via secure link by WhatsApp, copy, email or fill together; the parent's address fills from the kode pos; staff can edit any field (Ubah data), settle the fee from the formulir, or submit on the parent's behalf.
- Terima & Jadikan Siswa: one confirmed action creates the student and Ayah/Ibu wali links; a possible duplicate student or wali name mismatch is asked before merging. Reject (Tolak) stays in the row menu.
- Download student list to spreadsheet.

**6. Business rules**
- No hard deletes anywhere in this module.
- Only one primary guardian per student at a time.
- Guardian email can't collide with a staff email.
- Admission status moves forward-only (Cancel excepted); convert-to-student is one-way and only from Admitted.

---

### Akademik (Academic Structure)

**1. Create**
- Program (curriculum track) — code, name, description, type, target age range.
- Academic Year — name, start/end date.
- Class — campus, program, name, capacity (1–200), schedule pattern, age group (A: 4–5yo, B: 5–6yo), always inside a specific academic year.
- Within a class: add students to roster, assign teachers (Homeroom or Assistant).
- Curriculum semester mapping (numbered semesters + date ranges per academic year) — feeds curriculum planning, separate from day-to-day class management.

**2. View / list / search / filter**
- Programs/Academic Years: searchable, status-filterable, shows class counts.
- Classes: filterable by year/campus/program/status, free-text search, shows enrolled/capacity, homeroom teacher, and a health indicator (Healthy/Needs Attention/Critical/Inactive/Holiday).
- Class detail: roster with enrollment dates/status, assigned teachers, monthly attendance-session calendar with per-day substitute-teacher tracking.

**3. Edit / update**
- Programs/Years/Classes editable via creation forms.
- Editing a class post-creation: name/capacity/schedule only — campus and program are locked in (make a new class instead).
- Teacher assignments swappable per calendar day (substitute + reason).

**4. Delete / deactivate**
- Nothing hard-deleted — deactivate/archive only.
- Deactivating a class does NOT auto-move its students — admin is warned and must handle manually.
- Archiving a year is blocked if any student still has an active enrollment in it.
- Once archived, a year's classes become fully read-only.

**5. Special actions**
- Roll Forward — bulk-copy active classes into a new academic year.
- Bulk "Naik Kelas" — mass-promote many students at once.
- Activate an Academic Year — auto-deactivates whichever year was previously active (only one active year at a time).
- Remove a student from roster — marks withdrawn, doesn't erase.
- Replace homeroom teacher — asks for confirmation (only one homeroom teacher per class).

**6. Business rules**
- One homeroom teacher per class max (multiple assistants OK).
- One active class enrollment per student per academic year.
- Class capacity enforced with race-safe checking.
- Only one Academic Year "Active" at a time, school-wide.
- Archived years and their classes are fully locked.

---

### Penilaian (Assessment/Grading)

**1. Create**
- Assessment templates (per program): name, type (Semester/Quarterly/Monthly), category → indicator structure.
- Student assessment record (created on first scoring).
- Triwulan (report-card terms): tied to a semester, term number + date range.
- Report cards per student per term (created on first save).
- Curriculum building blocks: Semesters, Themes, Sub-themes, Weeks, Learning Objectives (TP) + Achievement Indicators (IKTP), plus indicator-to-theme links.

**2. View / list / search / filter / export**
- Templates: searchable, active/inactive filter, shows category count + usage.
- Student assessments: searchable, filterable by status (Draft/Published) and template.
- Penilaian monitoring dashboard: per-date completion status for weekly homeroom + daily activity-center assessments.
- Report-card roster: pick term + class, see every student's status (Not created/Draft/Published).
- Curriculum admin: semester list with theme counts, Theme→Sub-theme→Week drill-down, Learning Objectives browser filterable by age group/subject/status.
- Report card downloadable as PDF once saved.

**3. Edit / update**
- Template name/type always editable; category/indicator structure locks once any student has been graded against it.
- Student scores: 4-level scale per indicator + free-text notes.
- Report card sections fully editable per field (narrative, achievement level, attendance counts, measurements, memorization notes) — pre-filled but hand-adjustable.
- Triwulan dates/term number editable (semester link locked after creation).
- Curriculum items renamable; weekly date ranges checked for overlap and rejected if conflicting.

**4. Delete / void / correct**
- Nothing hard-deleted — deactivate/reactivate toggles throughout.
- Published report cards/assessments can be unpublished (pulled back to Draft, not deleted).

**5. Special actions**
- Publish/Unpublish assessment or report card.
- Download report card as PDF.
- Import curriculum from Excel ("PROMES") — full preview before saving, flags active-record collisions (blocks) and inactive-record collisions (skip or reactivate choice), 5MB cap.
- Link an indicator to multiple curriculum themes via checkboxes.

**6. Business rules**
- Template structure freezes once used for real grading (name/type stay editable).
- Publish/unpublish and curriculum writes need specific admin permission (`curriculum.write`; held by Super Admin and School Admin by default).
- Curriculum imports never silently overwrite — conflicts always need explicit resolution.
- Report card PDF only available after first save.

---

### Kelas Harian (Daily Attendance + Buku Penghubung)

**1. Create**
- Admin does not create daily attendance directly — teachers record that. Admin sets up the reference data: Buku Penghubung (student journal) categories and indicators, for both "Sekolah" and "Rumah" scopes.

**2. View / list / search / filter / export**
- Daily attendance: searchable by name, filterable by status/class/date range.
- Today's stats: present/absent/sick/permission summary cards.
- Monthly recap: per student/class/month totals, filterable, exportable to CSV.
- Buku Penghubung monitoring: week-by-week completion view per class (percentage filled, last-filled date).
- Class drill-down: per-student completion roll-up. Student drill-down: full weekly grid, notes thread, full audit history.

**3. Edit / update**
- Admin can Override an attendance record's status + note (explicit action, not quiet inline edit).
- Admin can edit journal category names/scope and indicator labels.
- Admin can toggle a journal day-cell only if a teacher/parent already filled it — can't originate a new cell.

**4. Delete / void / correct**
- Attendance records: void (soft-delete) only, never hard-deleted; can't void twice or edit after voiding.
- Journal notes: soft-deletable by admin, disappears from the journal.
- Every admin edit/deletion writes to a visible audit trail (before/after, who, when).

**5. Special actions**
- Override attendance status with reason.
- Export monthly recap to CSV.
- Week-by-week navigation across whole-school/class/student views.
- Per-student audit trail viewer.

**6. Business rules**
- Only admin rights can override/void attendance or edit/delete journal data.
- Admin can't originate attendance or journal entries from scratch — teacher/parent must record first; admin only corrects.
- Voiding/deleting is irreversible in the UI even though soft-deleted underneath.

---

### Keuangan (Finance)

**1. Create**
- Fee/charge types ("Komponen Biaya") — code, label, category, recurring vs one-time, display order.
- Fee amounts per program & year ("Struktur Biaya") — what invoices calculate from.
- Invoices — bulk generate via the three-step Billing Run wizard (scope by class and/or individual students → review and edit the materialized rows: keringanan is already applied, and an admin can change a component's amount, add an ad-hoc potongan, add a component from the catalog, remove a line, or drop anyone who should not be billed → commit, which creates the invoices and auto-tries an online payment link). A stale draft can be recomputed from current fee data with "Hitung Ulang" (manual edits are discarded, exclusions are kept), and an abandoned draft discarded from the banner on `/admin/invoices`. Or manual single invoice (hand-pick components/amounts for one student).
- Payments against an invoice — amount, method (cash/bank/virtual account/other), reference, notes. Partial payments supported.
- Online payment links (Xendit) generatable per invoice.

**2. View / list / search / filter / export**
- Invoice list: searchable, filterable by status (Draft/Sent/Paid/Partially Paid/Overdue/Link Gagal), summary tiles.
- Invoice detail: full breakdown, guardian contact, payment history, live Xendit event trail.
- Payments ledger ("Penerimaan"): filterable by date/method, searchable, running totals, exportable to CSV.
- Fee components list: searchable/filterable by status/category.

**3. Edit / update**
- Fee component label/category/recurring/order editable; code locked after creation.
- Fee structure amounts re-editable any time.
- Small discretionary line-item adjustments on an invoice (with required note).
- Payments are never edited after recording — corrections happen by adding a new payment or voiding the invoice.

**4. Delete / void / deactivate**
- Fee components: deactivate/reactivate only.
- Invoices: voidable only while Draft/Sent/awaiting-payment-link; Paid invoices can't be voided; void is permanent (record stays visible, can't be paid again).
- Payments: not deletable.

**5. Special actions**
- Bulk invoice generation with eligible/skipped preview, progress bar, cancel option.
- Retry failed payment links (individually or in bulk, capped + confirmed for large batches).
- Manual cash/bank recording alongside automatic online (Xendit) — not forced online.
- CSV export of payments ledger.
- Keringanan (fee waivers/discounts/surcharges) are durable per-student policy, not per-invoice edits:
  granted once on the Keringanan tab of `/admin/fees` against an academic year and one fee component,
  as a percentage or fixed rupiah amount with an optional validity window and a required reason.
  Every bulk run applies them automatically. No approval workflow — whoever administers fees grants them.

**6. Business rules**
- Online and manual payment channels coexist; online payments auto-update via secure webhook.
- Double-crediting and overpayment are guarded against (overpayment flagged for review, not silently accepted).
- Expired payment links auto-revert the invoice for retry (unless already paid/voided).
- Bulk generation auto-skips inactive students, already-invoiced periods, and missing fee structures — the wizard shows each skip with its reason before anything is committed, including how many rows carry a keringanan.
- A billing run is a saved draft, so closing the tab does not lose it: the invoice page offers to resume an open draft. A commit that fails part-way can be re-run — rows already committed are claimed server-side and never billed twice.
- A keringanan may zero a line but never drives it negative, and a grant only applies inside its own academic year and validity window.
- A voided invoice's payment link becomes unusable.

---

### SDM (HR)

**1. Create**
- Employees — name, formal name, email, phone, job title, campus, hire date, bank details, BPJS status, account role (Teacher or School Admin — determines portal access).
- Salary components (shared, set up once) — code, label, category (Income/Deduction), calc type (fixed/percentage/attendance-based), pro-rate flag.
- Leave requests — submitted by staff themselves; admin reviews, doesn't create.
- Payroll runs — pick a pay period, system auto-generates a draft for every active employee with attendance-based pay calculated.
- Per-employee salary values.

**2. View / list / search / filter / export**
- Employee list: searchable, filterable by campus/status, summary counts. Detail page: profile, salary components, monthly attendance calendar.
- Leave requests: filterable by status, searchable, pending/approved/rejected counts.
- Daily employee attendance: today-view by date/campus with present/late/absent/leave counts, monthly summary, exportable to CSV.
- Payroll runs list: filterable by status (Draft/Approved/Slips Sent), per-run totals.
- Payroll run detail: per-employee income/deduction/net breakdown, filterable by bank-account completeness, compared against prior period.

**3. Edit / update**
- Employee profile fields editable while active.
- Salary component definitions and per-employee values editable.
- Payroll run period dates and working-days — only while Draft.
- Attendance-variable inputs per employee within a draft run (overtime, outdoor days, holiday-worked, DC days) — recalculates pay.
- Discretionary adjustment + required note on a pay line — only while Draft.

**4. Delete / void / deactivate**
- Employees: deactivate/reactivate only (blocks login, excluded from future payroll).
- Salary components: deactivate/reactivate only.
- Payroll runs: Draft can be cancelled outright; Approved runs can't be cancelled or edited — attendance for that period locks.

**5. Special actions**
- Approve/reject a leave request (rejection reason required); approval auto-creates a Leave attendance record.
- Approve a payroll run (one-way, confirmed via warning) — locks that period's attendance.
- Export payroll to bank-transfer (BSI) format, available once approved.
- Send payroll slips — bulk PDF email to every employee in an approved run.
- Manually override daily attendance for an employee (a correction event, not a silent edit).
- Restore/reactivate a deactivated employee.

**6. Business rules**
- Payroll generation blocked (with a named list) if any employee is missing a bank account (when bank is set) or has no salary structure — prevents Rp 0 or unpayable payslips.
- No overlapping or duplicate payroll run periods.
- Approved runs lock numbers and underlying attendance — only export/send-slips remain.
- Deactivating an employee blocks login and excludes them from next payroll, keeps history.
- Rejecting leave requires a stated reason.

---

### Settings

**Campuses** — add/edit/deactivate (soft, reactivatable). Each has name, address, optional GPS ("use my current location"). Can't deactivate a campus with active employees still assigned — blocked with a count.

**Holidays** — add/edit/permanently delete. Date, name, type (National/Islamic/School Closure), half-day flag. No duplicate dates. Adding/removing a holiday automatically ripples into already-generated class schedules (full holiday cancels the day's sessions, half-day collapses to morning-only) — happens quietly on save.

**Roles & Permissions** — 4 built-in roles (Super Admin, School Admin, Teacher, Guardian) shown as locked reference cards. Custom roles addable on top: name, locked code, description, grouped permission checklist (group-level "tick all"). Custom roles editable/deletable except when currently assigned to a user (reassign first).

**Users** — no manual "create user" button; accounts auto-appear on first login. Admin can only assign/remove a custom role and activate/deactivate an account. Can't deactivate your own account. Shows counts by role + inactive count, searchable/filterable.

**Work Hours** — one shared school-wide form: working days, standard start/end time, late-arrival grace period, timezone (fixed Jakarta), payroll period start/end day. Changes affect future calculations only, not history.

---

## Teacher Portal

### Beranda (Home)
- Live clock + check-in/check-out button (captures GPS). Locks to "Done" after check-out — no re-entry.
- Shows today's check-in/out time and status (Present/Late).
- Quick links: student journal, and (homeroom teachers only) weekly assessment.
- Today's scheduled class sessions, each linking through to that session's attendance roster.

### Kehadiran (My Attendance)
- Monthly calendar of the teacher's own attendance, month-navigable.
- Cuti & Izin (Leave) panel: leave balance (annual + sick, used/remaining), submit new request (type/dates/reason, day count auto-calculated), see status of past requests, cancel a still-pending one.

### Kelas (Class Attendance)
- Pick an assigned class + date. Tap a student to cycle status: Present → Absent → Sick → Permission, live tally, saves immediately with per-student saved/failed indicator.
- Restricted to classes the teacher is actually assigned to (enforced server-side); can't mark a future date.
- Separate per-session roster (for timed-shift schools) reached from Beranda's today's-sessions list — same status-cycling plus check-in/out time and pickup person (relationship + name).

### Penilaian (Assessments)
- **Penilaian Pekanan (Weekly)** — homeroom teachers only. Per weekday, per learning objective, tap a development level (3–4 point scale) for every student.
- **Sentra Harian (Daily Learning Centers)** — any teacher. Pick date + age group, describe the activity, select up to 4 objectives, record level (+ optional note) per student.
- Both auto-save as the teacher taps through; access limited to assigned classes/centers.

### Penghubung (Student Journal)
- Pick class + date (today or earlier only). Daily checklist grid per student, grouped by category, saved as a batch.
- Free-text note to a specific student (up to 2,000 chars, today-or-earlier only; date locks once written, text stays editable).
- Weekly per-student view: page week to week, see the full grid, read the note thread, add a note. Shows who corrected an entry and when if admin has touched it.

### Slip Gaji (Pay Slips)
- Read-only list of the teacher's own past pay slips by period.
- Opening one shows income breakdown, deductions, take-home pay, and bank details (account number partially masked).
- Downloadable as PDF. Only appears once the payroll run behind it is admin-approved — current month shows a "available after the 5th" note if not ready.

---

## Parent Portal

**Not yet turned on for real families** — the current pilot is staff-only. Everything below is built and internally tested, not yet proven with real parents. A general rule across every page: a parent only ever sees data for children formally linked to their account; attempts to view unrelated data are silently rejected (falls back to their own child, or a plain "not found" — never an error that confirms/denies another child exists).

### Beranda (Home)
View-only dashboard: one card per child with this week's attendance at a glance, an auto-generated status line (e.g. "sick today," a recent teacher note, or a clean-week message), a short progress-notes preview, and a total-unpaid-invoices tile (or a "fully paid" message). No direct actions — taps route to the full pages. Multi-child households see all children on one dashboard.

### Kehadiran (Attendance)
View-only weekly attendance grid per child (present/sick/absent/permission + teacher notes), week-navigable. "Not recorded yet" message shown gracefully when data's missing. Child-switcher for multi-child households.

### Tagihan (Invoices)
View unpaid total + nearest due date, unpaid list (overdue flagged), paid history. Invoice detail shows itemized breakdown and, once paid, the payment record + downloadable receipt. **Real action:** "Bayar sekarang" opens an external Xendit payment page (bank/VA) when a link is ready; otherwise a "preparing, try again" or "contact the office" message. Draft/cancelled invoices are hidden. If one child is paid but a sibling isn't, the page says so clearly and links to the sibling's invoices rather than implying the whole household is settled.

### Perkembangan (Progress)
View-only summary across 5 development areas (religious/moral, physical/motor, cognitive, language, social-emotional) for the current semester, plus a "this week" list of specific teacher observations tagged by area and level. Skips the child-picker automatically for single-child families.

### Raport (Report Cards)
Once published: celebratory banner, current report view, and a browsable history by term — narrative write-ups, achievement levels, term attendance summary, growth measurements, memorization notes if recorded. "Still being prepared" message if nothing's published yet. **Action:** download PDF. Drafts are never visible to parents; PDF access is checked so a parent can only ever pull their own child's report.

### Buku Penghubung (Journal)
Weekly view in 3 tabs: "Di Sekolah" (school checklist, read-only for parents), "Di Rumah" (home checklist — parents can check/uncheck), "Catatan" (note thread). **Actions:** toggle home-routine items, write a new note, edit/delete notes they personally authored (not the teacher's, not even a spouse's notes under a different login). Child-switcher for multi-child households.

### Profil (Profile)
View own name/phone/email and a list of linked children (tap through to that child's attendance). **Action:** sign out (confirmation required). No self-service edit of contact details, notification prefs, or help/privacy pages yet — intentionally left out rather than shipping non-functional buttons.

### Cross-cutting notes
- Sibling households get explicit handling everywhere a parent has 2+ children — a switcher, plus guards against misleadingly implying "all paid" when only one child is settled.
- Payment is hand-off, not fully in-app — "Pay now" sends the parent to an external Xendit page; the app reflects paid status automatically once the provider confirms.
- Because this hasn't been used by real families yet, treat it as "built and tested internally," not "proven" — worth a short hands-on trial with a couple of real parent accounts before a full rollout.
