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
- Billing periods are free-text labels like "Desember 2026"; `parsePeriodMonth` already turns one into year + month.
- The "already invoiced" check ignores invoice status: a voided invoice still blocks re-billing that month.
- Voiding an invoice is an existing action (`invoices.void`); it refuses invoices that already took payment.

## Decisions

Taken on the product owner's behalf ("make your best judgement, then proceed"); each is cheap to change later.

1. **Admin records the leave, parents do not submit it.** The pain is "do not bill someone on leave". A parent-facing
   request flow adds a portal page, an approval queue and notifications for a rarely used action. Out of scope; the
   leave record is the foundation if it is wanted later.
2. **Whole months, inclusive range** ("Desember 2026" to "Januari 2027"). Billing is monthly; day-level leave would
   need proration.
3. **Leave belongs to one enrollment**, not to the student. A student whose every in-scope enrollment is on leave is
   skipped; one with only some on leave is billed for the rest.
4. **A skipped student shows a visible reason** in the billing run review ("Sedang cuti") and is not billable there.
   The detailed reason lives on the student page.
5. **Recording a leave offers to cancel the invoices it makes obsolete.** After saving, the admin sees that student's
   unpaid, still-cancellable invoices for the covered months and can cancel each one in a click, using the existing
   cancel action and its permission. Nothing is cancelled automatically (money and parent-facing links are involved).
   When the student has other active enrollments the list warns that an invoice may also contain another class's fee.
6. **The leave is managed from the student page** (where enrollments are listed), as a "Cuti" section. No new
   top-level admin page.
7. **Ending or cancelling a leave** is a soft cancel (Batalkan cuti), never a delete, matching the CRUD standard.
8. **Permissions reuse `students.edit`** to record or cancel a leave; cancelling an invoice keeps `invoices.void`. No
   new permission code, so custom roles are unaffected.
