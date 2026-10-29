# Cuti siswa — billing skips a student on leave

## Context

A daycare admin had already generated next month's invoices when two families told her their child would be on
leave (cuti) for that month. Today the app has no notion of a student being on leave: a student is ACTIVE or
withdrawn, and the bulk billing run bills every active enrollment. Her only options were to void the invoices by hand
and then remember to exclude those children from every later billing run. She asked whether leave can be recorded on
the web.

Facts from the code (looked up, not asked):
- "Leave" in the code today means *employee* leave (HR). Student leave needs its own name and its own table.
- A student can hold more than one ACTIVE enrollment (a school class plus a daycare program). The billing run merges
  them into one invoice, and an invoice carries no link to an enrollment or program. Leave must therefore attach to an
  **enrollment**, so a child on daycare leave is still billed for school.
- Billing periods are free-text labels like "Desember 2026"; `parsePeriodMonth` turns a single-month one into
  year + month and returns nothing for anything else (a semester, a range, two years).
- The "already invoiced" check ignores invoice status: a voided invoice still blocks re-billing that month.
- Voiding an invoice is an existing action (`invoices.void`); it refuses invoices that already took payment.
- A billing-run draft persists across sessions and commits its stored amounts as they are, so a draft built before a
  leave was recorded would still bill the child unless something touches it.
- Billing only reads enrollments in the run's own academic year; many students keep a stale ACTIVE enrollment in an
  archived year.

Plan reviewed by Opus 5.5 (verdict: approve with changes); every change is folded in below.

## Decisions

Taken on the product owner's behalf ("make your best judgement, then proceed"); each is cheap to change later.

1. **Admin records the leave, parents do not submit it.** The pain is "do not bill someone on leave". A parent-facing
   request flow adds a portal page, an approval queue and notifications for a rarely used action. Out of scope; the
   leave record is the foundation if it is wanted later.
2. **Whole months, inclusive range** ("Desember 2026" to "Januari 2027"), stored as `YYYY-MM` text. Billing is
   monthly; day-level leave would need proration.
3. **Leave belongs to one enrollment**, not to the student. A student whose every in-scope enrollment is on leave is
   skipped; one with only some on leave is billed for the rest. An enrollment that is withdrawn and later
   reactivated keeps its old leave (same placement); the Cuti list shows the enrollment status so the admin can
   cancel it.
4. **Months must lie inside the enrollment's academic-year billing window** (the year's first month through
   eleven months later at most, the rule the SPP prepay already uses), the enrollment and the student must be
   ACTIVE, and the year must be writable. A leave that billing could never see is refused rather than silently
   ignored.
5. **A skipped student shows a visible reason** in the billing run review ("Sedang cuti") and cannot be included
   there. The full-leave check comes before "already invoiced", so a student whose invoice was cancelled for leave
   reads "Sedang cuti", not "Sudah ditagih".
