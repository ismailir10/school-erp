# Fix money and attendance data

## Context
A code audit found four places where the app silently stores or shows the wrong thing for money and attendance, with no visible error. A partially paid invoice is never re-checked against the payment gateway because the daily cron filters a status that does not exist (`"PARTIAL"`, the real one is `PARTIALLY_PAID`), and the test asserts the wrong value. An admin who corrects an employee's attendance and types a check-in time loses it: creating the record drops the time, and editing an existing record sends `HH:MM` where the server requires a full date-time, so the save is rejected. Between 00:00 and 07:00 WIB the assessments page opens on yesterday, and adding a student to a class stamps the enrolment with yesterday's date, because "today" is computed in UTC. The outcome: the money and attendance numbers people already rely on are true. No screen changes.

Job: a bursar sees a parent's remaining balance disappear after paying, and an admin who sets a check-in time sees that time afterwards.

## Spec
- [ ] The daily reconcile cron also re-checks `PARTIALLY_PAID` invoices that have a payment link. The invoice status values come from one place instead of being retyped in the route.
- [ ] Creating an attendance override with a check-in time stores that time. Editing an existing override with a check-in time is accepted. The time is read as local time in the school's configured timezone (`OrgConfig.timezone`, default Asia/Jakarta) and stored as a UTC instant.
- [ ] The assessments page opens on today's date in Jakarta at any hour.
- [ ] Adding a student to a class stamps today's date in Jakarta, not UTC.
- [ ] The two admin employee date pickers cap "max" at today's date in Jakarta.
- [ ] Each fix has a test that fails before the fix and passes after it. The test that asserts `"PARTIAL"` is corrected.
- [ ] No UI layout, copy or navigation changes.

**Non-goals**
- Moving partially paid invoices to overdue. The write paths deliberately never do this, and every read side already treats partial as unpaid. If the school wants it, that is a separate decision.
- Teacher sessions defaulting every child to Hadir, and the center-assessment form discarding unsaved ratings. Both change what the teacher sees, so they wait for mockups.
- Low-impact UTC uses (attendance far-future check, parent activity window, seed scripts).
- Repairing historical rows. Overrides created without a time cannot be told apart from ones where the admin left it blank. The Ship Notes give a read-only query for stale partial invoices; the fixed cron repairs them on its next run.

**Assumptions I'm making**
1. For an override, the admin still picks the status (Hadir or Terlambat) by hand. I will not auto-derive "Terlambat" from the time.
2. Interpreting `HH:MM` in the organisation timezone is right. Jakarta has no daylight saving, so the +07:00 fallback is safe.
3. Check-out time is not part of this form and stays out of scope.
4. Existing PARTIALLY_PAID invoices with a payment link will be re-checked on the next cron run after deploy. That is intended and idempotent, since it goes through the same payment processor as the webhook.

## Tasks
- [x] **1. Reconcile cron statuses.** Use the shared unpaid-status list (`lib/finance/student-invoice-summary.ts`) in `app/api/cron/reconcile-payments/route.ts`. Fix `app/api/__tests__/cron-reconcile-payments.test.ts:71`. Accept: test fails on the old code, passes on the new.
- [x] **2. Override check-in time.** Accept `HH:MM` in both create and update schemas (`lib/validations/attendance.ts`, `app/api/attendance/[id]/override/route.ts`), convert it with the org timezone using `lib/attendance/timezone.ts`, send it from `components/attendance/override-modal.tsx` on create. Accept: schema and route tests for create and update, both fail on old code.
- [x] **3. Jakarta "today".** Replace the UTC copies in `app/admin/assessments/page.tsx`, `app/api/admin/classes/[id]/enrollments/route.ts` and the two employee date pickers with `getTodayInTimezone(JAKARTA_TZ)`. Accept: a test with the clock set to 18:00 UTC shows the next Jakarta day.
- Dependencies: tasks are independent. Reuse `getTodayInTimezone` and `JAKARTA_TZ` (`lib/attendance/timezone.ts`, `lib/sessions/dates.ts`).

