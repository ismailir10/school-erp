# API integrity — scoping leaks, convert/leave races, employee codes, input bounds

## Context
The 2026-10-07 stress run (adversarial power user across all roles at 2,100 students / 20,000 invoices / 50,000 attendance rows on a disposable local Postgres) found the money paths solid — parallel payments, reversals, billing commits and payroll approvals all held — but several API routes that break or leak under ordinary pressure:

- **STR-2 (blocker, scoping)** Any teacher can read every staff member's attendance including GPS fields and download the HR attendance CSV: `/api/attendance/{today,monthly,export}` and `/api/employees/[id]/attendance` gate only on `attendance.view`, which TEACHER holds for *own* attendance. `/api/attendance/trend` already also requires `hr.view`.
- **STR-3 (major, scoping)** Parents can read the school-wide penilaian monitor (`/api/admin/assessments`) because GUARDIAN holds `assessments.read` for their own children.
- **STR-1 (blocker)** Admission → student convert is not atomic: 8 parallel clicks created 8 students and 8 parents. The "already converted" check runs outside the transaction and the in-transaction update is unconditional. The enrollment-form convert route has the same shape.
- **STR-4 (blocker)** Creating an employee returns 500 in an ordinary sequence: the code generator takes the lexicographically highest `kode` across all initials (`RE29` > `RD30`) and re-issues a taken code; `"99" > "100"` breaks again later; an emoji first letter is split mid-surrogate into a corrupt code.
- **STR-5 (major)** Leave balance goes negative (three pending 10-day requests against 12 days all approved → remaining −18): submit counts only approved days and approve never re-checks; approve and reject racing both return 200; approve without a body is a raw 500.
- **STR-7 / STR-11 / STR-13 / STR-17 (major/minor)** Inputs without bounds: a 200,000-character student name is accepted and widens three portals to millions of pixels; a NUL byte is a 500; API names are not trimmed; `?page=abc` is a 500 on 21 list routes; `?search=%00` is a 500; invoice amount `1e13` is a 500 and `0.001` creates a Rp 0 payment; whitespace-only journal notes are accepted.
- **STR-8 (major)** The employee attendance CSV is neither quoted nor formula-neutralised (`=HYPERLINK(...)` passes through, a quote breaks columns); the BSI payroll export quotes but does not neutralise.
- **STR-9 / STR-12 / STR-14 / STR-10 (minor)** Legacy attendance marking without a session creates duplicate rows under parallel calls, accepts 2019-01-01 and 2026-02-30, turns a not-enrolled student into a 500, and keeps an admin's correction note when the teacher re-marks; concurrent billing-run creation surfaces Postgres write conflicts (P2034) as 500.

The user asked for an uninterrupted multi-hour UAT-and-fix session ("work 5 hours straight, dont stop"), which is the authorization for running this cycle without stopping at the Spec gate.

## Spec
- [ ] STR-2: the four staff-attendance routes require `hr.view` in addition to their current permission (SUPER_ADMIN and custom roles with HR keep access; TEACHER and SCHOOL_ADMIN get 403). Teachers keep `/api/attendance/my`. STR-3: `/api/admin/assessments` requires an admin role; teacher/parent flows that read their own assessments are untouched.
- [ ] STR-8: the employee attendance CSV quotes every field and neutralises formula-leading cells with the same helper the student export uses; the BSI export neutralises too.
- [ ] STR-1: converting an admission or an enrollment application is single-winner: concurrent calls produce exactly one student (and at most one new parent); the losers get 409 "Sudah dikonversi".
- [ ] STR-4: employee codes are `<INITIALS><n>` where `n` is one more than the highest numeric suffix in the tenant (numeric, not string, comparison); a code collision retries instead of 500ing; initials are taken per code point and fall back to letters only (no emoji/surrogates).
- [ ] STR-5: submit counts pending + approved days against the balance; approve re-checks the balance and refuses with an Indonesian 409; approve/reject only move a PENDING request (conditional update — the loser gets 409); a missing/invalid body is a 400.
- [ ] STR-7/STR-17: shared text helpers in `lib/validations` trim, reject NUL/control characters, and cap lengths (names 120, short labels 200, notes/addresses 2000); applied to student, guardian, employee, admin admission, invoice line/payment reference+notes, journal note (non-blank after trim). STR-11: pagination parses defensively (NaN → defaults, huge → clamped), search strips NUL and escapes LIKE wildcards where raw SQL/`contains` is used. STR-13: money amounts are ≥ Rp 1 and ≤ Rp 1.000.000.000 with integer rupiah; calendar dates are validated as real dates.
- [ ] STR-9: legacy mark without a session serialises per (student, date) inside the transaction (advisory lock) so parallel calls never duplicate; dates must be real calendar dates and not older than the current academic year start (or 400 days, whichever the code can determine cheaply); STR-12: a not-enrolled student is a 422 with the session route's message; STR-14: re-marking clears a note the request did not send only when the status changes. STR-10: P2034/P2002 on billing-run create map to 409 "Sedang diproses, coba lagi."

### Non-goals
- No schema migration, no new dependency, no unique index changes (races are closed with conditional updates and advisory locks).
- No PDF font embedding (STR-6), no deep-link return path (STR-16, auth), no parent cache invalidation (STR-15), no performance work (STR-18).
- No change to `lib/permissions.ts` role key lists (route-level checks only, smaller blast radius).

### Assumptions
1. HR attendance pages are only used by roles with `hr.view` today (SCHOOL_ADMIN is already redirected away from `/admin/(hr)/**`), so adding `hr.view` to the API changes no working screen.
2. Max lengths are generous enough that no real Indonesian name or address is rejected (120 chars covers the longest seeded names by a wide margin).
3. The losing request of a convert race gets 409; the UI already treats a non-2xx as a toast and refreshes.

### Verification route
Permission guards changed (STR-2/3) → auth-impacting route: local demo-auth verification before merge, PR labelled `needs-staging-verify`, signed-in staging check after merge.

## Tasks
- [ ] **T1 — Scoping + HR CSV.** `app/api/attendance/{today,monthly,export}/route.ts`, `app/api/employees/[id]/attendance/route.ts`, `app/api/admin/assessments/route.ts`, `lib/payroll/bsi-export.ts` (+ tests). STR-2, STR-3, STR-8. Independent.
- [ ] **T2 — Convert races.** `app/api/admissions/[id]/convert/route.ts`, `app/api/enrollments/[id]/convert/route.ts` (+ tests). STR-1. Independent.
- [ ] **T3 — Employees + leave.** `app/api/employees/route.ts`, `app/api/leave/**` (+ tests). STR-4, STR-5. Independent.
- [ ] **T4 — Input bounds.** `lib/validations/**`, `lib/api/pagination.ts`, `app/api/invoices/route.ts` only if the schema change needs it (+ tests). STR-7, STR-11, STR-13, STR-17. Independent.
- [ ] **T5 — Attendance mark + billing-run create.** `app/api/student-attendance/mark/route.ts`, `app/api/billing-runs/route.ts` (+ tests). STR-9, STR-12, STR-14, STR-10. Independent (T4 owns the shared date validator; T5 uses its own route-local check if needed).
- [ ] **T6 — End-of-cycle gate, local verification, Ship Notes.** Depends on T1–T5.

## Implementation

## Verification

## Ship Notes