9. **Glossary:** "Cuti" for a student means a billing pause on one placement; it is not "Izin" (a day's absence) and
   not staff leave.
10. **Voided invoices keep blocking re-billing** for their month (existing behavior, unchanged). Cancelling a leave
    does not resurrect the month's billing; the admin creates that invoice manually. Stated plainly in the UI.

## Acceptance criteria

- [ ] An admin with student-edit rights can record a leave for one of a student's active enrollments, choosing a
      first month, a last month and a reason; the leave appears in the student's Cuti section.
- [ ] A leave cannot overlap another active leave of the same enrollment, cannot end before it starts, and cannot
      span more than 12 months.
- [ ] A billing run for a month inside a leave shows that student as "Sedang cuti": no fee lines, no amount, no
      switch to include them, and committing the run creates no invoice for them.
- [ ] A student with two active enrollments, only one on leave, is still billed for the other enrollment's fees.
- [ ] A run for a month outside the leave bills the student normally.
- [ ] After saving a leave, the admin is shown that student's cancellable invoices for the covered months and can
      cancel each one; an invoice that already took payment is not offered.
- [ ] An admin can cancel a leave; the student is billed normally again from the next run.
- [ ] Cancelled leaves are not counted by the billing run.
- [ ] Another tenant's enrollment cannot be used; a user without student-edit rights is refused.
- [ ] Each create and cancel/update is audit-logged.

## Verify flows

1. **Happy path (school admin, desktop):** open a seeded daycare student → Cuti section → "Catat cuti" → pick the
   daycare enrollment, Desember 2026 to Desember 2026, reason "Pulang kampung". Saved; list shows it. The invoice
   follow-up shows nothing to cancel (no December invoice) or lists existing ones. Open the billing wizard for
   "Desember 2026" scoped to the daycare class: that student reads "Sedang cuti", others bill.
2. **Invoice follow-up:** repeat for a month that already has an unpaid seeded invoice (current month). After saving,
   the follow-up lists that invoice; cancel it; it shows Dibatalkan on the invoice page.
3. **Edge, two placements:** a student enrolled in a school class and the daycare program; leave on the daycare
   enrollment only; the wizard still bills the school fee for that student.
4. **Error:** a second overlapping leave for the same enrollment is rejected with a clear message; cancelling the
   leave (Batalkan cuti) makes the wizard bill the student again.

## UX notes

- Primary action on the student page section: "Catat cuti". The dialog asks enrollment (only if more than one),
  "Mulai bulan", "Sampai bulan", "Alasan".
- Rows read: program + class, "Des 2026 – Jan 2027", reason, status badge (Aktif / Dibatalkan), "Batalkan cuti".
- Empty state: "Belum ada cuti. Catat cuti kalau siswa berhenti sementara dan tidak perlu ditagih."
- Billing review: reason label "Sedang cuti"; footer copy for skipped students names leave alongside the existing
  reasons.
- Invoice follow-up dialog title "Tagihan yang masih terbuka", per row "Batalkan tagihan" (voice.md copy), closing the
  dialog without cancelling is fine and says so.
- Uses existing Shadcn dialog/table/month inputs; no new visual language (design-system respected).

## Test seams

- Pure: leave coverage/overlap/month helpers; `buildBillingRunRows` (leave pre-check, multi-enrollment partial leave).
- Materialize with a fake db (leaves loaded, cancelled ignored, non-monthly label skips nobody).
- API route tests: create/list/update (validation, tenant, permission, overlap, audit, voidable-invoice list).
- Billing-run row PATCH refuses to include a SKIPPED_ON_LEAVE row.
- Component test for the Cuti section/dialog.
- One e2e: admin records a leave, the billing wizard shows the student as on leave, cancelling the leave restores it.

## Non-goals

- Parent-facing leave request / approval flow, notifications.
- Day-level leave, proration, refunds or credit for months already paid.
- A cross-student "who is on leave" admin page.
- Making "Catat SPP di muka" (prepay) leave-aware: it is an explicit admin action per month.
- Automatically cancelling invoices, or re-billing a month after a leave is cancelled.
- Dashboard activity-feed lines for leave.
- Changing how voided invoices count as "already invoiced".

## Assumptions

1. The leave covers all fee components of that enrollment's program (no retainer fee kept).
2. Leave months are Jakarta calendar months, compared against the billing run's period label; a run whose label is
   not a single month (e.g. a semester) is never skipped by leave.
3. A leave may start in a past month (late bookkeeping); it simply affects no future run.
4. Only ACTIVE enrollments can take a leave.
5. Free-text reason, required, 3–200 characters.

## Gate re-openers

Schema migration: one new table `EnrollmentLeave` (additive, tenant-scoped, RLS policy like its siblings). No new
dependency, no change to auth or PII handling, no production write by the agent (the migration runs on deploy).

## Tasks

- [ ] T1 Schema + migration: `EnrollmentLeave` (tenantId, studentId, enrollmentId, startMonth, endMonth, reason,
      status ACTIVE|INACTIVE, createdBy, createdAt), RLS migration, seed `deleteMany` before enrollments —
      accept: `prisma db push` + seed run clean, `verify-rls-coverage.sh` green (reuse: StudentFeeAdjustment migration)
- [ ] T2 Domain helpers + validation (`lib/enrollment-leave/`, `lib/validations/enrollment-leave.ts`): month range,
      overlap, "covers month", create/update schemas — accept: unit tests (deps: T1; reuse: `parsePeriodMonth`)
- [ ] T3 API: list / create / update-or-cancel with permission, tenant check, overlap check, audit, and the
      cancellable-invoice list in the create response — accept: route tests (deps: T2; reuse: enroll route pattern,
      `VOIDABLE_INVOICE_STATUSES`)
- [ ] T4 Billing run: `enrollmentId` on `BuildEnrollment`, leave pre-check in the classifier, load leaves in
      materialize, `SKIPPED_ON_LEAVE` through the summary/types/filters/wizard labels/footer, guard row PATCH —
      accept: classifier + materialize + route + wizard-component tests (deps: T2; parallel with T3)
- [ ] T5 Student page "Cuti" section, create/cancel dialogs, invoice follow-up dialog — accept: component tests
      (deps: T3)
- [ ] T6 e2e spec + docs: README line, voice.md glossary row, UAT job, `audit-docs.sh --write` (deps: T3–T5)

## Implementation

## Verification

## Ship Notes