## Implementation
- Subagent plan: driver=claude-sonnet-5-5 (CTO session), dirty-work=sonnet; tasks [1,2,3] parallel (disjoint files, one agent each, tests written failing-first); reviews by a general-purpose agent because `feature-dev:code-reviewer` is not installed in this harness. Full build gate is held until the local heuristic-test server (which serves the compiled `.next` of this worktree) is finished, so the build does not overwrite it.
- Task 1: Reconcile cron statuses — `app/api/cron/reconcile-payments/route.ts`, `app/api/__tests__/cron-reconcile-payments.test.ts` — the sweep now filters with the shared `UNPAID_INVOICE_STATUSES` (SENT, PARTIALLY_PAID, OVERDUE) instead of a retyped list containing the non-existent `"PARTIAL"`; test asserts the shared list and that `PARTIAL` is absent. Reviewer: clear; a PARTIALLY_PAID invoice flows through `reconcileInvoicePayment` / `processPaymentEvent` idempotently (event-id dedup, existing-payment early return, totalPaid recomputed).
- Task 2: Override check-in time — `lib/validations/attendance.ts`, `app/api/attendance/[id]/override/route.ts`, `lib/attendance/timezone.ts` (new `zonedDateTimeToUtc`, Intl only), `components/attendance/override-modal.tsx` + 3 test files — POST and PUT accept `HH:MM` (PUT still accepts a legacy full datetime), converted on the record's date in the tenant's `OrgConfig.timezone` (fallback Asia/Jakarta) and stored as a UTC instant; the modal now sends the time on create. Reviewer (security-sensitive route): clear — tenant scoping, permission and payroll-lock guards unchanged; conversion checked for Jakarta, Makassar, UTC-midnight crossing and New York DST gap/overlap. Known and accepted: re-posting an override without a time leaves any earlier check-in time in place beside the new status; an invalid `OrgConfig.timezone` string would throw (same exposure as self check-in).
- Task 3: Jakarta "today" — `app/admin/assessments/page.tsx`, `app/api/admin/classes/[id]/enrollments/route.ts`, `app/admin/(hr)/employees/page.tsx`, `app/admin/(hr)/employees/[id]/page.tsx` + their tests — the four UTC "today" copies now use `getTodayInTimezone(JAKARTA_TZ)`; the sibling enrolment routes already did. Reviewer: clear (no hydration risk; `enrollDate` only compared with other `enrollDate` strings).

## Verification
- Task 2: `npx vitest run lib/validations/__tests__/attendance.test.ts lib/attendance app/api/__tests__/attendance-override-post-lock.test.ts` → 4 files, 77 tests passed (run by the driver and again by the reviewer). Subagent reproduced 22 failures on the unmodified code before implementing. `npx tsc --noEmit` clean per the subagent; the driver reruns it with the final gate.
- design-system: not applicable beyond confirming no visual change. The `.tsx` edits (assessments page, two employee pages, override modal) change only a default date value, a DatePicker `max` attribute, and one request-body field — no markup, class, copy or layout, so there is nothing to cross-check against `design-system.html`.
- Task 3: `npx vitest run app/api/__tests__/class-enrollments-add.test.ts app/admin/assessments "app/admin/(hr)/employees" lib/sessions` → 6 files, 51 tests passed (run by the driver). Each new test sets the clock to 2026-10-04T18:00Z (01:00 WIB on the 5th) and fails on the old code (subagent reproduced 4 failures before the fix).
- Task 1: `npx vitest run app/api/__tests__/cron-reconcile-payments.test.ts app/api/__tests__/finance-maintenance.test.ts` → 2 files, 16 tests passed (run by the driver, not only the subagent). Full build gate pending (see Implementation).

## Ship Notes