6. **Recording a leave handles the drafts and invoices it makes obsolete:**
   - An open billing-run draft (or one mid-commit) for a covered month has this student's uncommitted rows set to
     "Dikecualikan" with a stated reason, so committing it cannot bill the child. A row the commit already claimed is
     left alone. Rebuilding the draft applies the leave properly (a partly-on-leave student keeps the other fees).
   - The admin is shown that student's unpaid, still-cancellable invoices for the covered months and can cancel each
     one with the existing cancel action. Nothing is cancelled automatically. The same list can be reopened from any
     active leave ("Cek tagihan"), because a commit in flight can create an invoice after the first list.
   - The list shows invoice number, label, total and lines, flags one-off (non-recurring) lines, warns when the
     student has another active enrollment ("biaya kelas lain di tagihan ini ikut batal; buat tagihan baru manual
     untuk biaya itu"), and says invoices with another period label are not listed.
7. **Cancel only, no edit.** A leave is created or cancelled (soft cancel with who and when), never edited or
   deleted. Both are audited. Cancelling does not touch drafts or invoices; a stale "Sedang cuti" row under-bills,
   which is the safe direction, and the admin is told to rebuild the draft.
8. **Permissions:** creating or cancelling a leave needs `students.edit` and `invoices.create` (it stops billing, so a
   student-data-only role must not do it); listing needs `students.view`; the invoice list needs `invoices.view`;
   cancelling an invoice keeps `invoices.void`. No new permission codes.
9. **The managing UI is the student page** (where enrollments are listed), as a "Cuti" section. No new top-level
   admin page.
10. **Glossary:** "Cuti" for a student means a billing pause on one placement; it is not "Izin" (a day's absence) and
    not staff leave.
11. **Voided invoices keep blocking re-billing** for their month (existing behavior, unchanged). Stated plainly in
    the UI.

## Acceptance criteria

- [ ] An admin with student-edit and invoice-create rights can record a leave for one of a student's active
      enrollments (first month, last month, reason); it appears in the student's Cuti section.
- [ ] A leave is refused when it overlaps another active leave of the same enrollment (even two requests at once),
      ends before it starts, has months outside the enrollment's academic-year window, or targets an enrollment/
      student that is not active, a read-only year, or another tenant's.
- [ ] A billing run for a month inside a leave shows that student as "Sedang cuti": no fee lines, no amount, no
      switch to include them, even when an invoice for that month already exists; committing creates no invoice.
- [ ] A student with two active enrollments, only one on leave, is still billed for the other enrollment's fees; if
      the remaining enrollment has no fee structure the row says so instead.
- [ ] A run for a month outside the leave, or whose label is not a single month, bills the student normally.
- [ ] Recording a leave while a draft for a covered month exists excludes that student's uncommitted row (also while
      the draft is committing; rows already claimed by the commit are untouched); rebuilding that draft then shows
      "Sedang cuti" or the remaining fees.
- [ ] After saving a leave, and later from "Cek tagihan", the admin sees the student's cancellable invoices for the
      covered months (no paid invoices, no other-label invoices) and can cancel each; the list appears only with
      invoice-view rights and the cancel button only with void rights.
- [ ] An admin can cancel a leave; the next run bills the student again.
- [ ] A role with student-edit but without invoice-create is refused; creating and cancelling are audit-logged.

## Verify flows

1. **Happy path (school admin, desktop):** open a seeded daycare student → Cuti section → "Catat cuti" → daycare
   enrollment, Desember 2026 to Desember 2026, reason "Pulang kampung". Saved and listed. Open the billing wizard
   for "Desember 2026" scoped to the daycare class: that student reads "Sedang cuti", others bill.
2. **Draft + invoice follow-up:** with a DRAFT run open for the month, record a leave for the current month that
   already has an unpaid seeded invoice. The follow-up lists that invoice; cancel it; it shows Dibatalkan on the
   invoice page. The draft row now reads Dikecualikan with the leave reason; rebuild the draft; it reads "Sedang
   cuti".
3. **Edge, two placements:** a student enrolled in a school class and the daycare program; leave on the daycare
   enrollment only; the wizard still bills the school fee.
4. **Error:** an overlapping leave for the same enrollment, and a month outside the academic year, are each
   rejected with a clear message; cancelling the leave makes the wizard bill the student again.

## UX notes

- Primary action on the student page section: "Catat cuti". Dialog fields: enrollment (only if more than one
  eligible), "Mulai bulan", "Sampai bulan", "Alasan".
- Rows: program + class, "Des 2026 – Jan 2027", reason, status badge (Aktif / Dibatalkan), actions "Cek tagihan"
  and "Batalkan cuti" (active ones).
- Empty state: "Belum ada cuti. Catat cuti kalau siswa berhenti sementara dan tidak perlu ditagih."
- After saving, if drafts were touched: "Draf tagihan <periode> dibuat sebelum cuti ini; siswa dikecualikan. Hitung
  ulang draf agar biaya lain tetap ditagih."
- Billing review: reason label "Sedang cuti"; footer copy for skipped students names leave alongside the existing
  reasons.
- Invoice follow-up dialog "Tagihan yang masih terbuka", per row "Batalkan tagihan" (voice.md copy); closing without
  cancelling is fine and says so.
- Existing Shadcn dialog/table/month inputs; no new visual language (design-system respected).

## Test seams

- Pure: month/overlap/window helpers; `buildBillingRunRows` (full leave before already-invoiced, partial leave,
  same-program duplicate, class label, no-fee remainder, summary).
- Materialize with a fake db (active leaves loaded, cancelled ignored, unparseable label loads nothing).
- API route tests: create/list/cancel/open-invoices (validation, tenant, permissions, overlap incl. concurrent lock,
  year window, audit, draft/committing exclusion, paid and other-label invoices not offered).
- Billing-run routes: rebuild does not re-apply the leave exclusion; row PATCH refuses a SKIPPED_* source row;
  SPP prepay pricing unchanged.
- Component tests: Cuti section/dialogs; wizard shows "Sedang cuti".
- One e2e: admin records a leave, the billing wizard shows the student on leave, cancelling restores it.

## Non-goals

- Parent-facing leave request / approval flow, notifications.
- Day-level leave, proration, refunds or credit for months already paid.
- A cross-student "who is on leave" admin page.
- Making "Catat SPP di muka" (prepay) leave-aware: it records money actually received for months the admin chose,
  and honouring leave would make a covered month unpriced and block the whole plan. Its enrollment query only gains
  the enrollment id.
- Automatically cancelling invoices, or re-billing a month after a leave is cancelled.
- Editing a leave (cancel and re-create instead). Dashboard activity-feed lines for leave.
- Changing how voided invoices count as "already invoiced".

## Assumptions

1. The leave covers all fee components of that enrollment's program (no retainer fee kept).
2. Leave months are compared against the run's period label; a run whose label is not a single month (a semester,
   "Des 2026 - Jan 2027") is never skipped by leave. Months are `YYYY-MM` text, "today" is Jakarta time.
3. A leave may start in a past month within the year window (late bookkeeping); it simply affects no future run.
4. Reason is required free text, 3–200 characters.
5. The invoice follow-up matches invoices to months by the free-text period label only (invoices have no enrollment
   link), so a one-off invoice labelled with that month (for example a uniform) is listed and flagged.
6. A few milliseconds between a billing-run draft's data read and its insert can still miss a leave recorded in
   that window; accepted.

## Gate re-openers

Schema migration: one new table `EnrollmentLeave` (additive, tenant-scoped, RLS policy like its siblings, FKs
Restrict). No new dependency, no change to auth or PII handling, no production write by the agent (the migration
runs on deploy), no change to the BillingRun tables.

## Tasks

- [x] T1 Schema + migration: `EnrollmentLeave` (tenantId, studentId, enrollmentId, startMonth, endMonth, reason,
      status ACTIVE|INACTIVE, createdBy, createdAt, cancelledBy, cancelledAt; indexes tenant+status,
      enrollment+status, student), RLS migration, schema status comments, seed `deleteMany` before enrollments
      (+ one daycare leave in the seed), enum-conformance rows — accept: `prisma db push` + seed clean,
      `verify-rls-coverage.sh` green (reuse: StudentFeeAdjustment migration)
- [x] T2 Domain helpers + validation (`lib/enrollment-leave/`, `lib/validations/enrollment-leave.ts`): month
      parse/compare, inclusive overlap, academic-year billing window (extract from spp-prepay-load), create/cancel
      schemas — accept: unit tests (deps: T1; reuse: `parsePeriodMonth`, spp-prepay window)
- [x] T3 Billing run: optional `onLeaveEnrollmentIds` + `enrollmentId` on `BuildEnrollment`, classifier rules, load
      leaves in materialize (only for a single-month label), `SKIPPED_ON_LEAVE` through summary/types/status
      filter/wizard label/footer, rebuild skips leave-reason exclusions, row PATCH only from PENDING/EXCLUDED,
      spp-prepay-load passes the enrollment id — accept: classifier, materialize, route, wizard and prepay tests
      (deps: T2)
- [x] T4 API under `app/api/students/[id]/leaves/`: list, create (advisory lock, window/active/tenant checks,
      draft/committing exclusion, returns open invoices), cancel, open-invoices — accept: route tests (deps: T2, T3;
      reuse: enroll route pattern, `ensureYearWritableById`, `VOIDABLE_INVOICE_STATUSES`)
- [x] T5 Student page "Cuti" section, create/cancel dialogs, invoice follow-up dialog — accept: component tests
      (deps: T4)
- [x] T6 e2e spec + docs: README line, voice.md glossary row, UAT job, `audit-docs.sh --write`, local full gate
      (deps: T3–T5)

## Implementation

- Plan: driver=claude-sonnet-5-5 (plan reviewed by Opus 5.5), workers=sonnet; T1 inline (tiny, defines the table every
  other slice reads); T2→T4 sequential in one worker (shared helpers), T3 parallel in a second worker (disjoint files);
  T5 one worker after T4; T6 inline (docs, gate, e2e run).
- T1: prisma/schema.prisma, prisma/migrations/20261029000000_add_enrollment_leave/migration.sql, prisma/seed.ts — new
  `EnrollmentLeave` table (additive, RLS, Restrict FKs), `SKIPPED_ON_LEAVE` in the BillingRunRow status comment, seed
  clears leaves before enrollments. `verify-rls-coverage.sh` 45/45; `db push` + seed clean on the disposable DB.
- T3: lib/finance/{build-billing-run,materialize-billing-run,spp-prepay-load,leave-exclusion}.ts, app/api/billing-runs/**
  (list filter, rebuild, row PATCH), wizard types/step-2/step-3 + tests — `SKIPPED_ON_LEAVE` end to end: classifier drops
  on-leave enrollments before the program dedupe and skips only an emptied group (before already-invoiced), materialize
  loads ACTIVE leaves only for a single-month label, rebuild does not re-apply a leave-reason exclusion, row PATCH only
  from PENDING/EXCLUDED, prepay unchanged. Worker reported 679 tests green; re-run by the driver: 42 files / 656 tests
  pass (lib/finance, billing-runs routes, wizard components, validations).
- T2: lib/enrollment-leave/{months,window,eligibility}.ts, lib/validations/enrollment-leave.ts + tests — month parse/compare/
  overlap/range label, academic-year billing window (standalone copy of the SPP-prepay rule), create/cancel schemas.
- T4: app/api/students/[id]/leaves/{route,[leaveId]/route,[leaveId]/open-invoices/route}.ts, lib/enrollment-leave/
  {billing-runs,open-invoices}.ts + tests — list (with per-enrollment eligibility), create (students.edit + invoices.create,
  tenant/student/enrollment/year-window checks, per-enrollment advisory lock, overlap check, uncommitted rows of open
  DRAFT/COMMITTING runs → EXCLUDED with the leave reason, audit, open-invoice follow-up gated on invoices.view), cancel
  (PUT INACTIVE, audited), re-openable open-invoices GET. Worker reported 103 tests; re-run by the driver: 5 files / 103 tests
  pass, `tsc --noEmit` clean, `verify-api-auth.sh` 224/224.
  Response notes for the UI: create's `affectedRuns` lists only drafts whose rows were actually excluded; cancel's lists every
  open DRAFT/COMMITTING run covering the months (it does not check the student has a row), so the copy there is "hitung ulang
  draf jika ada". `openInvoices` is null without `invoices.view`; an archived year answers 403 (existing year guard).
- T5: components/admin/students/detail/{cuti-section,cuti-create-dialog,cuti-invoices-dialog,cuti-months,cuti-types}, sections.ts,
  group-summaries.ts, app/admin/students/[id]/page.tsx + tests — lazy "Cuti" subsection in the Keuangan group (list, empty state,
  Catat cuti dialog limited to eligible enrollments and the year window, Batalkan cuti confirm, re-openable "Cek tagihan"
  follow-up with an inline per-invoice cancel, draft-recalculate notice). Gated on students.edit in the UI; the API additionally
  needs invoices.create (a 403 shows a friendly message). Standards loaded: design-system.html, ui.md, patterns.md, crud.md,
  voice.md, better-accessibility/writing/layout. Worker walked it in a real browser at 1280x900 and 390x844 (no horizontal
  overflow, dialogs and bottom sheet render); the driver looked at the follow-up and mobile dialog screenshots and re-ran
  `components/admin` + `app/admin/students`: 76 files / 689 tests pass, `tsc` and eslint clean.
- T6: e2e/admin-student-leave.spec.ts, README, voice.md glossary ("Cuti"), UAT job JTBD-ADMIN-INV-12, CLAUDE.md counts via
  `audit-docs.sh --write` — two e2e tests: (1) record a leave on the student page → a billing run for that month reads
  SKIPPED_ON_LEAVE → cancel the leave from the page → the next run bills the student again; (2) a draft built before the
  leave is parked as EXCLUDED with the leave reason, an overlapping leave answers 409, rebuild turns the row into
  SKIPPED_ON_LEAVE. Runs set up billing runs through the API and cancel them (one DRAFT per tenant).
- Dedupe: `loadSppPrepayContext` now takes its academic-year billing window from `lib/enrollment-leave/window.ts` (one rule, two
  consumers); lib/finance, lib/enrollment-leave and app/api suites re-run green (218 files / 3185 tests), `tsc --noEmit` clean.

## Verification

## Ship Notes
